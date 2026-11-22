/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { videoProblems } from "./social-media";
import { isUntouchedVideo, startVideoEdit, trimTo, videoOutputSize } from "./video-edit";

const wide = { width: 3442, height: 2160 };

describe("startVideoEdit", () => {
  it("opens a shape networks turn away already cropped to one they take", () => {
    const edit = startVideoEdit(wide, 38);
    const out = videoOutputSize(edit.crop);
    expect(edit.shape).toBe("16:9");
    expect(videoProblems({ ...out, duration: 38, file: { name: "a.mp4", type: "video/mp4", size: 1 } })).toEqual([]);
  });

  it("leaves a shape networks take as it is", () => {
    const size = { width: 1080, height: 1920 };
    expect(isUntouchedVideo(startVideoEdit(size, 20), size, 20)).toBe(true);
  });

  it("ends a video that runs past the limit at the limit", () => {
    expect(startVideoEdit({ width: 1920, height: 1080 }, 900).end).toBe(300);
  });
});

describe("trimTo", () => {
  const start = startVideoEdit({ width: 1920, height: 1080 }, 60);

  it("never lets the clip get shorter than networks take", () => {
    const edit = trimTo(trimTo(start, "start", 40, 60), "end", 41, 60);
    expect(edit.end - edit.start).toBe(3);
    expect(trimTo(edit, "start", 59, 60).start).toBe(40);
  });

  it("stays inside the video", () => {
    expect(trimTo(start, "start", -5, 60).start).toBe(0);
    expect(trimTo(start, "end", 99, 60).end).toBe(60);
  });

  it("keeps all of a video shorter than the minimum", () => {
    const short = startVideoEdit({ width: 1920, height: 1080 }, 2);
    expect(trimTo(short, "start", 1, 2).start).toBe(0);
  });
});

describe("videoOutputSize", () => {
  it("brings a big crop down to 1080p with even sides", () => {
    expect(videoOutputSize({ x: 0, y: 0, width: 1215, height: 2160 })).toEqual({ width: 1080, height: 1920 });
    expect(videoOutputSize({ x: 0, y: 0, width: 3442, height: 1936 })).toEqual({ width: 1920, height: 1080 });
  });

  it("never scales a small crop up", () => {
    expect(videoOutputSize({ x: 0, y: 0, width: 720, height: 1280 })).toEqual({ width: 720, height: 1280 });
  });
});
