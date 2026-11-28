/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Runs on this device; nothing is uploaded. A facecam is a person who stays in one place, off to a side,
// across a stream's frames: a third-person game keeps its character in the middle, and people in a game move.

import type { Box, Crops } from "@/lib/stream-layouts";

/** As fractions of the frame. */
export type FoundPerson = Box & { score: number };

export type StreamLook =
  | { layout: "split"; crops: Crops }
  | { layout: "fullscreen"; crops: Crops }
  | { layout: "blurred"; crops: Crops };

const FRAMES = 6;
const MIN_SCORE = 0.5;
const SAME_PLACE = 0.5;
const STAYS = 0.6;
/** A facecam's middle sits at least this far from the frame's middle, across. */
const OFF_CENTRE = 0.2;
const PADDING = 0.12;
/** Twitch and Kick categories where the camera is the stream. */
const CAMERA_CATEGORIES = new Set(["just chatting", "irl", "talk shows & podcasts", "music", "asmr", "art", "makers & crafting", "food & drink", "travel & outdoors", "pools, hot tubs, and beaches", "fitness & health", "beauty & body art"]);

export const cameraIsTheStream = (category: string) => CAMERA_CATEGORIES.has(category.trim().toLowerCase());

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function overlap(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  return shared / (a.width * a.height + b.width * b.height - shared);
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** The person who stays in one place the most frames, with where they were each time. */
function steadiest(frames: FoundPerson[][], keep: (person: FoundPerson) => boolean): FoundPerson[] {
  const seen = frames.map((people) => people.filter((person) => person.score >= MIN_SCORE && keep(person)));
  let best: { score: number; matches: FoundPerson[] } | null = null;
  for (const people of seen) {
    for (const person of people) {
      const matches = seen.flatMap((others) => {
        let match: FoundPerson | null = null;
        for (const other of others) if (overlap(person, other) >= SAME_PLACE && (!match || overlap(person, other) > overlap(person, match))) match = other;
        return match ? [match] : [];
      });
      if (!best || matches.length > best.matches.length || (matches.length === best.matches.length && person.score > best.score)) best = { score: person.score, matches };
    }
  }
  return best && frames.length >= 3 && best.matches.length >= Math.ceil(frames.length * STAYS) ? best.matches : [];
}

const middleOf = (matches: FoundPerson[]): Box => ({
  x: median(matches.map((m) => m.x)),
  y: median(matches.map((m) => m.y)),
  width: median(matches.map((m) => m.width)),
  height: median(matches.map((m) => m.height)),
});

/** The layout and crops a stream's frames call for, from the people found on each (on a 16:9 source). */
export function lookOf(frames: FoundPerson[][], { cameraOnly = false } = {}): StreamLook {
  if (cameraOnly) {
    const matches = steadiest(frames, () => true);
    const centre = matches.length ? (() => { const box = middleOf(matches); return box.x + box.width / 2; })() : 0.5;
    // The 9:16 crop, as tall as the frame, centred on the person.
    const width = (9 / 16) * (9 / 16);
    return { layout: "fullscreen", crops: { gameplay: { x: clamp(centre - width / 2, 0, 1 - width), y: 0, width, height: 1 } } };
  }
  const matches = steadiest(frames, (person) => Math.abs(person.x + person.width / 2 - 0.5) >= OFF_CENTRE);
  if (!matches.length) return { layout: "blurred", crops: {} };
  const box = middleOf(matches);
  const padX = box.width * PADDING;
  const padY = box.height * PADDING;
  const x = clamp(box.x - padX, 0, 1);
  const y = clamp(box.y - padY, 0, 1);
  return {
    layout: "split",
    crops: { facecam: { x, y, width: Math.min(1 - x, box.width + 2 * padX), height: Math.min(1 - y, box.height + 2 * padY) } },
  };
}

let detector: Promise<(image: unknown, options: object) => Promise<{ score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[]>> | null = null;

async function detect() {
  detector ??= (async () => {
    const { prepareTransformers } = await import("@/lib/background-removal");
    await prepareTransformers();
    const { pipeline } = await import("@huggingface/transformers");
    return (await pipeline("object-detection", "Xenova/yolos-tiny", { dtype: "q8" })) as never;
  })();
  try {
    return await detector;
  } catch (error) {
    detector = null;
    throw error;
  }
}

/** Looks at frames between `from` and `to` seconds of `file` and says how to lay out the clip. */
export async function findStreamLook(
  file: Blob,
  from: number,
  to: number,
  { category = "", signal }: { category?: string; signal?: AbortSignal } = {},
): Promise<StreamLook> {
  const [{ ALL_FORMATS, BlobSource, CanvasSink, Input }, { RawImage }] = await Promise.all([import("mediabunny"), import("@huggingface/transformers")]);
  const run = await detect();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return { layout: "blurred", crops: {} };
    const width = Math.min(640, track.displayWidth);
    const sink = new CanvasSink(track, { width, height: Math.round((width * track.displayHeight) / track.displayWidth), fit: "fill", poolSize: 1 });
    const times = Array.from({ length: FRAMES }, (_, i) => from + ((to - from) * (i + 0.5)) / FRAMES);
    const frames: FoundPerson[][] = [];
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      signal?.throwIfAborted();
      if (!wrapped) continue;
      const canvas = wrapped.canvas as HTMLCanvasElement | OffscreenCanvas;
      const blob = canvas instanceof OffscreenCanvas ? await canvas.convertToBlob() : await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!)));
      const found = await run(await RawImage.fromBlob(blob), { threshold: MIN_SCORE, percentage: true });
      frames.push(found.filter((entry) => entry.label === "person").map(({ score, box }) => ({ score, x: box.xmin, y: box.ymin, width: box.xmax - box.xmin, height: box.ymax - box.ymin })));
    }
    return lookOf(frames, { cameraOnly: cameraIsTheStream(category) });
  } finally {
    input.dispose();
  }
}

/** Frames a second of `file`'s picture, or null when it can't be read. */
export async function frameRateOf(file: Blob): Promise<number | null> {
  const { ALL_FORMATS, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    return (await track?.computePacketStats(120))?.averagePacketRate ?? null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
