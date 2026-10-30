/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The words of a <captions> element, for the editor's AI: what is said and
// when, in scene time, and each word's own look. Edits go through the same
// stand-in `<text>` the word inspector edits (see `createWordProxy`), so a
// word can take anything a text can, and land as one undo step.

import { isUrlSource, type Asset, type AssetLibrary, type Transcript, type TranscriptWord, type TranscriptWordStyle } from "@plan.video/assets";
import { renderAuthored } from "@plan.video/reconciler";
import {
  Animation,
  AssetId,
  Computed,
  Effect,
  FrameRate,
  Library,
  Paint,
  Shadow,
  Stroke,
  getEntityChildren,
  isCaption,
  resolveTranscript,
  store,
} from "@plan.video/runtime";

import { getDocumentEditor } from "@/engine/editor";
import { getEditHistory } from "@/engine/history";
import { listWords, removeWords } from "@/lib/caption-edit";
import { saveCaptionTranscript } from "@/lib/caption-transcript";
import { createWordProxy, disposeWordProxy, readLook, restyleWord } from "@/lib/caption-word-style";

import type { AuthoredTree } from "@plan.video/reconciler";
import type { Entity, World } from "koota";

const round = (value: number): number => Math.round(value * 1000) / 1000;
const hex = (color: number): string => `#${color.toString(16).padStart(6, "0").toUpperCase()}`;

type CaptionFile = { library: AssetLibrary; asset: Asset; transcript: Transcript; offset: number };

/** The caption's transcript, and the scene time its time 0 is heard at. */
async function captionFile(world: World, caption: Entity): Promise<CaptionFile> {
  if (!isCaption(caption)) throw new Error("That element is not a <captions>.");
  const library = world.get(Library);
  const assetId = caption.get(AssetId)?.value;
  const asset = assetId ? library?.get(assetId) : undefined;
  if (!library || !asset) throw new Error("These captions have no words yet. Wait for transcription to finish, then try again.");
  if (asset.type !== "TRANSCRIPT" || isUrlSource(asset.source)) throw new Error("These captions read a transcript that is not a file in the project, so their words can't be edited.");
  const transcript = await resolveTranscript(asset);
  const fps = world.get(FrameRate)?.value || 30;
  const offset = (store(world, Computed).origin[caption.id()] ?? 0) / fps;
  return { library, asset, transcript, offset };
}

/** A word's own look, readably: what is left out is the caption's. */
function describeStyle(style: TranscriptWordStyle | undefined): Record<string, unknown> | undefined {
  if (!style) return undefined;
  const out: Record<string, unknown> = {};
  if (style.text && Object.keys(style.text).length) out.text = style.text;
  if (style.color !== undefined) out.color = hex(style.color);
  if (style.opacity !== undefined) out.opacity = style.opacity;
  if (style.hidden) out.hidden = true;
  if (style.offsetX !== undefined) out.offsetX = style.offsetX;
  if (style.offsetY !== undefined) out.offsetY = style.offsetY;
  const own = (["fills", "strokes", "shadows", "effects", "animations"] as const).filter((kind) => style[kind] !== undefined);
  if (own.length) out.own = own;
  return Object.keys(out).length ? out : undefined;
}

export async function readCaptionWords(world: World, caption: Entity): Promise<unknown> {
  const { transcript, offset } = await captionFile(world, caption);
  return {
    words: listWords(transcript).map((word) => ({
      index: word.position,
      text: word.text,
      start: round(word.start + offset),
      end: round(word.end + offset),
      ...(describeStyle(word.style) ? { style: describeStyle(word.style) } : {}),
    })),
  };
}

// --- styling ---------------------------------------------------------------

type LayerKind = "fills" | "strokes" | "shadows" | "effects" | "animations";

/** Which of a word's layer lists an authored child belongs to. */
function kindOfTag(tag: string): LayerKind | null {
  if (tag === "stroke") return "strokes";
  if (tag === "shadow") return "shadows";
  if (tag === "effect") return "effects";
  if (tag === "animation") return "animations";
  if (/Paint$/.test(tag)) return "fills";
  return null;
}

function kindOfEntity(entity: Entity): LayerKind | null {
  if (entity.has(Stroke)) return "strokes";
  if (entity.has(Shadow)) return "shadows";
  if (entity.has(Effect)) return "effects";
  if (entity.has(Animation)) return "animations";
  if (entity.has(Paint)) return "fills";
  return null;
}

export type WordStyleInput = {
  /** Text props: color, fontFamily, fontWeight, fontSize, opacity, offsetX, hidden, … */
  props?: Record<string, unknown>;
  /** stroke, shadow, effect, animation and paint elements. Each kind given replaces the word's list of it. */
  children?: AuthoredTree[];
  /** Layer kinds to take off the word, so it shows the caption's again. */
  clear?: LayerKind[];
};

/**
 * `style` with `input` applied, the way the word inspector applies a panel
 * edit: on a stand-in that looks like the word, keeping only what differs
 * from the caption.
 */
function restyle(world: World, caption: Entity, word: TranscriptWord, input: WordStyleInput): TranscriptWordStyle | undefined {
  const editor = getDocumentEditor(world);
  const proxy = createWordProxy(world, caption, word.style, word.text);
  const release = editor.aside(proxy, () => undefined);
  try {
    const before = readLook(world, proxy);

    for (const [key, value] of Object.entries(input.props ?? {})) {
      if (key === "children" || key === "text") continue;
      editor.editProperty(proxy, key, value as never);
    }

    const children = input.children ?? [];
    const replaced = new Set<LayerKind>(input.clear ?? []);
    for (const child of children) {
      const kind = kindOfTag(child.tag);
      if (!kind) throw new Error(`<${child.tag}> can't style a caption word. Use stroke, shadow, effect, animation or a paint.`);
      replaced.add(kind);
    }
    const stale = getEntityChildren(world, proxy).filter((child) => {
      const kind = kindOfEntity(child);
      return kind !== null && replaced.has(kind);
    });
    if (stale.length) editor.remove(stale);
    if (children.length) editor.insertElement(proxy, () => children.map(renderAuthored));

    const after = readLook(world, proxy);
    return restyleWord(word.style, before, after, readLook(world, caption, true));
  } finally {
    release();
    disposeWordProxy(proxy);
  }
}

// --- editing ---------------------------------------------------------------

export type WordEdit = {
  index: number;
  text?: string;
  start?: number;
  end?: number;
  style?: WordStyleInput;
  /** Drops the word's own look before `style` applies. */
  reset?: boolean;
};

/** A new word, placed among the others by its own time. Times are scene seconds. */
export type WordInsert = { text: string; start: number; end: number };

export type CaptionWordsInput = {
  edits?: WordEdit[];
  remove?: number[];
  insert?: WordInsert[];
};

/** Applies `input` to the caption's words as the current undo step, and saves them. */
export async function editCaptionWords(world: World, caption: Entity, input: CaptionWordsInput): Promise<string> {
  const { library, asset, transcript, offset } = await captionFile(world, caption);
  const count = listWords(transcript).length;
  const checkIndex = (index: unknown): number => {
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`No word ${JSON.stringify(index)}. These captions have words 0–${count - 1}; call get_caption_words.`);
    }
    return index;
  };

  // Edits address words as they are now, so they land before anything moves.
  let next: Transcript = transcript.map((segment) => ({ text: segment.text, words: segment.words.map((word) => ({ ...word })) }));
  const flat = next.flatMap((segment) => segment.words);
  for (const edit of input.edits ?? []) {
    const word = flat[checkIndex(edit.index)]!;
    if (typeof edit.text === "string" && edit.text.trim()) word.text = edit.text.trim();
    if (typeof edit.start === "number") word.start = Math.max(0, edit.start - offset);
    if (typeof edit.end === "number") word.end = Math.max(word.start, edit.end - offset);
    if (edit.reset) delete word.style;
    if (edit.style) {
      const style = restyle(world, caption, word, edit.style);
      if (style) word.style = style;
      else delete word.style;
    }
  }
  for (const segment of next) segment.text = segment.words.map((word) => word.text).join(" ");

  // Removals name words as they were read, like edits; inserts come last.
  const removed = new Set((input.remove ?? []).map(checkIndex));
  if (removed.size) next = removeWords(next, removed);

  const added = (input.insert ?? [])
    .filter((word) => typeof word.text === "string" && word.text.trim() && typeof word.start === "number" && typeof word.end === "number")
    .map((word) => {
      const start = Math.max(0, word.start - offset);
      return { text: word.text.trim(), start, end: Math.max(start, word.end - offset) };
    });
  for (const word of added) next = placeWord(next, word);

  const history = getEditHistory(world);
  history.beginGesture();
  try {
    history.recordTranscript(asset.id, transcript, next);
  } finally {
    history.endGesture();
  }
  await saveCaptionTranscript(world, library, asset, next);

  const parts = [
    input.edits?.length ? `edited ${input.edits.length}` : "",
    removed.size ? `removed ${removed.size}` : "",
    added.length ? `inserted ${added.length}` : "",
  ].filter(Boolean);
  return parts.length ? `Caption words ${parts.join(", ")}.` : "Nothing to change.";
}

/** `word` put in among the others by its start, in the sentence of the word before it. Nothing else moves. */
function placeWord(transcript: Transcript, word: TranscriptWord): Transcript {
  const next = transcript.map((segment) => ({ text: segment.text, words: [...segment.words] }));
  let segment = -1;
  let index = -1;
  next.forEach((candidate, s) => {
    candidate.words.forEach((other, i) => {
      if (other.start <= word.start) {
        segment = s;
        index = i;
      }
    });
  });

  if (segment === -1) {
    if (next.length === 0) next.push({ text: "", words: [] });
    next[0]!.words.unshift(word);
    segment = 0;
  } else {
    next[segment]!.words.splice(index + 1, 0, word);
  }
  next[segment]!.text = next[segment]!.words.map((w) => w.text).join(" ");
  return next;
}
