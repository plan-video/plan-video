/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Index, Show, createMemo, createSignal } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { Computed, FrameRate, getSceneAncestor, setPlayhead, store } from "@plan.video/runtime";
import { toast } from "somoto";
import { Button } from "@/components/ui/button";
import { PanelSection } from "@/components/ui/panel-section";
import { captionWordSelection, setCaptionWordSelection } from "@/engine/timeline/caption-word-selection";
import { listWords, type ListedWord, type TimeRange } from "@/lib/caption-edit";
import { cutByCaption } from "@/lib/caption-cut";
import { fillerRanges, pauseRanges, wordRanges } from "@/lib/transcript-cuts";
import { t } from "@/lib/i18n";
import { useCaptionTranscript } from "./use-caption-transcript";

import type { Entity } from "koota";

type CaptionCutsProps = {
  selection: Entity[];
};

export function CaptionCuts(props: CaptionCutsProps) {
  const world = useWorld();
  const entity = () => props.selection[0]!;
  const { asset, transcript, loaded } = useCaptionTranscript(entity);
  const [busy, setBusy] = createSignal(false);

  const words = createMemo(() => listWords(transcript() ?? []));
  const picked = createMemo(() => {
    const selection = captionWordSelection();
    return selection && selection.entity === entity() ? selection.indices : null;
  });

  const fps = () => world.get(FrameRate)?.value ?? 30;
  const origin = () => store(world, Computed).origin[entity().id()] ?? 0;

  const seek = (word: ListedWord) => {
    const scene = getSceneAncestor(entity());
    if (scene) setPlayhead(world, scene, origin() + word.start * fps());
  };

  const run = async (ranges: TimeRange[], empty: string, done: (count: number) => string) => {
    if (busy()) return;
    if (ranges.length === 0) {
      toast(empty);
      return;
    }
    setBusy(true);
    try {
      const result = await cutByCaption(world, entity(), ranges);
      if (!result) return;
      if (result.count === 0) toast(empty);
      else toast.success(done(result.count), { description: t("The video is {seconds} s shorter.", { seconds: result.seconds.toFixed(1) }) });
    } catch (error) {
      toast.error(t("Could not cut the video"), error instanceof Error ? { description: error.message } : {});
    } finally {
      setBusy(false);
    }
  };

  const removePauses = () => {
    const current = transcript();
    if (!current) return;
    // Quiet before the first word counts from where the caption starts.
    const shownFrom = Math.max(0, ((store(world, Computed).start[entity().id()] ?? 0) - origin()) / fps());
    void run(
      pauseRanges(current, shownFrom),
      t("No pauses to remove"),
      (count) => t("{count, plural, one {Removed # pause} other {Removed # pauses}}", { count }),
    );
  };

  const removeFillers = () => {
    const current = transcript();
    if (!current) return;
    void run(
      fillerRanges(current),
      t("No filler words found"),
      (count) => t("{count, plural, one {Removed # filler word} other {Removed # filler words}}", { count }),
    );
  };

  const cutPicked = () => {
    const current = transcript();
    const positions = picked();
    if (!current || !positions || positions.size === 0) return;
    void run(
      wordRanges(current, positions),
      t("No words to cut"),
      () => t("{count, plural, one {Cut # word} other {Cut # words}}", { count: positions.size }),
    );
  };

  let anchor = -1;
  let dragging = false;

  const pick = (index: number, event: PointerEvent) => {
    const current = picked();
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(current ?? []);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setCaptionWordSelection(entity(), [...next]);
      anchor = index;
      return;
    }
    if (event.shiftKey && anchor >= 0) {
      pickRun(index);
      return;
    }
    anchor = index;
    setCaptionWordSelection(entity(), [index]);
    seek(words()[index]!);
  };

  const pickRun = (index: number) => {
    const from = Math.min(anchor, index);
    const to = Math.max(anchor, index);
    setCaptionWordSelection(entity(), Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
  };

  const stopDragging = () => {
    dragging = false;
    window.removeEventListener("pointerup", stopDragging);
  };

  return (
    <Show when={asset()}>
      <PanelSection title={t("Transcript")}>
        <Show
          when={loaded()}
          fallback={<p class="text-xs text-muted-foreground">{t("Reading words…")}</p>}
        >
          <Show
            when={words().length > 0}
            fallback={<p class="text-xs text-muted-foreground">{t("This caption has no words.")}</p>}
          >
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" class="grow basis-0" disabled={busy()} onClick={removePauses}>
                {t("Remove pauses")}
              </Button>
              <Button variant="secondary" class="grow basis-0" disabled={busy()} onClick={removeFillers}>
                {t("Remove filler words")}
              </Button>
            </div>

            <div
              class="bg-input max-h-60 overflow-y-auto rounded-md px-2 py-1.5 text-xs leading-5 text-foreground outline-none select-none focus-ring"
              tabIndex={0}
              aria-label={t("Transcript")}
              onKeyDown={(event) => {
                if (event.key !== "Backspace" && event.key !== "Delete") return;
                // The editor's own Delete would only take the words off the caption.
                event.preventDefault();
                event.stopPropagation();
                cutPicked();
              }}
            >
              <Index each={words()}>
                {(word, index) => (
                  <>
                    <span
                      class="cursor-text rounded-sm"
                      classList={{ "bg-primary/30": picked()?.has(index) ?? false }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        pick(index, event);
                        dragging = !event.shiftKey && !event.metaKey && !event.ctrlKey;
                        if (dragging) window.addEventListener("pointerup", stopDragging);
                      }}
                      onPointerEnter={() => {
                        if (dragging) pickRun(index);
                      }}
                    >
                      {word().text}
                    </span>{" "}
                  </>
                )}
              </Index>
            </div>

            <Show when={(picked()?.size ?? 0) > 0}>
              <Button variant="secondary" disabled={busy()} onClick={cutPicked}>
                {t("{count, plural, one {Cut # word from the video} other {Cut # words from the video}}", { count: picked()!.size })}
              </Button>
            </Show>
          </Show>
        </Show>
      </PanelSection>
    </Show>
  );
}
