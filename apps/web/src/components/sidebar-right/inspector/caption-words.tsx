/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Index, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import {
  Computed,
  FontStyle,
  FrameRate,
  colorToHex,
  getSceneAncestor,
  setPlayhead,
  store,
} from "@plan.video/runtime";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { editWordLength, editWordText, listWords, removeWord, type ListedWord } from "@/lib/caption-edit";
import { captionWordSelection, setCaptionWordSelection } from "@/engine/timeline/caption-word-selection";
import { t } from "@/lib/i18n";
import { useCaptionTranscript } from "./use-caption-transcript";

import type { TranscriptWordStyle } from "@plan.video/assets";

import type { Entity } from "koota";

type CaptionWordsProps = {
  selection: Entity[];
};

/**
 * The caption's words. Each row is one word: its text, how long it stays
 * on screen, and a way to take it out.
 */
export function CaptionWords(props: CaptionWordsProps) {
  const world = useWorld();
  const entity = () => props.selection[0]!;
  const { asset, transcript, loaded, commit } = useCaptionTranscript(entity);

  const words = createMemo(() => listWords(transcript() ?? []));
  const picked = createMemo(() => {
    const selection = captionWordSelection();
    if (!selection || selection.entity !== entity()) return null;
    return selection.indices;
  });

  const show = (word: ListedWord) => {
    const scene = getSceneAncestor(entity());
    if (!scene) return;
    const fps = world.get(FrameRate)?.value ?? 30;
    const origin = store(world, Computed).origin[entity().id()] ?? 0;
    setPlayhead(world, scene, origin + word.start * fps);
  };

  return (
    <Show when={asset()}>
      <PanelSection title={t("Words")} class="max-h-80 overflow-y-auto">
        <Show
          when={loaded()}
          fallback={<p class="text-xs text-muted-foreground">{t("Reading words…")}</p>}
        >
          <Show
            when={words().length > 0}
            fallback={<p class="text-xs text-muted-foreground">{t("This caption has no words.")}</p>}
          >
            <Index each={words()}>
              {(word, index) => (
                <WordRow
                  selected={picked()?.has(index) ?? false}
                  text={word().text}
                  style={word().style}
                  length={word().length}
                  maxLength={word().maxLength}
                  onFocus={() => {
                    show(word());
                    setCaptionWordSelection(entity(), [index]);
                  }}
                  onText={(text) => {
                    const current = transcript();
                    const item = word();
                    if (!current) return;
                    commit(editWordText(current, item.segment, item.index, text));
                  }}
                  onLength={(length) => {
                    const current = transcript();
                    const item = word();
                    if (!current) return;
                    show(item);
                    commit(editWordLength(current, item.segment, item.index, length));
                  }}
                  onRemove={() => {
                    const current = transcript();
                    const item = word();
                    if (!current) return;
                    commit(removeWord(current, item.segment, item.index));
                  }}
                />
              )}
            </Index>
          </Show>
        </Show>
      </PanelSection>
    </Show>
  );
}

type WordRowProps = {
  selected: boolean;
  text: string;
  style?: TranscriptWordStyle | undefined;
  length: number;
  maxLength: number;
  onText: (text: string) => void;
  onLength: (length: number) => void;
  onRemove: () => void;
  onFocus: () => void;
};

function WordRow(props: WordRowProps) {
  let row: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;
  const [draft, setDraft] = createSignal(props.text);

  createEffect(() => {
    if (!props.selected) return;
    row?.scrollIntoView({ block: "nearest" });
  });

  createEffect(() => {
    const next = props.text;
    if (input && document.activeElement === input) return;
    setDraft(next);
  });

  const canShrink = () => props.length > 0.05 + 0.001;
  const canGrow = () => props.length < props.maxLength - 0.001;

  return (
    <div
      ref={row}
      class="relative flex items-center gap-1 rounded-md"
      classList={{ "bg-accent": props.selected }}
    >
      <Show when={props.style?.color !== undefined}>
        <span
          class="pointer-events-none absolute left-2 top-1/2 size-2 -translate-y-1/2 rounded-full"
          style={{ "background-color": colorToHex(props.style!.color!) }}
        />
      </Show>
      <input
        ref={input}
        class="bg-input h-7 min-w-0 flex-1 rounded-md px-2 text-xs text-foreground outline-none focus-ring"
        classList={{ "pl-5": props.style?.color !== undefined }}
        style={{
          "font-weight": props.style?.text?.fontWeight,
          "font-style": props.style?.text?.fontStyle === FontStyle.ITALIC ? "italic" : undefined,
        }}
        value={draft()}
        onFocus={() => props.onFocus()}
        onInput={(event) => {
          const text = event.currentTarget.value;
          setDraft(text);
          props.onText(text);
        }}
      />
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        disabled={!canShrink()}
        title={t("Shorter")}
        aria-label={t("Make this word shorter")}
        onClick={() => props.onLength(props.length - 0.1)}
      >
        <Icon name="minus" />
      </button>
      <span class="w-8 shrink-0 text-center text-xxs tabular-nums text-muted-foreground">
        {props.length.toFixed(1)}
      </span>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        disabled={!canGrow()}
        title={t("Longer")}
        aria-label={t("Make this word longer")}
        onClick={() => props.onLength(props.length + 0.1)}
      >
        <Icon name="plus-add-small" />
      </button>
      <button
        type="button"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        title={t("Remove")}
        aria-label={t("Remove word")}
        onClick={() => props.onRemove()}
      >
        <Icon name="close-remove-small" />
      </button>
    </div>
  );
}
