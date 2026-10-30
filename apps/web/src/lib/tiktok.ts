/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { appOrigins, atThisSite } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { supabase } from "@/lib/supabase";
import { askNetwork, exchangeOnServer } from "@/lib/publishing";
import { loginReady, type TikTokSession } from "@/lib/social-connections";
import type { TikTokPrivacy } from "@/lib/social";

const TIKTOK_ORIGINS = new Set([...appOrigins(), "http://localhost:5173"]);

/** Must match a URI saved on the TikTok app exactly. */
export function tiktokRedirect(): string {
  if (!TIKTOK_ORIGINS.has(window.location.origin)) throw new Error(atThisSite(t("Open https://plan.video to connect TikTok.")));
  return `${window.location.origin}/tiktok/callback`;
}

const STATE_KEY = "plan.video.tiktok.state";
const VERIFIER_KEY = "plan.video.tiktok.verifier";

/** Never TikTok's tokens. */
type Exchanged = {
  openId?: string;
  displayName?: string;
  avatarUrl?: string;
  expiresAt?: number;
  scope?: string;
  ticket?: string;
};

export function rememberTikTokState(): string {
  const state = crypto.randomUUID();
  keepForLogin(STATE_KEY, state);
  return state;
}

export function takeTikTokState(): string | null {
  return takeFromLogin(STATE_KEY);
}

export async function tiktokAuthorizeUrl(state: string): Promise<string> {
  const verifier = codeVerifier();
  keepForLogin(VERIFIER_KEY, verifier);
  const { url, error } = await post<{ url?: string; error?: string }>("/api/tiktok/authorize", {
    redirectUri: tiktokRedirect(),
    state,
    codeChallenge: await codeChallenge(verifier),
  });
  if (!url) throw new Error(error || t("Couldn't start TikTok login."));
  return url;
}

/** The publisher swaps the code for the login and keeps it; this gets a ticket to attach it. */
export async function exchangeTikTokCode(code: string): Promise<TikTokSession & { displayName: string; avatarUrl: string }> {
  const codeVerifier = takeFromLogin(VERIFIER_KEY);
  const found = await exchangeOnServer<Exchanged>("tiktok/exchange", { code, redirectUri: tiktokRedirect(), codeVerifier }, t("Couldn't reach TikTok. Try again in a moment."));
  if (!found.ticket || !found.openId) throw new Error(t("TikTok didn't return a login."));
  return {
    displayName: found.displayName || found.openId,
    avatarUrl: found.avatarUrl || "",
    openId: found.openId,
    ticket: found.ticket,
    expiresAt: found.expiresAt || 0,
    scope: found.scope || "",
  };
}

/** The publisher keeps the account's login and reads with it once the login has reached it. */
async function askTikTok<T>(route: "tiktok/profile" | "tiktok/videos" | "tiktok/creator", accountId: string): Promise<T> {
  await loginReady(accountId);
  return askNetwork<T>(route, accountId, t("Couldn't reach TikTok. Try again in a moment."));
}

export type TikTokVideoStats = { id: string; title: string; postedAt: number; cover?: string; views: number; likes: number; comments: number };

/** TikTok keeps no numbers per day. */
export async function loadTikTokVideos(accountId: string): Promise<TikTokVideoStats[]> {
  const result = await askTikTok<{ videos?: TikTokVideoStats[] }>("tiktok/videos", accountId);
  return result.videos ?? [];
}

/** Empty when TikTok has none. */
export async function loadTikTokAvatar(accountId: string): Promise<string> {
  const result = await askTikTok<{ avatarUrl?: string }>("tiktok/profile", accountId);
  return result.avatarUrl || "";
}

export type TikTokCreator = {
  nickname: string;
  username: string;
  avatarUrl: string;
  /** The picker lists these and nothing else. */
  privacy: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoSeconds: number;
};

const PRIVACY_FROM_API: Record<string, TikTokPrivacy> = {
  PUBLIC_TO_EVERYONE: "public",
  MUTUAL_FOLLOW_FRIENDS: "friends",
  FOLLOWER_OF_CREATOR: "followers",
  SELF_ONLY: "private",
};

/** Read again each time the post screen opens. */
export async function loadTikTokCreator(accountId: string): Promise<TikTokCreator> {
  const result = await askTikTok<{ data?: Record<string, unknown> }>("tiktok/creator", accountId);
  const data = result.data ?? {};
  const listed = Array.isArray(data.privacy_level_options) ? data.privacy_level_options : [];
  const privacy = listed.flatMap((item) => {
    const mapped = typeof item === "string" ? PRIVACY_FROM_API[item] : undefined;
    return mapped ? [mapped] : [];
  });
  if (!privacy.length) throw new Error(t("TikTok didn't say who can watch this post. Try again in a minute."));
  const max = Number(data.max_video_post_duration_sec);
  return {
    nickname: typeof data.creator_nickname === "string" && data.creator_nickname ? data.creator_nickname : "TikTok",
    username: typeof data.creator_username === "string" ? data.creator_username : "",
    avatarUrl: typeof data.creator_avatar_url === "string" ? data.creator_avatar_url : "",
    privacy,
    commentDisabled: data.comment_disabled === true,
    duetDisabled: data.duet_disabled === true,
    stitchDisabled: data.stitch_disabled === true,
    maxVideoSeconds: Number.isFinite(max) && max > 0 ? max : 10 * 60,
  };
}

/** An older connection has to be made again. */
export function tiktokAllows(scope: string, name: string): boolean {
  return scope.split(/[,\s]+/).includes(name);
}

/** 43 characters, inside TikTok's 43–128 range. */
function codeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** TikTok's desktop login wants the SHA-256 hash as hex, not base64url. */
async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function post<T extends { error?: string }>(path: string, body: unknown): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to connect TikTok."));
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(t("Couldn't reach TikTok. Try again in a moment."));
  }
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload) throw new Error(t("TikTok sent an empty reply."));
  if (!response.ok && payload.error) throw new Error(payload.error);
  return payload;
}
