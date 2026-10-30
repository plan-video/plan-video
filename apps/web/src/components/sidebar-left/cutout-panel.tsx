/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Remove background extension: a picture from the project, or one
// dropped in from the computer, with its background taken out on this
// device. The cutout goes into the project's assets, and onto the scene.

import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { Ai, ChildOf, Root, Scene, getActiveEntity, isScene, setActive } from "@plan.video/runtime";
import { GENERATED_DIR, assetName, basename } from "@plan.video/assets";

import { setSidebarTab } from "@/agent-chat";
import { CHECKERBOARD, CutoutMeta, CutoutStage, CutoutTabs, pngSize, type CutoutMode } from "@/components/cutout/cutout-stage";
import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { Icon } from "@/components/ui/icon";
import { droppedFiles, pickFiles } from "@/engine/asset-actions";
import { insertAsset } from "@/engine/insert-asset";
import { insertAssetsInNewScene } from "@/engine/new-scene";
import { useLibrary } from "@/engine/library";
import { CUTOUT_EXTENSION, setOpenExtension } from "@/extensions/state";
import {
  CUTOUT_ACCEPT,
  CUTOUT_FORMATS,
  canRetryCutout,
  cutoutError,
  cutoutModelReady,
  cutoutName,
  isCancelled,
  isCutoutImage,
  modelDownloadSize,
  removeImageBackground,
  type Cutout,
  type CutoutProgress,
} from "@/lib/background-removal";
import { msg, t } from "@/lib/i18n";
import { EditorGenAi } from "@/utils/gen-ai";

import type { Asset, AssetLibrary } from "@plan.video/assets";
import type { Entity, World } from "koota";

type Source = { file: File; url: string; asset?: Asset };
type Result = { blob: Blob; url: string; cutout?: Cutout; saved?: Asset };
type Failure = { message: string; retry: boolean };

const STARTING: CutoutProgress = { stage: "preparing", progress: 0.02, message: msg("Starting local model…") };

// Kept across tab switches, so a run carries on while the assets are open.
const [source, setSource] = createSignal<Source | null>(null);
const [progress, setProgress] = createSignal<CutoutProgress | null>(null);
const [result, setResult] = createSignal<Result | null>(null);
const [failure, setFailure] = createSignal<Failure | null>(null);
const [mode, setMode] = createSignal<CutoutMode>("compare");
const [ready, setReady] = createSignal(cutoutModelReady());
const [requested, setRequested] = createSignal<string | null>(null);
/** The library of the project the open picture came in through; another project starts fresh. */
let owner: AssetLibrary | undefined;
let controller: AbortController | undefined;

/** Opens the extension on one of the project's pictures. */
export function openCutout(asset: Asset) {
  setRequested(asset.id);
  setSidebarTab("extensions");
  setOpenExtension(CUTOUT_EXTENSION);
}

function clearResult() {
  controller?.abort();
  controller = undefined;
  const done = result();
  if (done) URL.revokeObjectURL(done.url);
  setResult(null);
  setProgress(null);
  setFailure(null);
}

function clear() {
  clearResult();
  const current = source();
  if (current) URL.revokeObjectURL(current.url);
  setSource(null);
  setMode("compare");
}

function run(file: File) {
  clearResult();
  const job = new AbortController();
  controller = job;
  setProgress(STARTING);
  removeImageBackground(file, { signal: job.signal, onProgress: setProgress }).then(
    (cutout) => {
      if (job.signal.aborted) return;
      setProgress(null);
      setReady(true);
      setResult({ blob: cutout.blob, url: URL.createObjectURL(cutout.blob), cutout });
    },
    (error) => {
      if (job.signal.aborted || isCancelled(error)) return;
      console.error("[cutout]", error);
      setProgress(null);
      setFailure({ message: cutoutError(error), retry: canRetryCutout(error) });
    },
  );
}

function begin(library: AssetLibrary, next: Source) {
  clear();
  owner = library;
  setSource(next);
}

const editorAi = (world: World): EditorGenAi | undefined => {
  const ai = world.get(Ai);
  return ai instanceof EditorGenAi ? ai : undefined;
};

/** A cutout this tool or the editor's transform made, by the name both give it. */
const isCutout = (asset: Asset) => / \(Background removed\)(\.\w+)?$/.test(assetName(asset));

async function openAsset(world: World, library: AssetLibrary, asset: Asset) {
  if (source()?.asset?.id === asset.id) return;
  let file: File;
  try {
    file = new File([await library.file(asset)], basename(asset.path), { type: asset.mimeType });
  } catch {
    toast.error(t("Couldn't open that picture"), { description: assetName(asset) });
    return;
  }
  if (!isCutoutImage(file)) {
    toast.error(t("Choose a PNG, JPG or WebP picture"), { description: assetName(asset) });
    return;
  }
  begin(library, { file, url: URL.createObjectURL(file), asset });

  // The editor's Remove background may have cut this one out already.
  const earlier = editorAi(world)?.transformed("removeBackground", asset);
  if (earlier) {
    try {
      const blob = await library.file(earlier);
      if (source()?.asset !== asset) return;
      setResult({ blob, url: URL.createObjectURL(blob), saved: earlier });
      return;
    } catch {
      // Its file is gone: make it again.
    }
  }
  run(file);
}

function openFiles(library: AssetLibrary, files: readonly File[]) {
  const file = files.find(isCutoutImage);
  if (!file) {
    if (files.length) toast.error(t("Choose a PNG, JPG or WebP picture"), { description: files[0]!.name });
    return;
  }
  begin(library, { file, url: URL.createObjectURL(file) });
  run(file);
}

/**
 * The scene the cutout goes into: the one on the timeline, or else the
 * project's first, which then takes the timeline. Null when there is none
 * yet, and the cutout makes one of its own size.
 */
function targetScene(world: World): Entity | null {
  const active = getActiveEntity(world);
  if (active && isScene(active)) return active;
  const root = world.get(Root);
  const first = root ? world.query(Scene, ChildOf(root))[0] : undefined;
  if (!first) return null;
  setActive(world, first);
  return first;
}

/** The cutout as an asset of the project: the one already filed, or filed now. */
async function file(world: World, library: AssetLibrary): Promise<Asset | undefined> {
  const current = source();
  const done = result();
  if (!current || !done) return undefined;
  if (done.saved && library.get(done.saved.id)) return done.saved;
  const ai = editorAi(world);
  const saved =
    current.asset && ai
      ? await ai.adoptTransform("removeBackground", current.asset, done.blob)
      : await library.store(done.blob, { name: cutoutName(current.file.name), folder: GENERATED_DIR });
  if (result() === done) setResult({ ...done, saved });
  return saved;
}

export function CutoutPanel() {
  const world = useWorld();
  const library = useLibrary();
  const [dragging, setDragging] = createSignal(false);
  const [busy, setBusy] = createSignal<"save" | "add" | null>(null);
  let depth = 0;

  createEffect(
    on(library, (lib) => {
      if (owner && lib !== owner) {
        clear();
        owner = undefined;
      }
    }),
  );

  createEffect(() => {
    const id = requested();
    const lib = library();
    if (!id || !lib) return;
    setRequested(null);
    const asset = lib.get(id);
    if (asset) void openAsset(world, lib, asset);
  });

  const images = createMemo(() => library()?.list().filter((asset) => asset.type === "IMAGE" && !isCutout(asset)) ?? []);
  const saved = () => {
    const filed = result()?.saved;
    return !!filed && !!library()?.list().some((asset) => asset.id === filed.id);
  };

  const withLibrary = (act: (library: AssetLibrary) => unknown) => {
    const lib = library();
    if (!lib) return void toast(t("No project open"), { description: t("Open a project to use its pictures.") });
    void act(lib);
  };

  const choose = () => withLibrary(async (lib) => openFiles(lib, await pickFiles({ multiple: false, accept: CUTOUT_ACCEPT })));

  const act = async (kind: "save" | "add") => {
    const lib = library();
    if (!lib || busy()) return;
    setBusy(kind);
    try {
      const asset = await file(world, lib);
      if (!asset) return;
      if (kind === "add") {
        const scene = targetScene(world);
        const placed = scene ? insertAsset(world, asset, { parent: scene }) : insertAssetsInNewScene(world, [asset]);
        if (!placed) toast(t("Couldn't place the cutout"), { description: t("It is in your assets: drag it onto a scene.") });
      } else toast.success(t("Saved to assets"), { description: assetName(asset), action: { label: t("Show"), onClick: () => setSidebarTab("assets") } });
    } catch (error) {
      toast.error(kind === "add" ? t("Couldn't add the cutout") : t("Couldn't save the cutout"), { description: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const download = () => {
    const current = source();
    const done = result();
    if (!current || !done) return;
    const link = document.createElement("a");
    link.href = done.url;
    link.download = cutoutName(current.file.name);
    link.click();
  };

  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth++;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.stopPropagation();
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    depth = 0;
    setDragging(false);
    const files = droppedFiles(event);
    withLibrary((lib) => openFiles(lib, files));
  };

  const name = (current: Source) => (current.asset ? assetName(current.asset) : current.file.name);

  return (
    <div
      class="relative flex min-h-0 flex-1 flex-col"
      on:dragenter={onDragEnter}
      on:dragover={onDragOver}
      on:dragleave={onDragLeave}
      on:drop={onDrop}
    >
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-2 px-4 pb-4 pt-3">
          <Show when={source()} fallback={<DropZone onChoose={choose} />}>
            {(current) => (
              <>
                <CutoutStage
                  compact
                  keys={false}
                  class="h-[clamp(11rem,32vh,16rem)]"
                  original={current().url}
                  result={result()?.url}
                  progress={progress()}
                  mode={mode()}
                >
                  <Show when={failure()}>
                    {(failed) => <FailureCard failure={failed()} onRetry={() => run(current().file)} onChoose={choose} />}
                  </Show>
                </CutoutStage>
                <CutoutTabs class="grid grid-cols-3" mode={mode()} disabled={!result()} onChange={setMode} />
              </>
            )}
          </Show>
        </div>

        <div class="flex flex-col gap-5 px-4 pb-5">
          <Show when={source()}>
            {(current) => (
              <Section label={t("Picture")}>
                <div class="flex h-11 items-center gap-2 rounded-md border border-border-input pl-1.5 pr-1">
                  <span class="size-8 shrink-0 overflow-hidden rounded-[4px]" style={CHECKERBOARD}>
                    <img src={result()?.url ?? current().url} alt="" draggable={false} class="size-full object-contain" />
                  </span>
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="truncate text-[12px] text-foreground" title={name(current())}>
                      {name(current())}
                    </span>
                    <Status />
                  </div>
                  <IconButton label={t("Download PNG {size}", { size: pngSize(result()?.blob) })} icon="download" disabled={!result()} onClick={download} />
                  <IconButton label={t("Close picture")} icon="close-remove" onClick={clear} />
                </div>
              </Section>
            )}
          </Show>

          <Section
            label={t("From this project")}
            action={
              <button
                type="button"
                class="flex h-5 items-center gap-0.5 rounded-sm pr-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-ring"
                onClick={choose}
              >
                <Icon name="plus-add-small" class="size-4" />
                {t("Choose file")}
              </button>
            }
          >
            <Show
              when={images().length}
              fallback={<p class="text-[11px] leading-4 text-muted-foreground">{t("Pictures you import into this project show up here.")}</p>}
            >
              <div class="grid grid-cols-4 gap-1.5">
                <For each={images()}>
                  {(asset) => (
                    <button
                      type="button"
                      title={assetName(asset)}
                      aria-label={assetName(asset)}
                      aria-pressed={source()?.asset?.id === asset.id}
                      class="relative aspect-square overflow-hidden rounded-md bg-muted focus-ring after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-inset after:transition-shadow hover:after:ring-1 hover:after:ring-foreground/25 aria-pressed:after:ring-2 aria-pressed:after:ring-ring"
                      onClick={() => withLibrary((lib) => openAsset(world, lib, asset))}
                    >
                      <AssetThumbnail asset={asset} class="absolute inset-0" cache={library()?.cache} />
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Section>

          <p class="flex gap-1 text-[11px] leading-4 text-muted-foreground">
            <Icon name="lock-closed-small" class="-ml-1 size-4 shrink-0" />
            {ready()
              ? t("Runs on this device, so nothing is uploaded and it works offline.")
              : t("Runs on this device, so nothing is uploaded. The first picture downloads the model ({size}) once.", { size: modelDownloadSize() })}
          </p>
        </div>
      </div>

      <div class="grid shrink-0 grid-cols-2 gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          class="flex h-8 items-center justify-center gap-1 rounded-md bg-secondary text-[12px] font-450 text-foreground transition-colors hover:bg-secondary-hover focus-ring disabled:opacity-50"
          disabled={!result() || saved() || busy() !== null}
          onClick={() => void act("save")}
        >
          <Show when={saved()}>
            <Icon name="confirm-check" class="-ml-1 size-4" />
          </Show>
          <Show when={busy() === "save"}>
            <Icon name="spinner-loader" class="-ml-1 size-4 animate-spin" />
          </Show>
          {saved() ? t("In assets") : t("Save to assets")}
        </button>
        <button
          type="button"
          class="flex h-8 items-center justify-center gap-1 rounded-md bg-primary text-[12px] font-450 text-primary-foreground transition-colors hover:bg-primary-hover focus-ring disabled:opacity-50"
          disabled={!result() || busy() !== null}
          onClick={() => void act("add")}
        >
          <Show when={busy() === "add"} fallback={<Icon name="plus-add-small" class="-ml-1 size-5" />}>
            <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
          </Show>
          {t("Add to scene")}
        </button>
      </div>

      <Show when={dragging()}>
        <div class="pointer-events-none absolute inset-x-2 bottom-2 top-0 z-50 rounded-xl border border-ring bg-background p-2 animate-in fade-in-0">
          <div class="absolute inset-0 rounded-xl bg-accent/20" />
          <div class="flex size-full flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-input text-center">
            <CheckerGlyph />
            <span class="pt-2 text-xxs font-450 text-foreground">{t("Drop to remove its background")}</span>
            <span class="text-xxs text-muted-foreground">{t(CUTOUT_FORMATS)}</span>
          </div>
        </div>
      </Show>
    </div>
  );
}

function Status() {
  return (
    <Show
      when={result()}
      fallback={
        <span class="truncate text-[11px] text-muted-foreground" classList={{ "text-destructive": !!failure() }}>
          {failure() ? t("Couldn't remove the background") : t("Removing the background…")}
        </span>
      }
    >
      {(done) => (
        <Show
          when={done().cutout}
          fallback={
            <span class="flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <Icon name="clock" class="-ml-0.5 size-3.5" />
              {t("Made earlier in this project")}
            </span>
          }
        >
          {(cutout) => <CutoutMeta cutout={cutout()} />}
        </Show>
      )}
    </Show>
  );
}

function DropZone(props: { onChoose(): void }) {
  return (
    <button
      type="button"
      class="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-foreground/15 px-6 text-center transition-colors hover:border-foreground/30 hover:bg-accent/40 focus-ring"
      onClick={() => props.onChoose()}
    >
      <CheckerGlyph />
      <span class="flex flex-col gap-0.5">
        <span class="text-[12px] font-450 text-foreground">{t("Drop a picture, or click to choose")}</span>
        <span class="text-[11px] leading-4 text-muted-foreground">{t(CUTOUT_FORMATS)}</span>
      </span>
    </button>
  );
}

/** A picture on a transparent sheet: the tool's mark. */
function CheckerGlyph() {
  return (
    <span class="relative grid size-11 place-items-center">
      <span class="absolute inset-0 rotate-[-8deg] rounded-lg border border-border-strong bg-accent" />
      <span
        class="absolute inset-0 rotate-[6deg] rounded-lg border border-border-strong"
        style={{ ...CHECKERBOARD, "background-size": "8px 8px" }}
      />
      <Icon name="image" class="relative size-5 text-foreground" />
    </span>
  );
}

function FailureCard(props: { failure: Failure; onRetry(): void; onChoose(): void }) {
  return (
    <div class="absolute inset-0 grid place-items-center bg-background/85 p-4 backdrop-blur-sm animate-in fade-in-0">
      <div class="flex flex-col items-center gap-2.5 text-center">
        <span class="grid size-8 place-items-center rounded-full bg-destructive/15 text-destructive">
          <Icon name="alert-warning" class="size-4" />
        </span>
        <div class="flex flex-col gap-1">
          <p class="text-[12px] font-450 text-foreground">{t("Couldn't remove the background")}</p>
          <p class="text-[11px] leading-4 text-muted-foreground">{props.failure.message}</p>
        </div>
        <div class="flex gap-1.5">
          <Show when={props.failure.retry}>
            <button
              type="button"
              class="h-7 rounded-md bg-secondary px-2.5 text-[12px] font-450 text-foreground transition-colors hover:bg-secondary-hover focus-ring"
              onClick={() => props.onRetry()}
            >
              {t("Try again")}
            </button>
          </Show>
          <button
            type="button"
            class="h-7 rounded-md px-2.5 text-[12px] font-450 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
            onClick={() => props.onChoose()}
          >
            {t("Choose another")}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconButton(props: { label: string; icon: string; disabled?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-40"
      onClick={() => props.onClick()}
    >
      <Icon name={props.icon} class="size-5" />
    </button>
  );
}

function Section(props: { label: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-2">
      <div class="flex h-5 items-center justify-between gap-2">
        <span class="text-[11px] font-450 text-muted-foreground">{props.label}</span>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}

/** The market card: a portrait split down the middle, its backdrop on the left and gone on the right. */
export function CutoutCover() {
  return (
    <div class="relative h-20 w-full overflow-hidden" style={{ ...CHECKERBOARD, "background-color": "#0E0F12", "background-size": "10px 10px" }}>
      <div
        class="absolute inset-0"
        style={{
          background: "radial-gradient(80% 110% at 20% 100%, rgba(255, 140, 90, 0.6) 0%, rgba(255, 140, 90, 0) 70%), linear-gradient(180deg, #17223A 0%, #33304F 55%, #7A4E5C 100%)",
          "clip-path": "inset(0 50% 0 0)",
        }}
      />
      <svg viewBox="0 0 120 80" class="absolute left-1/2 top-0 h-full -translate-x-1/2 drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]" aria-hidden="true">
        <defs>
          <linearGradient id="cutout-cover-subject" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#FFFFFF" />
            <stop offset="1" stop-color="#C4C6D0" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="31" r="15" fill="url(#cutout-cover-subject)" />
        <path d="M24 80c0-18 15-31 36-31s36 13 36 31Z" fill="url(#cutout-cover-subject)" />
      </svg>
      <div class="absolute inset-y-0 left-1/2 -ml-px w-0.5 bg-white/90">
        <span class="absolute left-1/2 top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
          <svg viewBox="0 0 16 16" class="size-3" fill="none" aria-hidden="true">
            <path d="M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
