/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript, TranscriptWord, TranscriptWordStyle } from "@plan.video/assets";

export interface ListedWord {
  /** Its place in the whole transcript: the numbering the timeline picks by. */
  position: number;
  segment: number;
  index: number;
  style?: TranscriptWordStyle;
  text: string;
  start: number;
  end: number;
  /** Seconds. */
  length: number;
  /** Longest it can run without speaking over the next word. */
  maxLength: number;
}

const MIN_LENGTH = 0.05;
const LAST_WORD_LIMIT = 30;

const round = (value: number) => Math.round(value * 100) / 100;

export function listWords(transcript: Transcript): ListedWord[] {
  const flat: Array<TranscriptWord & { segment: number; index: number }> = [];
  transcript.forEach((segment, segmentIndex) => {
    segment.words.forEach((word, index) => {
      flat.push({ ...word, segment: segmentIndex, index });
    });
  });

  return flat.map((word, position) => {
    const next = flat[position + 1];
    const length = Math.max(0, word.end - word.start);
    const room = next ? next.start - word.start : LAST_WORD_LIMIT;
    return {
      position,
      segment: word.segment,
      index: word.index,
      ...(word.style ? { style: word.style } : {}),
      text: word.text,
      start: word.start,
      end: word.end,
      length,
      maxLength: Math.max(length, room, MIN_LENGTH),
    };
  });
}

export function transcriptEnd(transcript: Transcript): number {
  let end = 0;
  for (const segment of transcript) {
    for (const word of segment.words) {
      if (word.end > end) end = word.end;
    }
  }
  return end;
}

export function editWordText(transcript: Transcript, segment: number, index: number, text: string): Transcript {
  const next = clone(transcript);
  const word = next[segment]?.words[index];
  if (!word) return transcript;
  word.text = text;
  retitle(next[segment]!);
  return next;
}

export function editWordLength(transcript: Transcript, segment: number, index: number, length: number): Transcript {
  const listed = listWords(transcript).find((word) => word.segment === segment && word.index === index);
  if (!listed) return transcript;

  const next = clone(transcript);
  const word = next[segment]?.words[index];
  if (!word) return transcript;
  const clamped = Math.min(listed.maxLength, Math.max(MIN_LENGTH, length));
  word.end = round(word.start + clamped);
  return next;
}

export function removeWord(transcript: Transcript, segmentIndex: number, index: number): Transcript {
  const next = clone(transcript);
  const segment = next[segmentIndex];
  if (!segment) return transcript;
  segment.words.splice(index, 1);
  if (segment.words.length === 0) next.splice(segmentIndex, 1);
  else retitle(segment);
  return next;
}

/** `afterPosition` -1 is the start. Later words move forward so the paste doesn't speak over them. */
export function insertWords(transcript: Transcript, afterPosition: number, words: TranscriptWord[]): Transcript {
  if (words.length === 0) return transcript;

  const copies = words.map((word) => ({
    ...word,
    ...(word.style ? { style: { ...word.style } } : {}),
  }));
  const origin = copies[0]!.start;
  const next = clone(transcript);
  const listed = listWords(next);
  const anchor = afterPosition >= 0 ? listed[afterPosition] : undefined;
  const base = anchor ? anchor.end : listed[0]?.start ?? 0;

  for (const word of copies) {
    const start = base + (word.start - origin);
    const end = base + (word.end - origin);
    word.start = round(start);
    word.end = round(Math.max(end, start + MIN_LENGTH));
  }

  const span = copies[copies.length - 1]!.end - copies[0]!.start;
  const insertAt = copies[0]!.start;
  for (const segment of next) {
    for (const word of segment.words) {
      if (word.start >= insertAt - 0.001) {
        word.start = round(word.start + span);
        word.end = round(word.end + span);
      }
    }
  }

  if (!anchor) {
    next.unshift({ text: "", words: copies });
    retitle(next[0]!);
    return next;
  }

  const segment = next[anchor.segment];
  if (!segment) return transcript;
  segment.words.splice(anchor.index + 1, 0, ...copies);
  retitle(segment);
  return next;
}

/** By their place in the whole transcript, as `listWords` and the timeline number them. */
export function removeWords(transcript: Transcript, positions: ReadonlySet<number>): Transcript {
  return filterWords(transcript, (position) => !positions.has(position));
}

export function keepWords(transcript: Transcript, positions: ReadonlySet<number>): Transcript {
  return filterWords(transcript, (position) => positions.has(position));
}

function filterWords(transcript: Transcript, keep: (position: number) => boolean): Transcript {
  let position = 0;
  const next: Transcript = [];
  for (const segment of transcript) {
    const words = segment.words.filter(() => keep(position++)).map((word) => ({ ...word }));
    if (words.length === 0) continue;
    const kept = { text: segment.text, words };
    retitle(kept);
    next.push(kept);
  }
  return next;
}

export function wordsText(transcript: Transcript, positions: ReadonlySet<number>): string {
  let position = 0;
  const picked: string[] = [];
  for (const segment of transcript) {
    for (const word of segment.words) {
      if (positions.has(position++)) picked.push(word.text);
    }
  }
  return picked.join(" ");
}

/** `[from, to)`. */
export type TimeRange = readonly [from: number, to: number];

/** Overlapping and touching ones joined, empty ones dropped. */
export function mergeRanges(ranges: ReadonlyArray<TimeRange>): TimeRange[] {
  const sorted = ranges.filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** As cutting the video does: a word said mostly inside a range goes; one only partly inside keeps the part outside. */
export function cutTranscript(transcript: Transcript, ranges: ReadonlyArray<TimeRange>): Transcript {
  const cuts = mergeRanges(ranges);
  if (cuts.length === 0) return transcript;

  // A time after a cut moves up by its length; one inside it lands on its start.
  const close = (time: number) => {
    let removed = 0;
    for (const [from, to] of cuts) {
      if (time >= to) removed += to - from;
      else if (time > from) removed += time - from;
    }
    return Math.round((time - removed) * 1000) / 1000;
  };
  const inCut = (time: number) => cuts.some(([from, to]) => time >= from && time < to);

  const next: Transcript = [];
  for (const segment of transcript) {
    const words = segment.words
      .filter((word) => !inCut((word.start + word.end) / 2))
      .map((word) => {
        const start = close(word.start);
        return { ...word, start, end: Math.max(start, close(word.end)) };
      });
    if (words.length === 0) continue;
    const kept = { text: segment.text, words };
    retitle(kept);
    next.push(kept);
  }
  return next;
}

function clone(transcript: Transcript): Transcript {
  return transcript.map((segment) => ({
    text: segment.text,
    words: segment.words.map((word) => ({ ...word })),
  }));
}

function retitle(segment: { text: string; words: TranscriptWord[] }): void {
  segment.text = segment.words.map((word) => word.text).join(" ");
}
