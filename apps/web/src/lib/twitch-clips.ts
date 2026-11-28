/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { TranscriptWord } from "@plan.video/assets";

import { askForAccount, inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

export type TwitchVideo = { id: string; title: string; seconds: number; channel: string; login: string; game: string };

/** A stretch of the broadcast worth a clip. Words are timed from `start`. */
export type TwitchMoment = {
  start: number;
  end: number;
  score: number;
  title: string;
  caption: string;
  reason: string;
  words: TranscriptWord[];
};

export type ScanStep = { step: "listening" } | { step: "transcribing"; done: number; total: number } | { step: "picking" };

export type ScanResult = { video: TwitchVideo; moments: TwitchMoment[]; note?: string };

type Line =
  | { type: "video"; video: TwitchVideo }
  | ({ type: "step" } & ScanStep)
  | ({ type: "done" } & ScanResult)
  | { type: "error"; status: number; error: string };

export class ClipsRefused extends Error {}

const LINK = /twitch\.tv\/|^\d{6,12}$/i;

/** Whether pasted text looks like a Twitch link, so a paste can start a scan by itself. */
export const looksLikeTwitchLink = (text: string) => LINK.test(text.trim());

async function token(): Promise<string> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) {
    if (inGuestMode()) askForAccount({ reason: "clips" });
    throw new ClipsRefused(t("Sign in to find clips."));
  }
  return session.access_token;
}

async function refusal(response: Response): Promise<ClipsRefused> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return new ClipsRefused(body?.error || t("Finding clips failed ({status})", { status: response.status }));
}

/** Reads the broadcast on the server and calls `onVideo` and `onStep` as it goes. */
export async function scanTwitch(
  link: string,
  { onVideo, onStep, signal }: { onVideo?: (video: TwitchVideo) => void; onStep?: (step: ScanStep) => void; signal?: AbortSignal } = {},
): Promise<ScanResult> {
  let response: Response;
  try {
    response = await fetch("/api/clips/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ link }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ClipsRefused(t("Couldn't reach plan.video. Try again in a moment."));
  }
  if (!response.ok || !response.body) throw await refusal(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    let newline: number;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const text = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!text.trim()) continue;
      const line = JSON.parse(text) as Line;
      if (line.type === "video") onVideo?.(line.video);
      else if (line.type === "step") onStep?.(line);
      else if (line.type === "error") throw new ClipsRefused(line.error);
      else if (line.type === "done") return { video: line.video, moments: line.moments, note: line.note };
    }
  }
  throw new ClipsRefused(t("The connection closed before the clips were found. Try again."));
}

/**
 * The moment's stretch as an MP4 and where in it the moment starts: the file is cut on Twitch's pieces.
 * `preview` gets a small picture, for watching before choosing.
 */
export async function fetchMomentVideo(
  video: TwitchVideo,
  moment: TwitchMoment,
  { signal, preview = false }: { signal?: AbortSignal; preview?: boolean } = {},
): Promise<{ file: File; offset: number }> {
  const query = new URLSearchParams({ vod: video.id, start: String(moment.start), end: String(moment.end), ...(preview ? { quality: "preview" } : {}) });
  let response: Response;
  try {
    response = await fetch(`/api/clips/video?${query}`, { headers: { Authorization: `Bearer ${await token()}` }, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ClipsRefused(t("Couldn't reach plan.video. Try again in a moment."));
  }
  if (!response.ok) throw await refusal(response);
  const offset = Number(response.headers.get("X-Clip-Offset")) || 0;
  const name = `${video.login || "twitch"}-${Math.round(moment.start)}.mp4`;
  return { file: new File([await response.blob()], name, { type: "video/mp4" }), offset };
}
