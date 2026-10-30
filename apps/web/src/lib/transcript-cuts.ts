/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Finding what to cut out of a talk from its transcript: the pauses between
 * words, the "um"s, or words picked by hand. Everything here is in the
 * transcript's own seconds; turning that into a cut of the scene is
 * `caption-cut.ts`'s.
 */

import { listWords, mergeRanges, type ListedWord, type TimeRange } from "@/lib/caption-edit";

import type { Transcript } from "@plan.video/assets";

/** A gap between words longer than this is a pause worth cutting. */
export const MIN_PAUSE = 0.5;

/**
 * Seconds of quiet left on each side of a cut, so speech is not clipped and
 * the words that meet across it do not run into each other. Transcription
 * places word edges only roughly.
 */
const BREATH = 0.15;

/**
 * Sounds that are never a word of their own. Kept to ones that mean nothing
 * in any of the languages people caption in: "er" is German for "he" and
 * "em" Portuguese for "in", so neither is here.
 */
const FILLERS = new Set([
  "um", "umm", "ummm", "uh", "uhh", "uhm", "uhmm", "erm", "err", "ah", "ahh",
  "hm", "hmm", "hmmm", "mm", "mmm", "mhm", "eh", "ehh", "ehm",
  "äh", "ähm", "öhm", "euh", "heu",
]);

/** Whether a transcribed word is a filler sound, whatever its case or punctuation. */
export function isFiller(text: string): boolean {
  return FILLERS.has(text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
}

/**
 * The pauses between words, each cut down to a short breath. A pause before
 * the first word counts from `from`, where the audio starts being heard; the
 * quiet after the last word is left, since that is usually an ending.
 */
export function pauseRanges(transcript: Transcript, from = 0): TimeRange[] {
  const words = listWords(transcript);
  const ranges: TimeRange[] = [];

  const first = words[0];
  if (first && first.start - from > MIN_PAUSE) ranges.push([from, first.start - BREATH]);

  for (let index = 1; index < words.length; index++) {
    const before = words[index - 1]!;
    const after = words[index]!;
    if (after.start - before.end > MIN_PAUSE) ranges.push([before.end + BREATH, after.start - BREATH]);
  }
  return mergeRanges(ranges);
}

/** Every filler word, with the quiet around it closed up the way a pause is. */
export function fillerRanges(transcript: Transcript): TimeRange[] {
  const words = listWords(transcript);
  return mergeRanges(
    words.flatMap((word, index) => (isFiller(word.text) ? [runRange(words, index, index)] : [])),
  );
}

/** The words at `positions` (`listWords` numbering), each run of neighbours as one cut. */
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

/**
 * The words `first` to `last`, plus the quiet either side of them beyond a
 * breath, so what was said before and after meets as if they never were.
 */
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
