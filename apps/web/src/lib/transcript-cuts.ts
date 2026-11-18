/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Everything here is in the transcript's own seconds; `caption-cut.ts` turns it into scene cuts.

import { listWords, mergeRanges, type ListedWord, type TimeRange } from "@/lib/caption-edit";

import type { Transcript } from "@plan.video/assets";

export const MIN_PAUSE = 0.5;

/** Quiet left each side of a cut: transcription places word edges only roughly. */
const BREATH = 0.15;

/** Only sounds that mean nothing in any caption language: "er" is German for "he", "em" Portuguese for "in". */
const FILLERS = new Set([
  "um", "umm", "ummm", "uh", "uhh", "uhm", "uhmm", "erm", "err", "ah", "ahh",
  "hm", "hmm", "hmmm", "mm", "mmm", "mhm", "eh", "ehh", "ehm",
  "äh", "ähm", "öhm", "euh", "heu",
]);

export function isFiller(text: string): boolean {
  return FILLERS.has(text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
}

/**
 * A pause before the first word counts from `from`, where the audio starts; the quiet
 * after the last word is left, as that is usually an ending. With `sound`, where something
 * can be heard, only the quiet in a gap is a pause: the transcript misses laughs, music,
 * other voices and words it couldn't make out.
 */
export function pauseRanges(transcript: Transcript, from = 0, sound?: ReadonlyArray<TimeRange>): TimeRange[] {
  const words = listWords(transcript);
  const gaps: TimeRange[] = [];
  const first = words[0];
  if (first && first.start > from) gaps.push([from, first.start]);
  for (let index = 1; index < words.length; index++) {
    const before = words[index - 1]!;
    const after = words[index]!;
    if (after.start > before.end) gaps.push([before.end, after.start]);
  }

  const ranges: TimeRange[] = [];
  for (const gap of gaps) {
    for (const [start, end] of sound ? subtract(gap, sound) : [gap]) {
      if (end - start > MIN_PAUSE) ranges.push([start === from ? start : start + BREATH, end - BREATH]);
    }
  }
  return mergeRanges(ranges);
}

function subtract([from, to]: TimeRange, ranges: ReadonlyArray<TimeRange>): TimeRange[] {
  const left: TimeRange[] = [];
  let cursor = from;
  for (const [start, end] of mergeRanges(ranges)) {
    if (end <= cursor) continue;
    if (start >= to) break;
    if (start > cursor) left.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (to > cursor) left.push([cursor, to]);
  return left;
}

export function fillerRanges(transcript: Transcript): TimeRange[] {
  const words = listWords(transcript);
  return mergeRanges(
    words.flatMap((word, index) => (isFiller(word.text) ? [runRange(words, index, index)] : [])),
  );
}

/** `positions` use `listWords` numbering; each run of neighbours is one cut. */
export function wordRanges(transcript: Transcript, positions: ReadonlySet<number>): TimeRange[] {
  const words = listWords(transcript);
  const ranges: TimeRange[] = [];
  let index = 0;
  while (index < words.length) {
    if (!positions.has(index)) {
      index++;
      continue;
    }
    const first = index;
    while (index + 1 < words.length && positions.has(index + 1)) index++;
    ranges.push(runRange(words, first, index));
    index++;
  }
  return mergeRanges(ranges);
}

function runRange(words: ListedWord[], first: number, last: number): TimeRange {
  const before = words[first - 1];
  const after = words[last + 1];
  const start = words[first]!.start;
  const end = words[last]!.end;
  return [
    before ? Math.max(before.end, Math.min(start, before.end + BREATH)) : start,
    after ? Math.min(after.start, Math.max(end, after.start - BREATH)) : end,
  ];
}
