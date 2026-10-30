/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { Caption, Offset, isStyledWord } from "@plan.video/runtime";
import { toast } from "somoto";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import { useDerived, useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import { listWords, removeWords } from "@/lib/caption-edit";
import { moveWordsToLayer } from "@/lib/caption-transcript";
import { t } from "@/lib/i18n";
import {
  createWordProxy,
  disposeWordProxy,
  mixedSettings,
  readLook,
  restyleWord,
  restyleWords,
  wordLook,
  type WordLook,
} from "@/lib/caption-word-style";
import { useCaptionTranscript } from "./use-caption-transcript";
import { CaptionSettings } from "./caption-settings";
import { TextPanel } from "./text";
import { SourceSettings } from "./source";
import { StrokesSettings } from "./strokes";
import { ShadowsSettings } from "./shadows";
import { AppearanceSettings } from "./appearance";
import { EffectsSettings } from "./effects";
import { AnimationsSettings } from "./animations";
import { useMixed, WordMixProvider } from "./word-mix";

import type { Entity } from "koota";

/** Edits this close together are one change to the words. */
const SETTLE_MS = 60;

type CaptionWordStyleProps = {
  entity: Entity;
  indices: ReadonlySet<number>;
};

/**
 * The inspector while words are picked on the timeline: the same panels a
 * text has, and every change lands on the picked words only. The panels
 * edit a stand-in `<text>` that looks like the words (see `createWordProxy`);
 * what changes on it is written into each word's style. With several words
 * picked, only what was changed is written, so each keeps the rest of its own.
 */
export function CaptionWordStyle(props: CaptionWordStyleProps) {
  const world = useWorld();
  const editor = useEditor();
  const library = useLibrary();
  const { asset, transcript, loaded, commit } = useCaptionTranscript(() => props.entity);
  const caption = useTrait(() => props.entity, Caption);
  const [proxy, setProxy] = createSignal<Entity>();
  const [moving, setMoving] = createSignal(false);

  const picked = createMemo(() => listWords(transcript() ?? []).filter((word) => props.indices.has(word.position)));
  const styled = () => picked().some((word) => isStyledWord(word.style));
  const mixed = createMemo(() => {
    // Read again when the words change: the caption may have been restyled too.
    const caption = readLook(world, props.entity, true);
    return mixedSettings(picked().map((word) => wordLook(word.style, caption)));
  });

  let before: WordLook | undefined;
  /**
   * The stand-in as the last edit left it. Read when the edit lands rather
   * than when it is written: a picker previews on the traits alone, and a
   * preview is not a choice.
   */
  let edited: WordLook | undefined;
  let release: (() => void) | undefined;
  let timer = 0;

  const flush = () => {
    window.clearTimeout(timer);
    const current = untrack(transcript);
    if (!current || !before || !edited) return;

    const from = before;
    const after = edited;
    before = after;
    edited = undefined;
    const caption = readLook(world, props.entity, true);
    commit(restyleWords(current, props.indices, (style) => restyleWord(style, from, after, caption)));
  };

  const build = () => {
    const words = untrack(picked);
    if (words.length === 0) return;
    const stand = createWordProxy(world, props.entity, words[0]!.style, words.map((word) => word.text).join(" "));
    before = readLook(world, stand);
    edited = undefined;
    release = editor.aside(stand, () => {
      edited = readLook(world, stand);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, SETTLE_MS);
    });
    setProxy(stand);
  };

  const drop = () => {
    window.clearTimeout(timer);
    release?.();
    release = undefined;
    const stand = untrack(proxy);
    if (stand) disposeWordProxy(stand);
    setProxy(undefined);
  };

  createEffect(() => {
    if (!loaded() || picked().length === 0) return;
    caption()?.type;
    caption()?.colors;
    untrack(() => {
      if (proxy()) {
        flush();
        drop();
      }
      build();
    });
  });

  const reset = () => {
    const current = transcript();
    if (!current) return;
    drop();
    commit(restyleWords(current, props.indices, () => undefined), true);
    if (!untrack(proxy)) build();
  };

  const moveToLayer = async () => {
    flush();
    const current = untrack(transcript);
    const file = asset();
    const lib = library();
    if (!current || !file || !lib || moving()) return;

    const positions = props.indices;
    setMoving(true);
    let copy: Entity | null = null;
    try {
      copy = await moveWordsToLayer(world, lib, props.entity, file, current, positions);
    } catch {
      copy = null;
    } finally {
      setMoving(false);
    }
    if (!copy) {
      toast.error(t("Could not move the words"));
      return;
    }
    commit(removeWords(current, positions), true);
  };

  onCleanup(() => {
    flush();
    drop();
  });

  return (
    <>
      <div class="flex h-10 items-center gap-1.5 px-4 text-xs">
        <span class="shrink-0 font-450">{picked().length > 1 ? t("{count, plural, one {# word} other {# words}}", { count: picked().length }) : t("Word")}</span>
        <span class="min-w-0 truncate text-muted-foreground">{picked().map((word) => word.text).join(" ")}</span>
        <button
          type="button"
          class="ml-auto h-7 shrink-0 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          style={{ cursor: "pointer" }}
          title={t("Move these words to a layer of their own, with masks and animations of its own")}
          disabled={moving() || !loaded()}
          onClick={() => void moveToLayer()}
        >
          {t("New layer")}
        </button>
        <Show when={styled()}>
          <button
            type="button"
            class="h-7 shrink-0 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            style={{ cursor: "pointer" }}
            title={t("Use the caption's style")}
            onClick={reset}
          >
            {t("Reset")}
          </button>
        </Show>
      </div>

      <CaptionSettings selection={[props.entity]} />

      <Show when={loaded()} fallback={<p class="px-4 text-xs text-muted-foreground">{t("Reading words…")}</p>}>
        <Show
          when={proxy()}
          keyed
          fallback={
            <Show when={picked().length === 0}>
              <p class="px-4 text-xs text-muted-foreground">{t("These words are gone.")}</p>
            </Show>
          }
        >
          {(stand) => (
            <WordMixProvider value={mixed}>
              <WordPosition node={stand} />
              <TextPanel selection={[stand]} words />
              <AppearanceSettings selection={[stand]} words />
              <SourceSettings selection={[stand]} words />
              <StrokesSettings selection={[stand]} />
              <ShadowsSettings selection={[stand]} />
              <EffectsSettings selection={[stand]} />
              <AnimationsSettings selection={[stand]} words />
            </WordMixProvider>
          )}
        </Show>
      </Show>
    </>
  );
}

/** X/Y of the picked words, stored as each word's own offset. */
function WordPosition(props: { node: Entity }) {
  const editor = useEditor();
  const mixed = useMixed();
  const offsetX = useDerived(() => props.node.get(Offset)?.x ?? 0);
  const offsetY = useDerived(() => props.node.get(Offset)?.y ?? 0);

  return (
    <PanelSection title={t("Position")}>
      <ControlRow label={t("Position")} contentClass="grid grid-cols-2 gap-2">
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={mixed("offsetX") ? t("Mixed") : offsetX()}
          onNumber={(x) => editor.editProperty(props.node, "offsetX", x === 0 ? false : x)}
          step={1}
          autoSelect
          sliderEnabled
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={mixed("offsetY") ? t("Mixed") : offsetY()}
          onNumber={(y) => editor.editProperty(props.node, "offsetY", y === 0 ? false : y)}
          step={1}
          autoSelect
          sliderEnabled
        />
      </ControlRow>
    </PanelSection>
  );
}
