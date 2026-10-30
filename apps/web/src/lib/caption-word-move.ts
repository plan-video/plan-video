/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isUrlSource, type Asset, type AssetLibrary, type Transcript, type TranscriptWord, type TranscriptWordStyle } from "@plan.video/assets";
import {
  AssetId,
  Cache,
  Computed,
  Library,
  Offset,
  TextCache,
  WordTiming,
  entityWorldMat,
  invert2D,
  isCaption,
  isStyledWord,
  resolveCaptionDecoder,
  resolveTranscript,
  store,
  transformPoint,
} from "@plan.video/runtime";

import { getDocumentEditor } from "@/engine/editor";
import { getEditHistory } from "@/engine/history";
import { captionWordSelection, setCaptionWordSelection } from "@/engine/timeline/caption-word-selection";
import { saveCaptionTranscript } from "@/lib/caption-transcript";

import type { Entity, World } from "koota";

type WordOffset = { x: number; y: number };

type WordMove = {
  caption: Entity;
  indices: ReadonlySet<number>;
  origin: Map<number, WordOffset>;
  dirty: boolean;
};

let move: WordMove | null = null;

function captionFile(world: World, entity: Entity): { library: AssetLibrary; asset: Asset } | null {
  if (!entity.isAlive() || !isCaption(entity)) return null;
  const library = world.get(Library);
  const assetId = entity.get(AssetId)?.value;
  const asset = assetId ? library?.get(assetId) : undefined;
  if (!library || !asset || asset.type !== "TRANSCRIPT" || isUrlSource(asset.source)) return null;
  return { library, asset };
}

function listedWords(world: World, caption: Entity): TranscriptWord[] {
  return resolveCaptionDecoder(world, caption)?.groups.flat() ?? [];
}

function pickedOn(caption: Entity): ReadonlySet<number> | null {
  const picked = captionWordSelection();
  if (!picked || picked.entity !== caption || picked.indices.size === 0) return null;
  return picked.indices;
}

function offsetOf(word: TranscriptWord | undefined): WordOffset {
  return { x: word?.style?.offsetX ?? 0, y: word?.style?.offsetY ?? 0 };
}

function roundOffset(offset: WordOffset): WordOffset {
  return { x: Math.round(offset.x), y: Math.round(offset.y) };
}

function shifted(origin: ReadonlyMap<number, WordOffset>, delta: WordOffset): Map<number, WordOffset> {
  const next = new Map<number, WordOffset>();
  for (const [index, start] of origin) {
    next.set(index, roundOffset({ x: start.x + delta.x, y: start.y + delta.y }));
  }
  return next;
}

function sameOffset(a: WordOffset, b: WordOffset): boolean {
  return a.x === b.x && a.y === b.y;
}

function writeStyle(word: TranscriptWord, offset: WordOffset): void {
  const next: TranscriptWordStyle = { ...word.style };
  if (offset.x !== 0) next.offsetX = offset.x;
  else delete next.offsetX;
  if (offset.y !== 0) next.offsetY = offset.y;
  else delete next.offsetY;
  if (isStyledWord(next)) word.style = next;
  else delete word.style;
}

function rangeForWord(ranges: readonly Entity[], word: TranscriptWord): Entity | undefined {
  return ranges.find((range) => {
    const timing = range.get(WordTiming);
    return timing !== undefined && timing.start === word.start && timing.end === word.end;
  });
}

/** Puts `offsets` on the spoken words and on the ranges that are drawn now. */
function applyOffsets(world: World, caption: Entity, offsets: ReadonlyMap<number, WordOffset>): void {
  const words = listedWords(world, caption);
  const ranges = caption.get(Cache)?.textRanges ?? [];

  for (const [index, offset] of offsets) {
    const word = words[index];
    if (!word) continue;
    writeStyle(word, offset);
    const range = rangeForWord(ranges, word);
    if (!range) continue;
    range.add(Offset);
    range.set(Offset, offset);
  }
}

function offsetWords(transcript: Transcript, offsets: ReadonlyMap<number, WordOffset>): Transcript {
  let position = 0;
  return transcript.map((segment) => ({
    text: segment.text,
    words: segment.words.map((word) => {
      const offset = offsets.get(position++);
      if (!offset) return { ...word };
      const next: TranscriptWordStyle = { ...word.style };
      if (offset.x !== 0) next.offsetX = offset.x;
      else delete next.offsetX;
      if (offset.y !== 0) next.offsetY = offset.y;
      else delete next.offsetY;
      const copy = { ...word };
      if (isStyledWord(next)) copy.style = next;
      else delete copy.style;
      return copy;
    }),
  }));
}

function persistOffsets(world: World, caption: Entity, offsets: ReadonlyMap<number, WordOffset>): void {
  const file = captionFile(world, caption);
  if (!file) return;

  void (async () => {
    let transcript: Transcript;
    try {
      transcript = await resolveTranscript(file.asset);
    } catch {
      return;
    }
    const next = offsetWords(transcript, offsets);
    getEditHistory(world).recordTranscript(file.asset.id, transcript, next);
    await saveCaptionTranscript(world, file.library, file.asset, next);
  })();
}

function pointerInCaption(world: World, caption: Entity, clientX: number, clientY: number) {
  return transformPoint(invert2D(entityWorldMat(world, caption)), clientX, clientY);
}

/** The spoken word under the pointer, or null when the press missed the glyphs. */
function pickCaptionWordAt(world: World, caption: Entity, clientX: number, clientY: number): number | null {
  const lines = caption.get(TextCache)?.tokens ?? [];
  if (lines.length === 0) return null;

  const local = pointerInCaption(world, caption, clientX, clientY);
  const computed = store(world, Computed);
  const words = listedWords(world, caption);

  for (const line of lines) {
    for (const token of line) {
      let range: Entity | undefined;
      for (const candidate of token.ranges) {
        if (candidate.has(WordTiming)) range = candidate;
      }
      const ox = range ? (computed.offsetX[range.id()] ?? 0) : 0;
      const oy = range ? (computed.offsetY[range.id()] ?? 0) : 0;
      if (local.x < token.left + ox || local.x > token.right + ox) continue;
      if (local.y < token.top + oy || local.y > token.bottom + oy) continue;

      if (range) {
        const timing = range.get(WordTiming)!;
        const index = words.findIndex((word) => word.start === timing.start && word.end === timing.end);
        if (index >= 0) return index;
      }
      const index = words.findIndex((word) => word.text === token.chars);
      if (index >= 0) return index;
    }
  }
  return null;
}

function pickWordsForMove(world: World, caption: Entity, clientX: number, clientY: number): ReadonlySet<number> | null {
  const picked = pickedOn(caption);
  const hit = pickCaptionWordAt(world, caption, clientX, clientY);
  if (hit !== null && (!picked || !picked.has(hit))) {
    getDocumentEditor(world).clearSelection();
    setCaptionWordSelection(caption, [hit]);
    return new Set([hit]);
  }
  return picked;
}

function dragDelta(world: World, caption: Entity, clientX: number, clientY: number, originX: number, originY: number): WordOffset {
  const current = pointerInCaption(world, caption, clientX, clientY);
  const origin = pointerInCaption(world, caption, originX, originY);
  return { x: current.x - origin.x, y: current.y - origin.y };
}

/**
 * Starts a canvas move of the words picked on `caption`. False when this
 * press is a move of the captions layer itself.
 */
export function beginCaptionWordMove(world: World, caption: Entity, clientX: number, clientY: number): boolean {
  if (!caption.isAlive() || !isCaption(caption)) return false;
  const indices = pickWordsForMove(world, caption, clientX, clientY);
  if (!indices) return false;

  const words = listedWords(world, caption);
  const origin = new Map<number, WordOffset>();
  for (const index of indices) origin.set(index, offsetOf(words[index]));

  move = { caption, indices, origin, dirty: false };
  return true;
}

/** Drags the picked words in the caption's local space. */
export function dragCaptionWords(world: World, clientX: number, clientY: number, originX: number, originY: number): boolean {
  if (!move || !move.caption.isAlive()) return false;
  const delta = dragDelta(world, move.caption, clientX, clientY, originX, originY);
  const offsets = shifted(move.origin, delta);
  let dirty = false;
  for (const [index, offset] of offsets) {
    if (!sameOffset(offset, move.origin.get(index) ?? { x: 0, y: 0 })) dirty = true;
  }
  move.dirty = dirty;
  applyOffsets(world, move.caption, offsets);
  return true;
}

/** Writes the moved words into the transcript. */
export function endCaptionWordMove(world: World): boolean {
  const pending = move;
  move = null;
  if (!pending || !pending.caption.isAlive()) return false;
  if (!pending.dirty) return true;

  const words = listedWords(world, pending.caption);
  const offsets = new Map<number, WordOffset>();
  for (const index of pending.indices) offsets.set(index, offsetOf(words[index]));
  persistOffsets(world, pending.caption, offsets);
  return true;
}

/** Whether a canvas gesture is currently moving picked caption words. */
export function isCaptionWordMove(): boolean {
  return move !== null;
}

/**
 * Nudges the picked words by `dx`, `dy`. False when no words are picked,
 * so the caller can nudge the selected nodes instead.
 */
export function nudgeCaptionWords(world: World, dx: number, dy: number): boolean {
  const picked = captionWordSelection();
  if (!picked || !picked.entity.isAlive() || picked.indices.size === 0) return false;

  const words = listedWords(world, picked.entity);
  const origin = new Map<number, WordOffset>();
  for (const index of picked.indices) origin.set(index, offsetOf(words[index]));
  const offsets = shifted(origin, { x: dx, y: dy });
  applyOffsets(world, picked.entity, offsets);
  persistOffsets(world, picked.entity, offsets);
  return true;
}
