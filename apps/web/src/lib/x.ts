/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The client secret and X's tokens stay on the server (services/x, services/publisher);
// the browser only gets a ticket for the publisher. X bills per post, so only paid plans post.

import { appOrigins, atThisSite } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { supabase } from "@/lib/supabase";
import { exchangeXOnServer } from "@/lib/publishing";
import type { XSession } from "@/lib/social-connections";

/** Must match the X app's saved callbacks exactly. X won't take localhost. */
const X_ORIGINS = new Set([...appOrigins(), "http://127.0.0.1:5173"]);

const STATE_KEY = "plan.video.x.state";
const VERIFIER_KEY = "plan.video.x.verifier";

export function xRedirect(): string {
  if (!X_ORIGINS.has(window.location.origin)) throw new Error(atThisSite(t("Open https://plan.video to connect X.")));
  return `${window.location.origin}/x/callback`;
}

/** Never X's tokens: who it is, and its login sealed for the server. */
type Exchanged = {
  xUserId?: string;
  username?: string;
  avatarUrl?: string;
  expiresAt?: number;
  scope?: string;
  ticket?: string;
};

export function rememberXState(): string {
  const state = crypto.randomUUID();
  keepForLogin(STATE_KEY, state);
  return state;
}

export function takeXState(): string | null {
  return takeFromLogin(STATE_KEY);
}

export async function xAuthorizeUrl(state: string): Promise<string> {
  const verifier = codeVerifier();
  keepForLogin(VERIFIER_KEY, verifier);
  const { url, error } = await post<{ url?: string; error?: string }>("/api/x/authorize", {
    redirectUri: xRedirect(),
    state,
    codeChallenge: await codeChallenge(verifier),
  });
  if (!url) throw new Error(error || t("Couldn't start X login."));
  return url;
}

export async function exchangeXCode(code: string): Promise<XSession & { handle: string; avatarUrl: string }> {
  const codeVerifier = takeFromLogin(VERIFIER_KEY);
  const found = await exchangeXOnServer<Exchanged>({ code, redirectUri: xRedirect(), codeVerifier });
  if (!found.ticket || !found.xUserId) throw new Error(t("X didn't return a login."));
  return {
    handle: found.username || "X",
    avatarUrl: found.avatarUrl || "",
    xUserId: found.xUserId,
    ticket: found.ticket,
    expiresAt: found.expiresAt || 0,
    scope: found.scope || "",
  };
}

/** 32 random bytes, which is 43 characters, the shortest verifier OAuth allows. */
function codeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

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
  if (!session) throw new Error(t("Sign in to connect X."));
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(t("Couldn't reach X. Try again in a moment."));
  }
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload) throw new Error(t("X sent an empty reply."));
  if (!response.ok && payload.error) throw new Error(payload.error);
  return payload;
}
