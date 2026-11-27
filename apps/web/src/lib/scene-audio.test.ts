/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { oncePerMoment } from "@/lib/scene-audio";

const clip = (source: string, origin: number, trimStart: number, trimEnd: number, rate = 1) => ({ source, origin, rate, trimStart, trimEnd });

describe("oncePerMoment", () => {
  it("reads a layout's copy of a video once", () => {
    expect(oncePerMoment([clip("game", 0, 0, 17), clip("game", 0, 0, 17)])).toEqual([clip("game", 0, 0, 17)]);
  });

  it("covers both when the copy was trimmed differently", () => {
    expect(oncePerMoment([clip("game", 0, 2, 10), clip("game", 0, 8, 15)])).toEqual([clip("game", 0, 2, 15)]);
  });

  it("keeps the same video placed twice at different times", () => {
    expect(oncePerMoment([clip("game", 0, 0, 5), clip("game", 10, 0, 5)])).toHaveLength(2);
  });

  it("keeps different videos and different speeds", () => {
    expect(oncePerMoment([clip("game", 0, 0, 5), clip("cam", 0, 0, 5), clip("game", 0, 0, 5, 2)])).toHaveLength(3);
  });
});
