/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { appOrigins, atThisSite } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { supabase } from "@/lib/supabase";
import { askYouTube } from "@/lib/publishing";
import { loginReady, type YouTubeSession } from "@/lib/social-connections";

const YOUTUBE_ORIGINS = new Set([...appOrigins(), "http://localhost:5173"]);

/** Must match a URI saved on the Google client exactly. */
export function youtubeRedirect(): string {
  if (!YOUTUBE_ORIGINS.has(window.location.origin)) throw new Error(atThisSite(t("Open https://plan.video to connect YouTube.")));
  return `${window.location.origin}/youtube/callback`;
}

const STATE_KEY = "plan.video.youtube.state";
const VERIFIER_KEY = "plan.video.youtube.verifier";

/** Never YouTube's tokens. */
type Exchanged = {
  channelId: string;
  handle: string;
  avatarUrl: string;
  expiresAt: number;
  scope: string;
  ticket: string;
};

export function rememberYouTubeState(): string {
  const state = crypto.randomUUID();
  keepForLogin(STATE_KEY, state);
  return state;
}

export function takeYouTubeState(): string | null {
  return takeFromLogin(STATE_KEY);
}

export async function youtubeAuthorizeUrl(state: string): Promise<string> {
  const verifier = codeVerifier();
  keepForLogin(VERIFIER_KEY, verifier);
  const { url, error } = await post<{ url?: string; error?: string }>("/api/youtube/authorize", {
    redirectUri: youtubeRedirect(),
    state,
    codeChallenge: await codeChallenge(verifier),
  });
  if (!url) throw new Error(error || t("Couldn't start YouTube login."));
  return url;
}

/** The server swaps the code for the login and keeps it; this gets a ticket to attach it. */
export async function exchangeYouTubeCode(code: string): Promise<YouTubeSession & { handle: string; avatarUrl: string }> {
  const codeVerifier = takeFromLogin(VERIFIER_KEY);
  const found = await askYouTube<Exchanged>("youtube/exchange", { code, redirectUri: youtubeRedirect(), codeVerifier });
  if (!found.ticket) throw new Error(t("YouTube didn't return a login."));
  return {
    handle: found.handle || "YouTube",
    avatarUrl: found.avatarUrl || "",
    channelId: found.channelId || "",
    ticket: found.ticket,
    expiresAt: found.expiresAt,
    scope: found.scope || "",
  };
}

/** `date` is YYYY-MM-DD, as YouTube counts days. */
export type YouTubeDay = { date: string; views: number; likes: number; comments: number };

export type YouTubeVideoStats = { id: string; title: string; postedAt: number; cover?: string; views: number; likes: number; comments: number };

/** With `videoId`, that one video's days, and no videos. */
export async function loadYouTubeAnalytics(
  accountId: string,
  startDate: string,
  endDate: string,
  videoId?: string,
): Promise<{ days: YouTubeDay[]; videos: YouTubeVideoStats[] }> {
  await loginReady(accountId);
  const result = await askYouTube<{ days?: YouTubeDay[]; videos?: YouTubeVideoStats[] }>("youtube/analytics", {
    connectionId: accountId,
    startDate,
    endDate,
    ...(videoId ? { videoId } : {}),
  });
  return { days: result.days ?? [], videos: result.videos ?? [] };
}

/** Null when the login can't read the channel. */
export async function loadYouTubeChannel(accountId: string): Promise<{ handle: string; avatarUrl: string } | null> {
  await loginReady(accountId);
  const channel = await askYouTube<{ channelId?: string; handle?: string; avatarUrl?: string }>("youtube/profile", { connectionId: accountId });
  return channel.channelId ? { handle: channel.handle ?? "", avatarUrl: channel.avatarUrl ?? "" } : null;
}

/** Empty when the login can't read the channel. */
export async function loadYouTubeAvatar(accountId: string): Promise<string> {
  await loginReady(accountId);
  return (await askYouTube<{ avatarUrl?: string }>("youtube/profile", { connectionId: accountId })).avatarUrl || "";
}

function codeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** Google wants the SHA-256 hash as base64url, not hex. */
async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function post<T extends { error?: string }>(path: string, body: unknown): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to connect YouTube."));
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(t("Couldn't reach YouTube. Try again in a moment."));
  }
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload) throw new Error(t("YouTube sent an empty reply."));
  if (!response.ok && payload.error) throw new Error(payload.error);
  return payload;
}
