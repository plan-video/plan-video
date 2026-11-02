/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { intlLocale, localized, t } from "./i18n";
import type { PictureEdit } from "./picture-edit";
import { formatDuration, isAspect, type MediaSummary } from "./social";

export type PostMedia = {
  id: string;
  file: File;
  kind: "video" | "image";
  /** Release it with `releaseMedia`. */
  url: string;
  width: number;
  height: number;
  /** Seconds. 0 for a picture. */
  duration: number;
  poster: string;
  /** A picture cropped or turned here, kept with the file it came from so the edit can be changed or undone. */
  edit?: { original: File; settings: PictureEdit; cutout?: File };
};

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|heic|avif)$/i;

export function mediaKind(file: File): PostMedia["kind"] | null {
  if (file.type.startsWith("video/") || VIDEO_EXTENSIONS.test(file.name)) return "video";
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) return "image";
  return null;
}

export const fileKey = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`;

export const MEDIA_LIMITS = {
  videoMinSeconds: 3,
  videoMaxSeconds: 5 * 60,
  videoMaxBytes: 500e6,
  /** Width over height. */
  videoAspects: [
    { ratio: 9 / 16, label: "9:16" },
    { ratio: 16 / 9, label: "16:9" },
    { ratio: 1, label: "1:1" },
    { ratio: 4 / 3, label: "4:3" },
  ],
  imageMaxBytes: 8e6,
  maxImages: 35,
  /** Everything one post carries. */
  postMaxBytes: 500e6,
} as const;

export const POSTABLE_FILES = "video/mp4,video/quicktime,.mp4,.mov,image/jpeg,image/png,.jpg,.jpeg,.png";
export const POSTABLE_VIDEOS = "video/mp4,video/quicktime,.mp4,.mov";
export const POSTABLE_IMAGES = "image/jpeg,image/png,.jpg,.jpeg,.png";

export const isPostableVideo = (file: Pick<File, "name" | "type">) => /^video\/(mp4|quicktime)$/.test(file.type) || /\.(mp4|mov)$/i.test(file.name);
const isPostableImage = (file: File) => /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);

/** Pictures are turned away when picked, as nothing here can fix them. */
export function imageFileProblem(file: File): string | null {
  if (!isPostableImage(file)) return t("{name} isn't a JPG or PNG.", { name: file.name });
  if (file.size > MEDIA_LIMITS.imageMaxBytes) return t("{name} is {size}. Pictures can be up to 8 MB.", { name: file.name, size: formatBytes(file.size) });
  return null;
}

/** en-GB's has no comma before "or". */
const SHAPE_LIST = localized((locale) => new Intl.ListFormat(locale, { type: "disjunction" }), "en-GB");

/** The video is kept, so it can be fixed in the editor and exported again. */
export function videoProblems(media: Pick<PostMedia, "duration" | "width" | "height"> & { file: Pick<File, "name" | "type" | "size"> }): string[] {
  const problems: string[] = [];
  if (!isPostableVideo(media.file)) problems.push(t("Videos need to be MP4 or MOV."));
  if (media.file.size > MEDIA_LIMITS.videoMaxBytes) problems.push(t("It's {size}. Videos can be up to 500 MB.", { size: formatBytes(media.file.size) }));
  if (media.duration > 0 && media.duration < MEDIA_LIMITS.videoMinSeconds) problems.push(t("Videos need to be at least 3 seconds."));
  if (media.duration > MEDIA_LIMITS.videoMaxSeconds) {
    problems.push(t("It's {duration}. Videos can be up to {limit}.", { duration: formatDuration(media.duration), limit: formatDuration(MEDIA_LIMITS.videoMaxSeconds) }));
  }
  if (media.width > 0 && !MEDIA_LIMITS.videoAspects.some((aspect) => isAspect(media.width, media.height, aspect.ratio))) {
    const labels = MEDIA_LIMITS.videoAspects.map((aspect) => aspect.label);
    problems.push(t("Videos need to be {shapes}.", { shapes: SHAPE_LIST().format(labels) }));
  }
  return problems;
}

export function mediaProblems(items: readonly PostMedia[]): string[] {
  const first = items[0];
  if (!first) return [];
  if (first.kind === "video") return videoProblems(first);
  const bytes = items.reduce((total, item) => total + item.file.size, 0);
  return bytes > MEDIA_LIMITS.postMaxBytes ? [t("The pictures come to {size}. A post can carry up to 500 MB.", { size: formatBytes(bytes) })] : [];
}

export function formatBytes(bytes: number): string {
  const locale = intlLocale();
  // English keeps its fixed form; other languages use their own digits and units.
  if (locale) {
    const [value, unit, digits]: [number, string, number] =
      bytes >= 1e9 ? [bytes / 1e9, "gigabyte", 1] : bytes >= 1e6 ? [Math.round(bytes / 1e6), "megabyte", 0] : [Math.max(1, Math.round(bytes / 1e3)), "kilobyte", 0];
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

const POSTER_HEIGHT = 320;

/** A video that is never on the page often reports a seek as done, then paints a blank frame. */
function withVideo<T>(url: string, work: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.width = 64;
  video.height = 64;
  if (!url.startsWith("blob:")) video.crossOrigin = "anonymous";

  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:fixed;left:-120px;top:0;width:64px;height:64px;pointer-events:none";
  holder.appendChild(video);
  document.body.appendChild(holder);

  const ready = new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(t("The video could not be read.")));
  });
  video.src = url;

  return ready
    .then(() => work(video))
    .finally(() => {
      video.removeAttribute("src");
      video.load();
      holder.remove();
    });
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : time;
  const target = Math.min(Math.max(0, time), Math.max(0, duration - 0.05));
  const painted = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2 && video.videoWidth > 0) return painted();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      stop();
      reject(new Error(t("Couldn't read that frame.")));
    }, 8000);
    const onSeeked = () => {
      if (Math.abs(video.currentTime - target) > 0.25) return;
      stop();
      if (video.videoWidth <= 0) reject(new Error(t("Couldn't read that frame.")));
      else painted().then(resolve, reject);
    };
    const onError = () => {
      stop();
      reject(new Error(t("The video could not be read.")));
    };
    const stop = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = target;
  });
}

function still(video: HTMLVideoElement, height = POSTER_HEIGHT): string {
  const scale = Math.min(1, height / (video.videoHeight || height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("The picture could not be read.")));
    image.src = url;
  });
}

let nextId = 0;

/** Throws, with a reason, for a file that is neither or will not decode. */
export async function readMedia(file: File): Promise<PostMedia> {
  const kind = mediaKind(file);
  if (!kind) throw new Error(t("{name} is not a video or a picture.", { name: file.name }));

  const url = URL.createObjectURL(file);
  const id = `media-${++nextId}`;
  try {
    if (kind === "image") {
      const image = await loadImage(url);
      return { id, file, kind, url, width: image.naturalWidth, height: image.naturalHeight, duration: 0, poster: url };
    }

    return await withVideo(url, async (video) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      await seek(video, Math.min(0.5, duration / 2));
      return { id, file, kind, url, width: video.videoWidth, height: video.videoHeight, duration, poster: still(video) };
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(t("{name}: {problem}", { name: file.name, problem: (error as Error).message }));
  }
}

/** The file and what `readMedia` learned from it, without reading it again. */
export function mediaFromSaved(saved: Pick<PostMedia, "file" | "kind" | "width" | "height" | "duration" | "poster">): PostMedia {
  const url = URL.createObjectURL(saved.file);
  return { ...saved, id: `media-${++nextId}`, url, poster: saved.kind === "image" ? url : saved.poster };
}

export function releaseMedia(media: PostMedia): void {
  URL.revokeObjectURL(media.url);
}

export async function videoFrames(media: PostMedia, count: number): Promise<{ time: number; src: string }[]> {
  return withVideo(media.url, async (video) => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : media.duration;
    const frames: { time: number; src: string }[] = [];
    for (let index = 0; index < count; index++) {
      const time = (duration * (index + 0.5)) / count;
      try {
        await seek(video, time);
        frames.push({ time, src: still(video, 160) });
      } catch {
        // One frame that won't decode doesn't drop the rest.
      }
    }
    if (!frames.length) throw new Error(t("Couldn't read frames from the video."));
    return frames;
  });
}

export async function videoStill(media: PostMedia, time: number): Promise<string> {
  return withVideo(media.url, async (video) => {
    await seek(video, time);
    return still(video);
  });
}

export function summarizeMedia(items: readonly PostMedia[]): MediaSummary | null {
  const first = items[0];
  if (!first) return null;
  if (first.kind === "video") return { kind: "video", duration: first.duration, width: first.width, height: first.height };
  const mixedShapes = items.some((item) => !isAspect(item.width, item.height, first.width / first.height));
  return { kind: "images", count: items.length, width: first.width, height: first.height, mixedShapes };
}
