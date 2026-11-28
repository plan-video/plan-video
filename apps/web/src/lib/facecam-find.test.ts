/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { lookOf, type FoundPerson } from "./facecam-find";

const person = (x: number, y: number, width: number, height: number, score = 0.9): FoundPerson => ({ x, y, width, height, score });

describe("lookOf", () => {
  it("takes the person who stays in a corner as the facecam, not the ones running around the game", () => {
    const cam = (jitter: number) => person(0.02 + jitter, 0.6, 0.18, 0.35);
    const frames = [
      [cam(0), person(0.5, 0.4, 0.05, 0.15)],
      [cam(0.004), person(0.3, 0.5, 0.05, 0.15)],
      [person(0.7, 0.3, 0.06, 0.18)],
      [cam(0.002)],
      [cam(0), person(0.4, 0.45, 0.05, 0.14)],
      [cam(0.003), person(0.62, 0.42, 0.05, 0.15)],
    ];
    const look = lookOf(frames);
    expect(look.layout).toBe("split");
    const crop = look.crops.facecam!;
    expect(crop.x).toBeLessThan(0.02);
    expect(crop.y).toBeLessThan(0.6);
    expect(crop.x + crop.width).toBeGreaterThan(0.2);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
  });

  it("goes full screen on the person when the camera is the stream", () => {
    const frames = Array.from({ length: 6 }, (_, i) => [person(0.3 + i * 0.002, 0.1, 0.45, 0.9)]);
    const look = lookOf(frames, { cameraOnly: true });
    expect(look.layout).toBe("fullscreen");
    const crop = look.crops.gameplay!;
    expect(crop.x + crop.width / 2).toBeCloseTo(0.525, 1);
    expect(crop.height).toBe(1);
  });

  it("doesn't take a third-person game's character in the middle for a facecam", () => {
    const frames = Array.from({ length: 6 }, (_, i) => [person(0.3 + (i % 2) * 0.01, 0.05, 0.32, 0.9)]);
    expect(lookOf(frames).layout).toBe("blurred");
    expect(lookOf(Array.from({ length: 6 }, () => [person(0.42, 0.4, 0.16, 0.3)])).layout).toBe("blurred");
  });

  it("keeps the whole game in view when no one stays put", () => {
    const frames = Array.from({ length: 6 }, (_, i) => [person(0.1 * i, 0.4, 0.06, 0.16)]);
    expect(lookOf(frames).layout).toBe("blurred");
    expect(lookOf([[person(0.02, 0.6, 0.18, 0.35, 0.3)], [], []]).layout).toBe("blurred");
  });
});
