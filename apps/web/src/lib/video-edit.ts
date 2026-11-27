/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg, t } from "./i18n";
import { fitCrop, pixelCrop, type Rect } from "./picture-edit";
import { isAspect } from "./social";
import { MEDIA_LIMITS } from "./social-media";

type Size = { width: number; height: number };

export type VideoShapeId = "original" | (typeof MEDIA_LIMITS.videoAspects)[number]["label"];

const HINTS: Record<VideoShapeId, string> = {
  original: msg("The video's own shape"),
  "9:16": msg("Reels, Shorts, TikTok and Stories"),
  "16:9": msg("YouTube, X and LinkedIn"),
  "1:1": msg("Square, fits every feed"),
  "4:3": msg("A little wider than square"),
};

export const VIDEO_SHAPES: { id: VideoShapeId; label: string; hint: string; ratio?: number }[] = [
  { id: "original", label: msg("Original"), hint: HINTS.original },
  ...MEDIA_LIMITS.videoAspects.map((aspect) => ({ id: aspect.label, label: aspect.label, hint: HINTS[aspect.label], ratio: aspect.ratio })),
];

/** Seconds into the source, and `crop` in its display pixels. */
export type VideoEdit = { start: number; end: number; crop: Rect; shape: VideoShapeId; muted: boolean };

/** Every network takes 1080p, and a bigger file only uploads slower. */
const MAX_SHORT_SIDE = 1080;
const MAX_LONG_SIDE = 1920;
/** Trim handles closer than this land on the same frame. */
const SAME_TIME = 0.05;

export function videoShapeRatio(shape: VideoShapeId, size: Size): number {
  return shape === "original" ? size.width / size.height : VIDEO_SHAPES.find((entry) => entry.id === shape)!.ratio!;
}

/** The video's own shape when networks take it, or else the one closest to it. */
export function suggestedVideoShape(size: Size): VideoShapeId {
  const aspect = size.width / size.height;
  if (MEDIA_LIMITS.videoAspects.some((entry) => isAspect(size.width, size.height, entry.ratio))) return "original";
  let best: (typeof MEDIA_LIMITS.videoAspects)[number] = MEDIA_LIMITS.videoAspects[0];
  for (const entry of MEDIA_LIMITS.videoAspects) {
    if (Math.abs(Math.log(aspect / entry.ratio)) < Math.abs(Math.log(aspect / best.ratio))) best = entry;
  }
  return best.label;
}

/** Opens fixed: on a shape networks take, and no longer than they take. */
export function startVideoEdit(size: Size, duration: number): VideoEdit {
  const shape = suggestedVideoShape(size);
  return {
    start: 0,
    end: Math.min(duration, MEDIA_LIMITS.videoMaxSeconds),
    crop: fitCrop(videoShapeRatio(shape, size), size),
    shape,
    muted: false,
  };
}

export function withVideoShape(edit: VideoEdit, shape: VideoShapeId, size: Size): VideoEdit {
  const centre = { x: edit.crop.x + edit.crop.width / 2, y: edit.crop.y + edit.crop.height / 2 };
  return { ...edit, shape, crop: fitCrop(videoShapeRatio(shape, size), size, centre) };
}

/** Moves one end, keeping the clip at least as long as networks take, or the whole video when it is shorter. */
export function trimTo(edit: VideoEdit, end: "start" | "end", time: number, duration: number): VideoEdit {
  const min = Math.min(MEDIA_LIMITS.videoMinSeconds, duration);
  if (end === "start") return { ...edit, start: Math.min(Math.max(0, time), edit.end - min) };
  return { ...edit, end: Math.max(Math.min(duration, time), edit.start + min) };
}

export function isUntouchedVideo(edit: VideoEdit, size: Size, duration: number): boolean {
  const crop = pixelCrop(edit.crop, size);
  return (
    !edit.muted &&
    edit.start < SAME_TIME &&
    edit.end > duration - SAME_TIME &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === size.width &&
    crop.height === size.height
  );
}

/** H.264 wants even sides; the crop's shape is kept and nothing is scaled up. */
export function videoOutputSize(crop: Rect): Size {
  const long = Math.max(crop.width, crop.height);
  const short = Math.min(crop.width, crop.height);
  const scale = Math.min(1, MAX_SHORT_SIDE / short, MAX_LONG_SIDE / long);
  const even = (value: number) => Math.max(2, 2 * Math.round((value * scale) / 2));
  return { width: even(crop.width), height: even(crop.height) };
}

export class VideoEditCancelled extends Error {}

/** Always re-encoded, so cuts land on the exact frame and the file is an MP4 with H.264 and AAC, which every network takes. */
export async function renderVideo(
  file: File,
  edit: VideoEdit,
  size: Size,
  options: { onProgress?(progress: number): void; signal?: AbortSignal } = {},
): Promise<File> {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, ConversionCanceledError, Input, Mp4OutputFormat, Output, QUALITY_HIGH } = await import("mediabunny");
  if (!edit.muted) await (await import("@plan.video/encoder/aac")).ensureAacEncoder();
  const crop = pixelCrop(edit.crop, size);
  const out = videoOutputSize(crop);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start: edit.start, end: edit.end },
      copy: false,
      video: { crop: { left: crop.x, top: crop.y, width: crop.width, height: crop.height }, width: out.width, height: out.height, fit: "fill", codec: "avc", quality: QUALITY_HIGH },
      audio: edit.muted ? { discard: true } : { codec: "aac", quality: QUALITY_HIGH },
      showWarnings: false,
    });
    const kept = conversion.utilizedTracks;
    const lostSound = !edit.muted && !kept.some((track) => track.isAudioTrack()) && conversion.discardedTracks.some((entry) => entry.track.isAudioTrack());
    if (!conversion.isValid || !kept.some((track) => track.isVideoTrack()) || lostSound) throw new Error(t("This browser can't save videos. Try Chrome, Edge or Safari, or edit it in plan.video."));
    if (options.signal?.aborted) throw new VideoEditCancelled();
    const cancel = () => void conversion.cancel();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.onProgress) conversion.onProgress = options.onProgress;
    try {
      await conversion.execute();
    } catch (error) {
      if (error instanceof ConversionCanceledError) throw new VideoEditCancelled();
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", cancel);
    }
  } finally {
    input.dispose();
  }
  if (!target.buffer) throw new Error(t("The video could not be read."));
  const base = file.name.replace(/\.[^.]+$/, "") || "video";
  return new File([target.buffer], `${base}.mp4`, { type: "video/mp4", lastModified: Date.now() });
}
