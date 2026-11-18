/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { soundRanges, speechEnvelope } from "@/lib/speech-timing";
import { pauseRanges } from "@/lib/transcript-cuts";

import type { Transcript } from "@plan.video/assets";

const transcript = (...times: [number, number][]): Transcript => [
  { text: "", words: times.map(([start, end], index) => ({ text: `w${index}`, start, end })) },
];

const close = (ranges: ReadonlyArray<readonly [number, number]>) => ranges.map(([from, to]) => [+from.toFixed(3), +to.toFixed(3)]);

describe("pauseRanges", () => {
  const words = transcript([0, 1], [3, 4]);

  it("cuts a gap between words, keeping a breath each side", () => {
    expect(close(pauseRanges(words))).toEqual([[1.15, 2.85]]);
  });

  it("keeps a gap the transcript missed sound in", () => {
    expect(pauseRanges(words, 0, [[0, 4]])).toEqual([]);
  });

  it("cuts only the quiet part of a gap", () => {
    expect(close(pauseRanges(words, 0, [[0, 1.05], [1.4, 2.2], [2.95, 4]]))).toEqual([[2.35, 2.8]]);
  });
});

describe("soundRanges", () => {
  const rate = 8000;
  const track = (parts: [seconds: number, level: number][]) => {
    const samples = new Float32Array(parts.reduce((sum, [seconds]) => sum + seconds * rate, 0));
    let offset = 0;
    for (const [seconds, level] of parts) {
      for (let i = 0; i < seconds * rate; i++) samples[offset + i] = level * Math.sin(i / 3);
      offset += seconds * rate;
    }
    return speechEnvelope(samples, rate);
  };

  it("finds the quiet between sounds", () => {
    expect(close(soundRanges(track([[1, 0.5], [1, 0.0005], [1, 0.5]])))).toEqual([[0, 1], [2, 3]]);
  });

  it("hears sound that never stops as one stretch", () => {
    expect(close(soundRanges(track([[1, 0.5], [1, 0.2], [1, 0.5]])))).toEqual([[0, 3]]);
  });

  it("hears nothing in a silent track", () => {
    expect(soundRanges(track([[3, 0]]))).toEqual([]);
  });
});
