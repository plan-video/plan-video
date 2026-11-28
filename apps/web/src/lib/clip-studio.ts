/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A stream's clips and everything changed on each, kept on this device per person, like projects.

import { openDB, type IDBPDatabase } from "idb";

import { msg } from "@/lib/i18n";
import { HOOK_SECONDS, HOOK_SIZE, HOOK_Y, type PostCaptions, type PostHook } from "@/lib/post-builder";
import { segmentWords } from "@/lib/transcript-lines";

import type { Transcript, TranscriptWord } from "@plan.video/assets";
import type { CaptionPreset, TextLookName } from "@plan.video/jsx";
import type { Crops } from "@/lib/stream-layouts";
import type { PostOptions } from "@/projects/post";
import type { StreamMoment, StreamVideo } from "@/lib/stream-clips";

export type ClipCaptionStyle = {
  id: string;
  label: string;
  preset: CaptionPreset;
  look?: TextLookName;
  colors?: string[];
  /** Px on the 1080-wide frame. */
  size: number;
  /** Words on screen at once. */
  words: number;
};

/** Two to a row in the Captions tab. */
export const CLIP_CAPTION_STYLES: ClipCaptionStyle[] = [
  { id: "gaming", label: msg("Gaming"), preset: "pop", look: "hook", size: 84, words: 1 },
  { id: "bold", label: msg("Bold"), preset: "classic", look: "commentary", size: 78, words: 2 },
  { id: "highlight", label: msg("Highlight"), preset: "spotlight", look: "commentary", colors: ["#FFE14D"], size: 72, words: 3 },
  { id: "yellow", label: msg("Yellow"), preset: "pop", look: "yellow", size: 84, words: 1 },
  { id: "punch", label: msg("Punch"), preset: "rise", look: "punch", size: 76, words: 2 },
  { id: "box", label: msg("Box"), preset: "box", look: "plain", colors: ["#000000"], size: 70, words: 3 },
  { id: "pink", label: msg("Pink box"), preset: "box", look: "commentary", colors: ["#FF2D87"], size: 70, words: 3 },
  { id: "subtle", label: msg("Subtle"), preset: "whisper", size: 46, words: 6 },
];

export const CAPTION_COLORS = ["#FFFFFF", "#FFE14D", "#4ADE80", "#38BDF8", "#F472B6", "#FB923C"];

export const captionStyle = (id: string): ClipCaptionStyle => CLIP_CAPTION_STYLES.find((style) => style.id === id) ?? CLIP_CAPTION_STYLES[0]!;

/** What a clip can be fetched as: the server sends at most two minutes. */
export const MOST_CLIP_SECONDS = 120;
export const LEAST_CLIP_SECONDS = 3;
/** Room to lengthen a clip either side of what was found. */
const ROOM = 15;

export type ClipEdit = {
  id: string;
  /** Found by plan.video, or added by hand. */
  from: "found" | "added";
  /** Broadcast seconds. */
  start: number;
  end: number;
  /** What can be fetched: trims stay inside. */
  range: { start: number; end: number };
  layout: string;
  /** As shares of the source. Empty until the facecam has been looked for. */
  crops: Crops;
  looked: boolean;
  captions: { on: boolean; style: string; size: number; color: string | null; words: number; y: number | null };
  /** Broadcast time; only words inside [start, end] are captioned. */
  words: TranscriptWord[];
  /** False when nothing was heard yet: captions are then written when the clip is made. */
  heard: boolean;
  hook: { on: boolean; text: string; seconds: number; size: number; y: number };
  title: string;
  caption: string;
  score: number | null;
  reason: string;
  /** A frame of it, when the stream has no storyboard. */
  thumb?: string;
  /** The project last made from this clip, what it was made from, and the stream's frame rate. */
  project?: { key: string; made: string; fps?: number | null };
  scheduled?: boolean;
  downloaded?: boolean;
};

export type ClipStream = {
  video: StreamVideo;
  note?: string;
  clips: ClipEdit[];
  createdAt: number;
  updatedAt: number;
};

const round = (value: number) => Math.round(value * 100) / 100;

function rangeAround(start: number, end: number, seconds: number, from = start, to = end): { start: number; end: number } {
  let a = Math.max(0, Math.min(from, start) - ROOM);
  let b = Math.min(seconds, Math.max(to, end) + ROOM);
  if (b - a > MOST_CLIP_SECONDS) {
    // Centred on the clip, so it can grow both ways.
    const middle = (start + end) / 2;
    a = Math.max(0, Math.min(start, middle - MOST_CLIP_SECONDS / 2));
    b = Math.min(seconds, a + MOST_CLIP_SECONDS);
    a = Math.max(0, b - MOST_CLIP_SECONDS);
  }
  return { start: round(a), end: round(b) };
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function clipFromMoment(moment: StreamMoment, video: StreamVideo): ClipEdit {
  const style = CLIP_CAPTION_STYLES[0]!;
  return {
    id: newId(),
    from: "found",
    start: moment.start,
    end: moment.end,
    range: rangeAround(moment.start, moment.end, video.seconds, moment.window?.start, moment.window?.end),
    layout: "blurred",
    crops: {},
    looked: false,
    captions: { on: true, style: style.id, size: style.size, color: null, words: style.words, y: null },
    words: moment.words,
    heard: true,
    hook: { on: true, text: moment.title, seconds: HOOK_SECONDS, size: HOOK_SIZE, y: HOOK_Y },
    title: moment.title,
    caption: moment.caption,
    score: moment.score,
    reason: moment.reason,
    ...(moment.thumb ? { thumb: moment.thumb } : {}),
  };
}

/** A clip of `length` seconds at `at`, picked by hand. */
export function addedClip(at: number, length: number, video: StreamVideo, title: string): ClipEdit {
  const start = Math.max(0, Math.min(at, video.seconds - LEAST_CLIP_SECONDS));
  const end = Math.min(video.seconds, start + Math.max(LEAST_CLIP_SECONDS, Math.min(length, MOST_CLIP_SECONDS)));
  const style = CLIP_CAPTION_STYLES[0]!;
  return {
    id: newId(),
    from: "added",
    start: round(start),
    end: round(end),
    range: rangeAround(start, end, video.seconds),
    layout: "blurred",
    crops: {},
    looked: false,
    captions: { on: true, style: style.id, size: style.size, color: null, words: style.words, y: null },
    words: [],
    heard: false,
    hook: { on: false, text: title, seconds: HOOK_SECONDS, size: HOOK_SIZE, y: HOOK_Y },
    title,
    caption: "",
    score: null,
    reason: "",
  };
}

export const duplicateClip = (clip: ClipEdit): ClipEdit => ({ ...structuredClone(clip), id: newId(), project: undefined, scheduled: false, downloaded: false });

/** [start, end] kept inside what can be fetched, at least a few seconds long. */
export function trimmed(clip: ClipEdit, start: number, end: number): { start: number; end: number } {
  const { range } = clip;
  let a = Math.max(range.start, Math.min(start, range.end - LEAST_CLIP_SECONDS));
  let b = Math.min(range.end, Math.max(end, a + LEAST_CLIP_SECONDS));
  if (b - a > MOST_CLIP_SECONDS) b = a + MOST_CLIP_SECONDS;
  a = Math.min(a, b - LEAST_CLIP_SECONDS);
  return { start: round(a), end: round(b) };
}

/** The words said inside the clip, timed from its start. */
export function clipWords(clip: ClipEdit): TranscriptWord[] {
  return clip.words
    .filter((word) => word.end > clip.start + 0.05 && word.start < clip.end - 0.05)
    .map((word) => ({ ...word, start: round(Math.max(0, word.start - clip.start)), end: round(Math.min(clip.end, word.end) - clip.start) }));
}

export const clipTranscript = (clip: ClipEdit): Transcript => segmentWords(clipWords(clip));

export function postCaptions(clip: ClipEdit): PostCaptions | null {
  if (!clip.captions.on) return null;
  const style = captionStyle(clip.captions.style);
  return {
    preset: style.preset,
    ...(style.look ? { look: style.look } : {}),
    ...(style.colors ? { colors: style.colors } : {}),
    fontSize: clip.captions.size,
    ...(clip.captions.color ? { fill: clip.captions.color } : {}),
    words: clip.captions.words,
    ...(clip.captions.y !== null ? { y: clip.captions.y } : {}),
  };
}

export function postHook(clip: ClipEdit): PostHook | null {
  return clip.hook.on && clip.hook.text.trim() ? { text: clip.hook.text.trim(), seconds: clip.hook.seconds, size: clip.hook.size, y: clip.hook.y } : null;
}

/**
 * The project options for a clip, given where its start falls in the fetched file. Captions without
 * words heard are left to transcribe when the project is made.
 */
export function clipPostOptions(clip: ClipEdit, offset: number): PostOptions {
  return {
    name: clip.title.trim() || undefined,
    layoutId: clip.layout,
    captions: postCaptions(clip),
    hook: postHook(clip),
    trims: [{ start: offset, duration: round(clip.end - clip.start) }],
    ...(clip.heard && clip.captions.on ? { transcript: clipTranscript(clip) } : {}),
    crops: clip.crops,
  };
}

/** What the project depends on, so an unchanged clip reuses the project it already made. */
export const clipMade = (clip: ClipEdit): string =>
  JSON.stringify([clip.start, clip.end, clip.layout, clip.crops, clip.captions, clip.hook, clip.title, clip.heard ? clipWords(clip) : null]);

// Saved per person; a guest's clips last only while the page is open.
type ClipsDB = IDBPDatabase<{ streams: { key: string; value: ClipStream } }>;
const databases = new Map<string, Promise<ClipsDB>>();

function database(userId: string): Promise<ClipsDB> {
  let open = databases.get(userId);
  if (!open) {
    open = openDB(`plan-video-clips.${userId}`, 1, {
      upgrade(db) {
        db.createObjectStore("streams", { keyPath: "video.id" });
      },
    }) as Promise<ClipsDB>;
    databases.set(userId, open);
  }
  return open;
}

export async function loadStreams(userId: string | undefined): Promise<ClipStream[]> {
  if (!userId) return [];
  try {
    const all = await (await database(userId)).getAll("streams");
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveStream(userId: string | undefined, stream: ClipStream): Promise<void> {
  if (!userId) return;
  await (await database(userId)).put("streams", structuredClone(stream));
}

export async function deleteStream(userId: string | undefined, vod: string): Promise<void> {
  if (!userId) return;
  await (await database(userId)).delete("streams", vod);
}

/** "1:02:03" or "2:03". */
export function clock(seconds: number, tenths = false): string {
  const whole = Math.max(0, seconds);
  const s = Math.floor(whole);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  const tail = tenths ? `.${Math.floor((whole - s) * 10)}` : "";
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}${tail}` : `${m}:${rest}${tail}`;
}

/** Reads "1:02:03", "62:03", "3723" or "1h2m3s" as seconds; null when it can't. */
export function readClock(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const units = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(value);
  if (units && (units[1] || units[2] || units[3])) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(value)) return null;
  return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}
