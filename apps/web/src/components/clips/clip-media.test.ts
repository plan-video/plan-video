import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClipEdit } from "@/lib/clip-studio";
import type { StreamVideo } from "@/lib/stream-clips";

const asked: number[] = [];
const held = new Map<number, () => void>();
vi.mock("@/lib/stream-clips", () => ({
  fetchStretch: (_video: unknown, start: number) => {
    asked.push(start);
    return new Promise((resolve) => held.set(start, () => resolve({ file: new File(["x"], "clip.mp4"), offset: 0 })));
  },
}));

const { fetchAhead } = await import("./clip-media");

const video = { id: "v1" } as StreamVideo;
const clip = (start: number) => ({ range: { start, end: start + 30 } }) as ClipEdit;
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("fetchAhead", () => {
  beforeEach(() => {
    asked.length = 0;
    held.clear();
  });

  it("waits for the open clip, then fetches the next ones one at a time", async () => {
    const done = fetchAhead(video, clip(100), [clip(200), clip(300)]);
    await settle();
    expect(asked).toEqual([100]);
    held.get(100)!();
    await settle();
    expect(asked).toEqual([100, 200]);
    held.get(200)!();
    await settle();
    expect(asked).toEqual([100, 200, 300]);
    held.get(300)!();
    await done;
  });

  it("stops when another clip is opened", async () => {
    const first = fetchAhead(video, clip(1000), [clip(1100), clip(1200)]);
    await settle();
    const second = fetchAhead(video, clip(2000), [clip(2100)]);
    held.get(1000)!();
    await settle();
    expect(asked).toEqual([1000, 2000]);
    held.get(2000)!();
    await settle();
    held.get(2100)!();
    await Promise.all([first, second]);
    expect(asked).toEqual([1000, 2000, 2100]);
  });
});
