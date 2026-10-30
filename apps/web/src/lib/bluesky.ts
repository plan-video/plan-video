/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Bluesky, from the browser. An account connects with "Sign in with Bluesky"
// (bluesky-oauth.ts), or with its handle and an app password; then its server
// hands back tokens, which go to plan.video's server (lib/publishing). The app
// password itself is never saved.

import { t } from "@/lib/i18n";
import type { BlueskySession } from "@/lib/social-connections";

const ENTRYWAY = "https://bsky.social";
const APPVIEW = "https://public.api.bsky.app";
/** Bluesky counts a post's length in graphemes. */
export const BLUESKY_TEXT_LIMIT = 300;

type Problem = { error?: string; message?: string };

function explain(problem: Problem | null, fallback: string): string {
  const code = problem?.error ?? "";
  if (code === "AuthenticationRequired" || code === "AuthFactorTokenRequired") {
    return t("Bluesky didn't accept that handle and app password. Make an app password in Bluesky's settings and try again.");
  }
  if (code === "ExpiredToken" || code === "InvalidToken") return t("Bluesky login expired. Connect the account again.");
  if (code === "AccountTakedown" || code === "AccountDeactivated") return t("This Bluesky account can't post right now.");
  if (code === "RateLimitExceeded") return t("Bluesky is limiting posts from this account. Try again in a few minutes.");
  if (code === "BlobTooLarge") return t("That file is too large for Bluesky.");
  const message = problem?.message;
  return typeof message === "string" && message && message.length < 300 ? message : fallback;
}

/** Sends one XRPC call to a Bluesky server. */
type BlueskySend = (method: string, init: RequestInit) => Promise<Response>;

function direct(base: string, token?: string): BlueskySend {
  return (method, init) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(`${base}/xrpc/${method}`, { ...init, headers });
  };
}

async function xrpc<T>(base: string, method: string, init: RequestInit & { token?: string } = {}, fallback = t("Bluesky refused the request.")): Promise<T> {
  const { token, ...rest } = init;
  return call<T>(direct(base, token), method, rest, fallback);
}

async function call<T>(send: BlueskySend, method: string, init: RequestInit = {}, fallback = t("Bluesky refused the request.")): Promise<T> {
  let response: Response;
  try {
    response = await send(method, init);
  } catch {
    throw new Error(t("Couldn't reach Bluesky. Try again in a moment."));
  }
  const payload = (await response.json().catch(() => null)) as (T & Problem) | null;
  if (!response.ok) throw Object.assign(new Error(explain(payload, fallback)), { code: payload?.error ?? "" });
  if (!payload) throw new Error(t("Bluesky sent an empty reply."));
  return payload;
}

/** `name`, `@name` or `name.bsky.social` as Bluesky writes a handle. */
export function cleanBlueskyHandle(raw: string): string {
  const handle = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!handle || handle.startsWith("did:")) return handle;
  return handle.includes(".") ? handle : `${handle}.bsky.social`;
}

/** The server the account lives on, from its DID document. */
async function serverFor(handle: string): Promise<{ did: string; pds: string }> {
  const { did } = handle.startsWith("did:")
    ? { did: handle }
    : await xrpc<{ did: string }>(ENTRYWAY, `com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, {}, t("Bluesky doesn't know that handle."));
  let documentUrl: string;
  if (did.startsWith("did:plc:")) documentUrl = `https://plc.directory/${did}`;
  else if (did.startsWith("did:web:")) documentUrl = `https://${did.slice("did:web:".length)}/.well-known/did.json`;
  else throw new Error(t("That Bluesky account uses an identity plan.video can't read."));
  const document = (await fetch(documentUrl).then((response) => (response.ok ? response.json() : null)).catch(() => null)) as {
    service?: { id?: string; type?: string; serviceEndpoint?: string }[];
  } | null;
  const service = document?.service?.find((item) => item.id?.endsWith("#atproto_pds") || item.type === "AtprotoPersonalDataServer");
  const pds = service?.serviceEndpoint;
  if (typeof pds !== "string" || !/^https:\/\//.test(pds)) throw new Error(t("Couldn't find this Bluesky account's server."));
  return { did, pds: pds.replace(/\/+$/, "") };
}

type SessionReply = { did: string; handle: string; accessJwt: string; refreshJwt: string };

/** Signs in with an app password and returns the account and its tokens. The password goes no further. */
export async function signInToBluesky(rawHandle: string, appPassword: string): Promise<BlueskySession & { handle: string; avatarUrl: string }> {
  const handle = cleanBlueskyHandle(rawHandle);
  if (!handle) throw new Error(t("Enter your Bluesky handle."));
  if (!appPassword.trim()) throw new Error(t("Enter an app password from Bluesky's settings."));
  const { did, pds } = await serverFor(handle);
  const session = await xrpc<SessionReply>(pds, "com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: did, password: appPassword.trim() }),
  });
  const avatarUrl = await loadBlueskyAvatar(session.did).catch(() => "");
  return { did: session.did, pds, accessJwt: session.accessJwt, refreshJwt: session.refreshJwt, handle: session.handle, avatarUrl };
}

/** The account's picture from Bluesky's public view, or empty. */
export async function loadBlueskyAvatar(did: string): Promise<string> {
  const profile = await xrpc<{ avatar?: string }>(APPVIEW, `app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
  return typeof profile.avatar === "string" && profile.avatar.startsWith("https://") ? profile.avatar : "";
}

/** The account's handle and picture from Bluesky's public view, for an account that signed in with Bluesky. */
export async function loadBlueskyProfile(did: string): Promise<{ handle: string; avatarUrl: string }> {
  const profile = await xrpc<{ handle?: string; avatar?: string }>(APPVIEW, `app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
  const avatarUrl = typeof profile.avatar === "string" && profile.avatar.startsWith("https://") ? profile.avatar : "";
  return { handle: typeof profile.handle === "string" && profile.handle !== "handle.invalid" ? profile.handle : did, avatarUrl };
}

function graphemes(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

/** How long a post or a plug's reply is, the way Bluesky counts it. */
export const blueskyLength = graphemes;
