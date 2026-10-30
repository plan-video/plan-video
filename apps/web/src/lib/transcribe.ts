/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript, TranscriptWord } from "@plan.video/assets";

import { askForAccount, inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

/** Times are seconds. */
export interface ClipTiming {
  /** Scene time at which media time 0 is heard. */
  origin: number;
  /** 2 plays the file twice as fast. */
  rate: number;
  /** Media time of the first sample that is actually played. */
  trimStart: number;
  trimEnd: number;
  /** For when speed changes along the clip. */
  at?: (mediaSeconds: number) => number;
}

/** Less of a word than this inside the trim is a sliver of sound, not the word. */
const MIN_HEARD_SECONDS = 0.05;

/** A word cut by the trim ends with it: a recognizer stretches the last word of cut-off audio past its end. */
export function placeClipWords(transcript: Transcript, clip: ClipTiming, mediaStart: number): TranscriptWord[] {
  const rate = clip.rate || 1;
  const words: TranscriptWord[] = [];

  for (const segment of transcript) {
    for (const word of segment.words) {
      const media0 = Math.max(clip.trimStart, mediaStart + word.start);
      const media1 = Math.min(clip.trimEnd, mediaStart + word.end);
      if (media1 - media0 < MIN_HEARD_SECONDS) continue;
      words.push({
        ...word,
        start: clip.at ? clip.at(media0) : clip.origin + media0 / rate,
        end: clip.at ? clip.at(media1) : clip.origin + media1 / rate,
      });
    }
  }

  return words;
}

const PAUSE_SECONDS = 0.45;

export function segmentWords(words: TranscriptWord[]): Transcript {
  const sorted = [...words].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Transcript = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    segments.push({ text: current.map((word) => word.text).join(" "), words: current });
    current = [];
  };

  for (const word of sorted) {
    const previous = current[current.length - 1];
    if (previous && word.start - previous.end > PAUSE_SECONDS) flush();
    current.push(word);
    if (/[.!?]$/.test(word.text)) flush();
  }

  flush();
  return segments;
}

/** Signed out, not set up or out of quota: sending again another way gets the same answer. */
export class TranscriptionRefused extends Error {}

const BUSY_GIVE_UP_MS = 3 * 60_000;

/** Grows with each try and is jittered, so everyone turned away at once doesn't come back at once. */
function busyWait(response: Response, payload: unknown, attempt: number): number | null {
  const after = response.status === 503 && payload && typeof payload === "object" && "retryAfter" in payload ? Number(payload.retryAfter) : NaN;
  if (!Number.isFinite(after) || after <= 0) return null;
  return Math.min(30_000, after * 1000 * 2 ** Math.min(attempt, 3)) * (0.5 + Math.random());
}

/** The server holds the ElevenLabs key; it never reaches the browser. */
export async function transcribeAudio(audio: Blob): Promise<Transcript> {
  const started = Date.now();
  let response: Response;
  let payload: Transcript | { error?: string; retryAfter?: number } | null;
  for (let attempt = 0; ; attempt++) {
    // Asked each time: a long wait can outlast the sign-in token.
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    if (!session) {
      // Captions are worked out on the server: a guest is asked to make an account.
      if (inGuestMode()) askForAccount({ reason: "captions" });
      throw new TranscriptionRefused(t("Sign in to generate captions."));
    }

    try {
      response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/wav", Authorization: `Bearer ${session.access_token}` },
        body: audio,
      });
    } catch {
      throw new TranscriptionRefused(t("Couldn't reach the transcription service. Try again in a moment."));
    }

    payload = (await response.json().catch(() => null)) as typeof payload;
    const wait = busyWait(response, payload, attempt);
    if (wait === null || Date.now() - started + wait > BUSY_GIVE_UP_MS) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  if (!response.ok || !Array.isArray(payload)) {
    const message = payload && !Array.isArray(payload) ? payload.error : undefined;
    throw new TranscriptionRefused(message || t("Transcription failed ({status})", { status: response.status }));
  }
  return payload;
}
