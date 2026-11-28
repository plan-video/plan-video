/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { fetchStretch, type StreamVideo } from "@/lib/stream-clips";

import type { ClipEdit } from "@/lib/clip-studio";

/** A clip's whole range as a small video; `at(seconds)` turns broadcast time into the file's. */
export type ClipMedia = { url: string; file: File; offset: number; from: number; at(seconds: number): number };

/** A few stay in memory, so moving between clips doesn't fetch them again. */
const KEEP = 6;
const STRIP_FRAMES = 24;
/** Twice the trim bar's height, for sharp frames on retina screens. */
const STRIP_HEIGHT = 112;
const media = new Map<string, Promise<ClipMedia>>();
const strips = new Map<string, Promise<ClipStrip>>();

/** Frames in order; null where one couldn't be read. */
export type ClipStrip = (ImageBitmap | null)[];

const keyOf = (video: StreamVideo, clip: ClipEdit) => `${video.id}:${clip.range.start}:${clip.range.end}`;

export function clipMedia(video: StreamVideo, clip: ClipEdit): Promise<ClipMedia> {
  const key = keyOf(video, clip);
  let pending = media.get(key);
  if (pending) {
    media.delete(key);
    media.set(key, pending);
    return pending;
  }
  const { start, end } = clip.range;
  pending = fetchStretch(video, start, end, { preview: true }).then(({ file, offset }) => ({
    url: URL.createObjectURL(file),
    file,
    offset,
    from: start,
    at: (seconds: number) => seconds - start + offset,
  }));
  pending.catch(() => media.delete(key));
  media.set(key, pending);
  while (media.size > KEEP) {
    const [oldest, gone] = media.entries().next().value as [string, Promise<ClipMedia>];
    media.delete(oldest);
    const strip = strips.get(oldest);
    strips.delete(oldest);
    void gone.then((old) => URL.revokeObjectURL(old.url), () => {});
    void strip?.then((frames) => frames.forEach((frame) => frame?.close()), () => {});
  }
  return pending;
}

let aheadRun = 0;

/** Fetches `next` one by one once `shown` has arrived, so moving on to them is instant; a newer call stops it. */
export async function fetchAhead(video: StreamVideo, shown: ClipEdit, next: ClipEdit[]): Promise<void> {
  const run = ++aheadRun;
  await clipMedia(video, shown).catch(() => {});
  for (const clip of next.slice(0, KEEP - 1)) {
    if (run !== aheadRun) return;
    await clipMedia(video, clip).catch(() => {});
  }
}

/** `count` frames spread evenly across the clip's whole range, for the trim bar. */
export function clipStrip(video: StreamVideo, clip: ClipEdit, count = STRIP_FRAMES): Promise<ClipStrip> {
  const key = keyOf(video, clip);
  let pending = strips.get(key);
  if (!pending) {
    pending = clipMedia(video, clip).then(async (loaded) => {
      const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import("mediabunny");
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(loaded.file) });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return [];
        const height = STRIP_HEIGHT;
        const sink = new CanvasSink(track, { width: Math.round((height * track.displayWidth) / track.displayHeight), height, fit: "fill", poolSize: 1 });
        const from = loaded.at(clip.range.start);
        const span = clip.range.end - clip.range.start;
        const times = Array.from({ length: count }, (_, i) => from + (span * (i + 0.5)) / count);
        const frames: ClipStrip = [];
        for await (const wrapped of sink.canvasesAtTimestamps(times)) frames.push(wrapped ? await createImageBitmap(wrapped.canvas) : null);
        return frames;
      } finally {
        input.dispose();
      }
    });
    pending.catch(() => strips.delete(key));
    strips.set(key, pending);
  }
  return pending;
}
