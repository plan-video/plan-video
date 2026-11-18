/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { postableExport } from "./social-media";

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
