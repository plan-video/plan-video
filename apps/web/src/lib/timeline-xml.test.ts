/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { buildPremiereXml, clampClip, packTracks, premiereFraming, stackTracks, type Timeline, type TimelineClip } from "./timeline-xml";

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    media: "a", name: "clip", start: 0, end: 30, in: 0, speed: 1,
    visual: true, audio: false, audible: true, gain: 1, opacity: 1,
    ...overrides,
  };
}

const timeline = (clips: TimelineClip[], extra: Partial<Timeline> = {}): Timeline => ({
  name: "Edit",
  width: 1080,
  height: 1920,
  fps: 30,
  clips,
  media: [
    { id: "a", file: "gameplay.mp4", kind: "video", seconds: 10, width: 1920, height: 1080, frameRate: 60, channels: 2 },
    { id: "m", file: "voice.wav", kind: "audio", seconds: 10, channels: 1 },
  ],
  ...extra,
});

const tag = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}>([^<]*)</${name}>`, "g"))].map((m) => m[1]);

describe("clampClip", () => {
  it("moves the in point by the frames cut from the front, at the clip's speed", () => {
    expect(clampClip({ start: 10, end: 50, in: 100, speed: 2 }, { start: 20, end: 40 })).toEqual({ start: 20, end: 40, in: 120, speed: 2 });
  });

  it("drops a clip wholly outside the window", () => {
    expect(clampClip({ start: 0, end: 10, in: 0, speed: 1 }, { start: 10, end: 20 })).toBeNull();
  });
});

describe("tracks", () => {
  it("keeps an overlapping clip above the one it is drawn over, and reuses tracks for cuts", () => {
    // A full-length background, then two back-to-back cuts over it, then a sticker over the second cut.
    const tracks = stackTracks([
      { start: 0, end: 100 },
      { start: 0, end: 50 },
      { start: 50, end: 100 },
      { start: 60, end: 70 },
    ]);
    expect(tracks).toEqual([0, 1, 1, 2]);
  });

  it("puts audio in the first lane free for the whole clip", () => {
    expect(packTracks([{ start: 0, end: 50 }, { start: 40, end: 60 }, { start: 50, end: 80 }])).toEqual([0, 1, 0]);
  });
});

describe("premiereFraming", () => {
  it("is native size at the centre when the source fills the sequence 1:1", () => {
    const framing = premiereFraming({
      sequence: { width: 1920, height: 1080 },
      source: { width: 1920, height: 1080 },
      box: { width: 1920, height: 1080 },
      matrix: identity,
      fit: "cover",
    });
    expect(framing).toEqual({ scale: 100, centerX: 0, centerY: 0, rotation: 0, crop: { left: 0, right: 0, top: 0, bottom: 0 } });
  });

  it("scales a landscape clip to cover the top half of a vertical frame and crops its sides", () => {
    // 1920×1080 into a 1080×960 box at the top of 1080×1920: cover scales by 960/1080.
    const framing = premiereFraming({
      sequence: { width: 1080, height: 1920 },
      source: { width: 1920, height: 1080 },
      box: { width: 1080, height: 960 },
      matrix: identity,
      fit: "cover",
    });
    expect(framing.scale).toBeCloseTo(88.8889, 3);
    expect(framing.centerX).toBe(0);
    // 480 px above the middle, over the source's 1080.
    expect(framing.centerY).toBeCloseTo(-480 / 1080, 5);
    // 1706.67 px wide shown 1080: 313.33 px each side, in source pixels 352.5 of 1920.
    expect(framing.crop.left).toBeCloseTo(18.3594, 3);
    expect(framing.crop.right).toBeCloseTo(18.3594, 3);
    expect(framing.crop.top).toBe(0);
  });

  it("carries the box's own move, scale and the media crop", () => {
    const framing = premiereFraming({
      sequence: { width: 1920, height: 1080 },
      source: { width: 1000, height: 1000 },
      box: { width: 500, height: 500 },
      matrix: { a: 2, b: 0, c: 0, d: 2, e: 100, f: 40 },
      fit: "fill",
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
    });
    // The right half (500×1000) is stretched to 500×500 (100% across, 50% down), then doubled.
    expect(framing.scale).toBe(150);
    expect(framing.crop).toEqual({ left: 50, right: 0, top: 0, bottom: 0 });
    // The full frame's middle sits at the box's left edge, (0, 250) → (100, 540): 860 px left of centre.
    expect(framing.centerX).toBeCloseTo(-0.86, 5);
    expect(framing.centerY).toBe(0);
  });
});

describe("buildPremiereXml", () => {
  it("writes cuts at their frames with the source in point", () => {
    const xml = buildPremiereXml(timeline([clip({ start: 15, end: 45, in: 90 })]));
    expect(tag(xml, "start")).toContain("15");
    expect(tag(xml, "end")).toContain("45");
    expect(tag(xml, "in")).toContain("90");
    expect(tag(xml, "out")).toContain("120");
  });

  it("reads more source at higher speed and says so in a Time Remap", () => {
    const xml = buildPremiereXml(timeline([clip({ start: 0, end: 30, in: 0, speed: 2 })]));
    expect(tag(xml, "out")).toContain("60");
    expect(xml).toContain("<effectid>timeremap</effectid>");
    expect(xml).toMatch(/<parameterid>speed<\/parameterid>[\s\S]*?<value>200<\/value>/);
  });

  it("links a video's sound as a stereo pair under it, one channel each", () => {
    const xml = buildPremiereXml(timeline([clip({ audio: true })]));
    expect(xml.match(/premiereChannelType="stereo"/g)).toHaveLength(2);
    expect(tag(xml, "trackindex").filter((index) => index === "2").length).toBeGreaterThan(0);
    expect(xml.match(/<linkclipref>/g)).toHaveLength(9);
  });

  it("writes each media file once and points it at the media folder", () => {
    const xml = buildPremiereXml(timeline([clip({ start: 0, end: 30 }), clip({ start: 30, end: 60 })]));
    expect(xml.match(/<pathurl>/g)).toHaveLength(1);
    expect(tag(xml, "pathurl")).toEqual(["media/gameplay.mp4"]);
    expect(xml).toContain('<file id="file-a"/>');
  });

  it("switches a muted clip's sound off and keeps its level", () => {
    const xml = buildPremiereXml(timeline([clip({ media: "m", visual: false, audio: true, audible: false, gain: 0.5 })]));
    expect(tag(xml, "enabled")).toContain("FALSE");
    expect(xml).toContain("<effectid>audiolevels</effectid>");
    expect(xml).toContain('premiereTrackType="Mono"');
  });

  it("marks 29.97 as NTSC on a 30 timebase", () => {
    const xml = buildPremiereXml(timeline([clip({})], { fps: 29.97 }));
    expect(xml).toContain("<timebase>30</timebase>\n");
    expect(tag(xml, "ntsc")[0]).toBe("TRUE");
  });

  it("escapes names", () => {
    const xml = buildPremiereXml(timeline([clip({ name: "Tom & <Jerry>" })], { name: "A \"B\"" }));
    expect(xml).toContain("Tom &amp; &lt;Jerry&gt;");
    expect(xml).toContain("A &quot;B&quot;");
  });
});
