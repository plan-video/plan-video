/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { fetchStretch, type StreamVideo } from "@/lib/stream-clips";

import type { ClipEdit } from "@/lib/clip-studio";

/** A clip's whole range as a small video; `at(seconds)` turns broadcast time into the file's. */
export type ClipMedia = { url: string; file: File; offset: number; from: number; at(seconds: number): number };

/** A few stay in memory, so moving between clips doesn't fetch them again. */
const KEEP = 6;
const media = new Map<string, Promise<ClipMedia>>();
const peaks = new Map<string, Promise<ClipPeaks>>();

/** Loudness from 0 to 1 across the whole file, which is `duration` seconds long. */
export type ClipPeaks = { values: Float32Array; duration: number };

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
    peaks.delete(oldest);
    void gone.then((old) => URL.revokeObjectURL(old.url), () => {});
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

/** The file's loudness in `buckets` peaks, for the trim bar's waveform. */
export function clipPeaks(video: StreamVideo, clip: ClipEdit, buckets = 900): Promise<ClipPeaks> {
  const key = keyOf(video, clip);
  let pending = peaks.get(key);
  if (!pending) {
    pending = clipMedia(video, clip).then(async ({ file }) => {
      const context = new OfflineAudioContext(1, 1, 22050);
      const audio = await context.decodeAudioData(await file.arrayBuffer());
      const data = audio.getChannelData(0);
      const out = new Float32Array(buckets);
      const size = Math.max(1, Math.floor(data.length / buckets));
      let loudest = 0;
      for (let b = 0; b < buckets; b++) {
        let peak = 0;
        for (let i = b * size, end = Math.min(data.length, i + size); i < end; i += 4) peak = Math.max(peak, Math.abs(data[i]!));
        out[b] = peak;
        loudest = Math.max(loudest, peak);
      }
      if (loudest > 0) for (let b = 0; b < buckets; b++) out[b] = out[b]! / loudest;
      return { values: out, duration: audio.duration };
    });
    pending.catch(() => peaks.delete(key));
    peaks.set(key, pending);
  }
  return pending;
}
