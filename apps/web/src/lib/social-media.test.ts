/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { fileTitle, postableExport } from "./social-media";

describe("postableExport", () => {
  it("takes H.264 + AAC in MP4 or MOV, with or without sound", () => {
    expect(postableExport({ format: "mp4", video: { codec: "avc" }, audio: { codec: "aac" } })).toBe(true);
    expect(postableExport({ format: "mov", video: { codec: "avc" }, audio: { codec: "aac" } })).toBe(true);
    expect(postableExport({ format: "mp4", video: { codec: "avc" }, audio: { enabled: false, codec: "opus" } })).toBe(true);
  });

  it("turns away what a network would refuse at send time", () => {
    expect(postableExport({ format: "webm", video: { codec: "vp9" }, audio: { codec: "opus" } })).toBe(false);
    expect(postableExport({ format: "ogg" })).toBe(false);
    expect(postableExport({ format: "wav" })).toBe(false);
    expect(postableExport({ format: "mp4", video: { codec: "av1" }, audio: { codec: "aac" } })).toBe(false);
    expect(postableExport({ format: "mp4", video: { codec: "hevc" }, audio: { codec: "aac" } })).toBe(false);
    expect(postableExport({ format: "mp4", video: { codec: "avc" }, audio: { codec: "opus" } })).toBe(false);
    expect(postableExport({ format: "mp4", video: { enabled: false }, audio: { codec: "aac" } })).toBe(false);
  });
});

describe("fileTitle", () => {
  it("turns a file name into words", () => {
    expect(fileTitle("My trip to Lisbon.mp4")).toBe("My trip to Lisbon");
    expect(fileTitle("best_clutch_ever.MOV")).toBe("best clutch ever");
    expect(fileTitle("how-to-edit-faster.mp4")).toBe("how to edit faster");
    expect(fileTitle("Q&A - part 2.mp4")).toBe("Q&A - part 2");
    expect(fileTitle("Video of my dog.mp4")).toBe("Video of my dog");
  });

  it("leaves out names a camera or app made up", () => {
    expect(fileTitle("IMG_4821.JPG")).toBe("");
    expect(fileTitle("VID_20261127_101500.mp4")).toBe("");
    expect(fileTitle("PXL_20261127_101500123.mp4")).toBe("");
    expect(fileTitle("Screenshot 2026-11-27 at 10.02.11.png")).toBe("");
    expect(fileTitle("Screen Recording 2026-11-27 at 10.02.11.mov")).toBe("");
    expect(fileTitle("20261127_101500.mp4")).toBe("");
    expect(fileTitle("3f2a9c1e-4b7d-4e2a-9f1c-0a1b2c3d4e5f.mp4")).toBe("");
    expect(fileTitle("IMG_4821 copy.jpg")).toBe("");
  });
});
