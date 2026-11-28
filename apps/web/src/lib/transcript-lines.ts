/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript, TranscriptWord } from "@plan.video/assets";

const PAUSE_SECONDS = 0.45;

/** Lines broken at pauses and sentence ends, as captions read them. */
export function segmentWords(words: TranscriptWord[]): Transcript {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Transcript = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({ text: current.map((word) => word.text).join(" "), words: current });
    current = [];
  };

  for (const word of sorted) {
    const previous = current[current.length - 1];
    if (previous && word.start - previous.end > PAUSE_SECONDS) flush();
    current.push(word);
    if (/[.!?]$/.test(word.text)) flush();
  }

  flush();
  return segments;
}
