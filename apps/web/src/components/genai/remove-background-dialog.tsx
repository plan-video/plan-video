/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { Ai, getAssetFile } from "@plan.video/runtime";
import { assetName } from "@plan.video/assets";

import { CutoutMeta, CutoutStage, CutoutTabs, KeyHint, pngSize, typingInto, type CutoutMode } from "@/components/cutout/cutout-stage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { canRetryCutout, cutoutError, cutoutName, isCancelled, removeImageBackground, type Cutout, type CutoutProgress } from "@/lib/background-removal";
import { msg, t } from "@/lib/i18n";
import { EditorGenAi } from "@/utils/gen-ai";
import { sourceOf, useTransforms } from "./use-transforms";

import type { Asset } from "@plan.video/assets";
import type { Entity } from "koota";

const STARTING: CutoutProgress = { stage: "preparing", progress: 0.02, message: msg("Starting local model…") };

export function RemoveBackgroundDialog(props: { entity: Entity; onClose(): void }) {
  const world = useWorld();
  const { turnOn } = useTransforms();
  const [input, setInput] = createSignal<{ asset: Asset; file: File; url: string } | null>(null);
  const [progress, setProgress] = createSignal<CutoutProgress | null>(STARTING);
  const [result, setResult] = createSignal<{ blob: Blob; url: string; cutout?: Cutout } | null>(null);
  const [error, setError] = createSignal<{ message: string; retry: boolean } | null>(null);
  const [mode, setMode] = createSignal<CutoutMode>("compare");
  const [applying, setApplying] = createSignal(false);
  let controller: AbortController | undefined;
  const urls: string[] = [];

  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };

  const ai = () => {
    const attached = world.get(Ai);
    if (!(attached instanceof EditorGenAi)) throw new Error(t("This project can't run image tools."));
    return attached;
  };

  const run = (file: File) => {
    controller?.abort();
    const job = new AbortController();
    controller = job;
    setError(null);
    setProgress(STARTING);
    removeImageBackground(file, { signal: job.signal, onProgress: setProgress }).then(
      (cutout) => {
        if (job.signal.aborted) return;
        setProgress(null);
        setResult({ blob: cutout.blob, url: objectUrl(cutout.blob), cutout });
      },
      (failure) => {
        if (job.signal.aborted || isCancelled(failure)) return;
        console.error("[cutout]", failure);
        setProgress(null);
        setError({ message: cutoutError(failure), retry: canRetryCutout(failure) });
      },
    );
  };

  onMount(() => {
    void (async () => {
      try {
        const src = sourceOf(props.entity);
        if (src === undefined) throw new Error(t("This element has no picture to work on."));
        const asset = await ai().transformInput(src);
        if (asset.type !== "IMAGE") throw new Error(t("Only a picture has a background to remove."));
        const file = await getAssetFile(asset);
        setInput({ asset, file, url: objectUrl(file) });

        const earlier = ai().transformed("removeBackground", asset);
        if (earlier) {
          const blob = await getAssetFile(earlier);
          setProgress(null);
          setResult({ blob, url: objectUrl(blob) });
        } else run(file);
      } catch (failure) {
        setProgress(null);
        setError({ message: failure instanceof Error ? failure.message : String(failure), retry: false });
      }
    })();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || typingInto(event)) return;
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      void apply();
    };
    // The canvas behind reads every key off the window (arrows nudge, Delete removes, Escape deselects).
    // Tab still reaches the dialog's focus trap.
    const shield = (event: KeyboardEvent) => {
      if (event.key === "Tab") return;
      event.stopPropagation();
      if (event.key === "Escape" && event.type === "keydown") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keydown", shield, true);
    window.addEventListener("keyup", shield, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keydown", shield, true);
      window.removeEventListener("keyup", shield, true);
      controller?.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    });
  });

  const apply = async () => {
    const current = input();
    const done = result();
    if (!current || !done || applying()) return;
    setApplying(true);
    try {
      await ai().adoptTransform("removeBackground", current.asset, done.blob);
      turnOn("removeBackground", props.entity);
      props.onClose();
    } catch (failure) {
      setApplying(false);
      toast.error(t("Couldn't apply the cutout"), { description: failure instanceof Error ? failure.message : String(failure) });
    }
  };

  const download = () => {
    const current = input();
    const done = result();
    if (!current || !done) return;
    const link = document.createElement("a");
    link.href = done.url;
    link.download = cutoutName(assetName(current.asset));
    link.click();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent
          showCloseButton={false}
          class="flex h-[min(44rem,calc(100vh-4rem))] w-[min(60rem,calc(100vw-4rem))] max-w-none flex-col gap-3 p-4 sm:max-w-none"
          onOpenAutoFocus={(event: Event) => event.preventDefault()}
        >
          <div class="flex h-7 shrink-0 items-center gap-3">
            <DialogTitle class="text-sm font-450 text-foreground">{t("Remove background")}</DialogTitle>
            <Show when={input()}>
              {(current) => <span class="min-w-0 truncate text-xs text-muted-foreground">{assetName(current().asset)}</span>}
            </Show>
            <span class="flex-1" />
            <Show
              when={result()?.cutout}
              fallback={
                <span class="flex items-center gap-1 text-xxs text-muted-foreground">
                  <Icon name={result() ? "clock" : "lock-closed-small"} class="size-4" />
                  {result() ? t("Made earlier in this project") : t("Runs on this device")}
                </span>
              }
            >
              {(cutout) => <CutoutMeta cutout={cutout()} />}
            </Show>
            <Button variant="ghost" size="icon-square" aria-label={t("Close")} onClick={() => props.onClose()}>
              <Icon name="close-remove" class="size-5 text-muted-foreground" />
            </Button>
          </div>

          <Show
            when={input()}
            fallback={
              <div class="relative grid min-h-0 flex-1 place-items-center rounded-xl border border-border-strong">
                <Show when={error()} fallback={<Icon name="spinner-loader" class="size-5 animate-spin text-muted-foreground" />}>
                  <p class="max-w-sm text-center text-xs text-muted-foreground">{error()?.message}</p>
                </Show>
              </div>
            }
          >
            {(current) => (
              <CutoutStage class="min-h-0 flex-1" original={current().url} result={result()?.url} progress={progress()} mode={mode()}>
                <Show when={error()}>
                  {(failure) => (
                    <div class="absolute inset-0 grid place-items-center bg-background/80 p-6 backdrop-blur-sm animate-in fade-in-0">
                      <div class="flex max-w-sm flex-col items-center gap-3 text-center">
                        <span class="grid size-10 place-items-center rounded-full bg-destructive/15 text-destructive">
                          <Icon name="alert-warning" class="size-5" />
                        </span>
                        <div class="flex flex-col gap-1">
                          <p class="text-sm font-450 text-foreground">{t("Couldn't remove the background")}</p>
                          <p class="text-xs text-muted-foreground">{failure().message}</p>
                        </div>
                        <Show when={failure().retry}>
                          <Button variant="secondary" onClick={() => run(current().file)}>
                            {t("Try again")}
                          </Button>
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>
              </CutoutStage>
            )}
          </Show>

          <div class="flex h-7 shrink-0 items-center gap-4">
            <CutoutTabs mode={mode()} disabled={!result()} onChange={setMode} />
            <Show when={result()}>
              <KeyHint keys={["Space"]}>{t("Hold to peek")}</KeyHint>
              <Show when={mode() === "compare"}>
                <KeyHint keys={["←", "→"]}>{t("Slide")}</KeyHint>
              </Show>
            </Show>
            <span class="flex-1" />
            <Show when={result()}>
              <Button variant="ghost" class="gap-1 pl-1.5" onClick={download}>
                <Icon name="download" class="size-4" />
                {t("Download PNG")}
                <span class="font-normal tabular-nums text-muted-foreground">{pngSize(result()?.blob)}</span>
              </Button>
            </Show>
            <Button variant="secondary" onClick={() => props.onClose()}>
              {t("Cancel")}
            </Button>
            <Button class="gap-1.5 pr-1.5" disabled={!result() || applying()} onClick={() => void apply()}>
              {t("Apply")}
              <Kbd class="h-4 min-w-0 bg-white/20 px-1 text-xxs text-primary-foreground">↵</Kbd>
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
