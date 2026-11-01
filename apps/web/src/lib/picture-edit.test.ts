/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { MAX_PIXELS, dragCrop, encodeWithin, flipEdit, isUntouched, outputSize, startEdit, turnEdit, withShape, type Rect } from "./picture-edit";

const photo = { width: 4000, height: 3000 };
const inside = (crop: Rect, size: { width: number; height: number }) =>
  crop.x >= -1e-9 && crop.y >= -1e-9 && crop.x + crop.width <= size.width + 1e-9 && crop.y + crop.height <= size.height + 1e-9;

describe("dragCrop", () => {
  const start = { x: 1000, y: 1000, width: 800, height: 1000 };

  it("keeps a locked shape inside the picture when a corner is pulled far past it", () => {
    for (const [handle, dx, dy] of [["se", 9000, 9000], ["nw", -9000, -9000], ["ne", 9000, -200], ["sw", -50, 9000]] as const) {
      const crop = dragCrop(start, handle, dx, dy, photo, 4 / 5, 40);
      expect(inside(crop, photo), handle).toBe(true);
      expect(crop.width / crop.height).toBeCloseTo(4 / 5);
    }
  });

  it("keeps the opposite corner where it was", () => {
    const crop = dragCrop(start, "nw", -300, -100, photo, 4 / 5, 40);
    expect(crop.x + crop.width).toBeCloseTo(1800);
    expect(crop.y + crop.height).toBeCloseTo(2000);
  });

  it("stops at the smallest size instead of turning inside out", () => {
    const free = dragCrop(start, "se", -5000, -5000, photo, null, 40);
    expect(free).toMatchObject({ x: 1000, y: 1000, width: 40, height: 40 });
    const locked = dragCrop(start, "e", -5000, 0, photo, 4 / 5, 40);
    expect(locked.width).toBeCloseTo(40);
    expect(locked.height).toBeCloseTo(50);
  });

  it("moves the whole crop no further than the edge", () => {
    expect(dragCrop(start, "move", 9000, -9000, photo, null, 40)).toMatchObject({ x: 3200, y: 0, width: 800, height: 1000 });
  });

  it("grows a locked crop from an edge around its middle, within the picture", () => {
    const crop = dragCrop({ x: 100, y: 100, width: 400, height: 500 }, "e", 3000, 0, photo, 4 / 5, 40);
    expect(inside(crop, photo)).toBe(true);
    expect(crop.y + crop.height / 2).toBeCloseTo(350);
  });
});

describe("turnEdit and flipEdit", () => {
  it("keeps the same part of the picture in the crop through a full turn", () => {
    let edit = { ...startEdit(photo), crop: { x: 100, y: 200, width: 300, height: 400 } };
    edit = turnEdit(edit, photo, true);
    expect(edit.crop).toEqual({ x: 3000 - 200 - 400, y: 100, width: 400, height: 300 });
    for (let index = 0; index < 3; index++) edit = turnEdit(edit, photo, true);
    expect(edit.turns).toBe(0);
    expect(edit.crop).toEqual({ x: 100, y: 200, width: 300, height: 400 });
    expect(turnEdit(turnEdit(edit, photo, false), photo, true).crop).toEqual(edit.crop);
  });

  it("turns a mirrored picture the way it looks, by swapping which way it is flipped", () => {
    const turned = turnEdit(flipEdit(startEdit(photo), photo, "x"), photo, true);
    expect(turned).toMatchObject({ flipX: false, flipY: true });
  });

  it("keeps a locked shape after a turn", () => {
    const edit = turnEdit(withShape(startEdit(photo), "4:5", photo), photo, true);
    expect(edit.crop.width / edit.crop.height).toBeCloseTo(4 / 5);
    expect(inside(edit.crop, { width: 3000, height: 4000 })).toBe(true);
  });

  it("knows a picture turned all the way round and flipped back is untouched", () => {
    let edit = flipEdit(flipEdit(startEdit(photo), photo, "y"), photo, "y");
    for (let index = 0; index < 4; index++) edit = turnEdit(edit, photo, false);
    expect(isUntouched(edit, photo)).toBe(true);
    expect(isUntouched(withShape(edit, "1:1", photo), photo)).toBe(false);
  });
});

describe("outputSize", () => {
  it("keeps a picture within what a browser can draw", () => {
    const out = outputSize({ x: 0, y: 0, width: 8000, height: 6000 });
    expect(out.width * out.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(out.width / out.height).toBeCloseTo(4 / 3, 2);
    expect(outputSize({ x: 0, y: 0, width: 1080, height: 1350 })).toEqual({ width: 1080, height: 1350 });
  });
});

describe("encodeWithin", () => {
  const sized = (bytes: Record<string, number>) => async (scale: number, type: string, quality?: number) => {
    const size = bytes[`${scale} ${type} ${quality ?? ""}`] ?? 1e9;
    return { size, type } as Blob;
  };

  it("keeps a PNG a PNG when it fits", async () => {
    expect((await encodeWithin(sized({ "1 image/png ": 5e6 }), true, 8e6)).type).toBe("image/png");
  });

  it("turns a PNG too big for the networks into a JPEG", async () => {
    expect((await encodeWithin(sized({ "1 image/png ": 12e6, "1 image/jpeg 0.92": 3e6 }), true, 8e6)).type).toBe("image/jpeg");
  });

  it("makes the picture smaller when no quality fits", async () => {
    const blob = await encodeWithin(sized({ "0.75 image/jpeg 0.85": 7e6 }), false, 8e6);
    expect(blob.size).toBe(7e6);
  });

  it("gives up with a reason rather than saving a file the networks turn down", async () => {
    await expect(encodeWithin(sized({}), false, 8e6)).rejects.toThrow(/too big/);
  });
});
