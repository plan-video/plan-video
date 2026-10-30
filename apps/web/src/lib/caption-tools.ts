/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The server (services/agent/captions.mjs) gets only the words; its answer is fitted
// back onto the transcript here, so every word keeps its timing.

import { groupBy } from "@plan.video/runtime";

import { askForAccount, inGuestMode } from "@/lib/guest";
import { msg, t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

import type { Transcript, TranscriptWord, TranscriptWordStyle } from "@plan.video/assets";

export type CaptionTask = "emoji" | "keywords" | "translate";

type Pick = { line: number; word: number };

type Answer = {
  emoji: { emoji: (Pick & { emoji: string })[] };
  keywords: { keywords: Pick[] };
  translate: { lines: string[] };
};

export const TRANSLATE_LANGUAGES = [
  "en", "es", "pt", "fr", "de", "it", "nl", "pl", "tr", "ru", "uk", "ar",
  "hi", "id", "vi", "th", "ja", "ko", "zh-Hans", "zh-Hant", "sv", "ro", "el", "he",
] as const;

export function languageLabel(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export class CaptionToolRefused extends Error {}

const linesOf = (transcript: Transcript) => transcript.map((segment) => segment.words.map((word) => word.text));

async function ask<T extends CaptionTask>(task: T, transcript: Transcript, language?: string): Promise<Answer[T]> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) {
    if (inGuestMode()) askForAccount({ reason: "captions" });
    throw new CaptionToolRefused(t("Sign in to use caption tools."));
  }

  let response: Response;
  try {
    response = await fetch("/api/agent/captions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ task, lines: linesOf(transcript), ...(language ? { language } : {}) }),
    });
  } catch {
    throw new CaptionToolRefused(t("Couldn't reach the server. Try again in a moment."));
  }

  const payload = (await response.json().catch(() => null)) as (Answer[T] & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new CaptionToolRefused(payload?.error || t("That didn't work ({status})", { status: response.status }));
  }
  return payload;
}

const clone = (transcript: Transcript): Transcript =>
  transcript.map((segment) => ({
    text: segment.text,
    words: segment.words.map((word) => ({ ...word, ...(word.style ? { style: { ...word.style } } : {}) })),
  }));

const retitle = (segment: { text: string; words: TranscriptWord[] }) => {
  segment.text = segment.words.map((word) => word.text).join(" ");
};

// Alternatives rather than one character class, where the joiners and variation
// marks would read as joined to what's before them.
const EMOJI = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;

export const hasEmoji = (transcript: Transcript) =>
  transcript.some((segment) => segment.words.some((word) => /\p{Extended_Pictographic}/u.test(word.text)));

export async function addEmoji(transcript: Transcript): Promise<Transcript> {
  const { emoji } = await ask("emoji", stripEmoji(transcript));
  const numbering = keptPositions(transcript);
  const picked = new Map<number, string>();
  for (const pick of emoji) {
    const position = numbering[pick.line]?.[pick.word];
    if (position !== undefined) picked.set(position, pick.emoji);
  }

  let position = 0;
  const next = clone(transcript);
  for (const segment of next) {
    for (const word of segment.words) {
      const add = picked.get(position++);
      if (add && !/\p{Extended_Pictographic}/u.test(word.text)) word.text = `${word.text} ${add}`;
    }
    retitle(segment);
  }
  return next;
}

export function stripEmoji(transcript: Transcript): Transcript {
  const next: Transcript = [];
  for (const segment of clone(transcript)) {
    const words = segment.words
      .map((word) => ({ ...word, text: word.text.replace(EMOJI, "").replace(/\s{2,}/g, " ").trim() }))
      .filter((word) => word.text.length > 0);
    if (words.length === 0) continue;
    const kept = { text: "", words };
    retitle(kept);
    next.push(kept);
  }
  return next;
}

/** Positions count across the whole transcript. */
export async function pickKeywords(transcript: Transcript): Promise<Set<number>> {
  const { keywords } = await ask("keywords", stripEmoji(transcript));
  // Emoji-only words were left out of what the server saw; count them back in.
  const numbering = keptPositions(transcript);
  const positions = new Set<number>();
  for (const pick of keywords) {
    const position = numbering[pick.line]?.[pick.word];
    if (position !== undefined) positions.add(position);
  }
  return positions;
}

function keptPositions(transcript: Transcript): number[][] {
  const lines: number[][] = [];
  let position = 0;
  for (const segment of transcript) {
    const line: number[] = [];
    for (const word of segment.words) {
      if (word.text.replace(EMOJI, "").trim()) line.push(position);
      position++;
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** Words that wore `previous` but aren't at `positions` lose it. */
export function highlightWords(transcript: Transcript, positions: ReadonlySet<number>, color: number, previous?: number): Transcript {
  let position = 0;
  return transcript.map((segment) => ({
    text: segment.text,
    words: segment.words.map((word) => {
      const picked = positions.has(position++);
      const wore = previous !== undefined && word.style?.color === previous;
      if (!picked && !wore) return { ...word };
      const style: TranscriptWordStyle = { ...word.style };
      if (picked) style.color = color;
      else delete style.color;
      const copy: TranscriptWord = { ...word };
      if (Object.keys(style).length > 0) copy.style = style;
      else delete copy.style;
      return copy;
    }),
  }));
}

const KANA_ONLY = /^[\p{Script=Hiragana}ー]+$/u;
const DIGITS_ONLY = /^[\d０-９.,]+$/u;

/** Split by spaces, or by the language's word breaks for scripts written without them. */
function splitLine(text: string, language: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/\s/.test(trimmed) || typeof Intl.Segmenter !== "function") return trimmed.split(/\s+/);

  const words: string[] = [];
  for (const part of new Intl.Segmenter(language, { granularity: "word" }).segment(trimmed)) {
    const previous = words.at(-1);
    // Punctuation, Japanese endings and particles go with the word before;
    // a number goes with what it counts.
    const joins = previous !== undefined && (!part.isWordLike || KANA_ONLY.test(part.segment) || DIGITS_ONLY.test(previous));
    if (joins) words[words.length - 1] += part.segment;
    else words.push(part.segment);
  }
  return words.filter((word) => word.trim());
}

/**
 * Each line is translated whole; its words share the original line's time, longer words
 * for longer. The words' own looks don't carry over.
 */
export async function translateTranscript(transcript: Transcript, language: string): Promise<Transcript> {
  const { lines } = await ask("translate", transcript, language);
  return transcript.flatMap((segment, index) => {
    const first = segment.words[0];
    const last = segment.words.at(-1);
    const words = splitLine(lines[index] ?? "", language);
    if (!first || !last || words.length === 0) return [];

    const start = first.start;
    const span = Math.max(0.05 * words.length, last.end - start);
    const weights = words.map((word) => [...word].length + 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let at = start;
    const timed = words.map((text, i) => {
      const length = (span * weights[i]!) / total;
      const word = { text, start: round(at), end: round(at + length) };
      at += length;
      return word;
    });
    return [{ text: timed.map((word) => word.text).join(" "), words: timed }];
  });
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** About two short subtitle lines per cue. */
const SRT_GROUPING = { length: 42, words: 10 };

/** `toSeconds` returns null while the caption is off screen; those words are left out of their cue. */
export function transcriptToSrt(transcript: Transcript, toSeconds: (time: number) => number | null): string {
  const cues: string[] = [];
  for (const group of groupBy(transcript, SRT_GROUPING)) {
    const shown = group
      .map((word) => ({ text: word.text, start: toSeconds(word.start), end: toSeconds(word.end) }))
      .filter((word): word is { text: string; start: number; end: number } => word.start !== null && word.end !== null);
    if (shown.length === 0) continue;
    const start = shown[0]!.start;
    const end = Math.max(start + 0.2, shown.at(-1)!.end);
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${shown.map((word) => word.text).join(" ")}\n`);
  }
  return cues.join("\n");
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export const TOOL_FAILURES: Record<CaptionTask, string> = {
  emoji: msg("Could not add emoji"),
  keywords: msg("Could not highlight keywords"),
  translate: msg("Could not translate the captions"),
};
