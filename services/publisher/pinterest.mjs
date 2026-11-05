// Trial apps can only write to Pinterest's sandbox, whose logins and boards are its own, so PINTEREST_SANDBOX
// moves every call there. Sandbox Pins show only to whoever made them: leave it off to post for real.

import { PublishError } from "./errors.mjs";

export const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"];

export const configured = (app) => !!(app?.appId && app?.appSecret);

export const apiOf = (app) => (app?.sandbox ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5");

export const redirectFor = (publicUrl) => `${publicUrl}/pinterest/callback`;

/** A login lasts 30 days and its refresh token 60. Renewing once a week of use keeps an account posting monthly connected. */
export const RENEW_AFTER_MS = 7 * 24 * 60 * 60_000;
const AHEAD_MS = 10 * 60_000;
const BOARD_PAGES = 20;

export function authorizeUrl(app, { redirectUri, state }) {
  return `https://www.pinterest.com/oauth/?${new URLSearchParams({ client_id: app.appId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(","), state })}`;
}

/** Resolves to `{ ok, status, data, message }`, status 0 with no answer. Never throws. */
export async function pinterestFetch(app, path, { method = "GET", token, json, timeout = 30_000 } = {}) {
  const response = await fetch(`${apiOf(app)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    ...(json ? { body: JSON.stringify(json) } : {}),
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
  if (!response) return { ok: false, status: 0, data: null, message: "" };
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, message: typeof data?.message === "string" ? data.message : "" };
}

async function tokenRequest(app, fields) {
  const response = await fetch(`${apiOf(app)}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${app.appId}:${app.appSecret}`).toString("base64")}` },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) return { status: 0, data: null };
  return { status: response.status, data: await response.json().catch(() => null) };
}

const lifetime = (seconds) => (Number(seconds) > 0 ? Number(seconds) * 1000 : 30 * 24 * 60 * 60_000);

/** Throws `Error` with words to show when it can't. */
export async function exchangeCode(app, { code, redirectUri, now = Date.now() }) {
  const { data } = await tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!data?.access_token) throw new Error(typeof data?.message === "string" && data.message ? data.message : "Pinterest didn't accept the login. Try again.");
  const me = await pinterestFetch(app, "/user_account", { token: data.access_token });
  if (!me.ok) throw new Error(me.message || "Couldn't read the Pinterest account. Try again.");
  const accountId = me.data?.id || me.data?.username;
  if (!accountId) throw new Error("Pinterest didn't say which account this is. Try again.");
  return {
    accountId: String(accountId),
    handle: me.data.username || me.data.business_name || "Pinterest",
    avatarUrl: me.data.profile_image || "",
    session: {
      accountId: String(accountId),
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      expiresAt: now + lifetime(data.expires_in),
      renewedAt: now,
      scope: typeof data.scope === "string" ? data.scope : SCOPES.join(","),
    },
  };
}

/** Null when the one kept is fine, or still works after a renewal that failed: that's tried again next time. */
export async function renewed(session, app, now = Date.now()) {
  const running = session.expiresAt - now > AHEAD_MS;
  if (running && now - (session.renewedAt || 0) < RENEW_AFTER_MS) return null;
  const expired = new PublishError("Pinterest login expired. Connect the account again in Connections.", { expired: true });
  if (!session.refreshToken) {
    if (running) return null;
    throw expired;
  }
  const { status, data } = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: session.refreshToken });
  if (data?.access_token) {
    return {
      ...session,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || session.refreshToken,
      expiresAt: now + lifetime(data.expires_in),
      renewedAt: now,
      scope: typeof data.scope === "string" && data.scope ? data.scope : session.scope,
    };
  }
  if (running) return null;
  if (status >= 400 && status < 500 && status !== 429) throw expired;
  throw new PublishError("Pinterest didn't renew the login. Trying again soon.", { retry: true });
}

/** The account's name and picture now. */
export async function profileFor(app, session) {
  const answer = await pinterestFetch(app, "/user_account", { token: session.accessToken });
  if (!answer.ok) return { error: answer.message || "Couldn't reach Pinterest. Try again in a moment." };
  return { handle: answer.data?.username || "", avatarUrl: answer.data?.profile_image || "", followers: answer.data?.follower_count ?? null };
}

/** Every board the account can post to. Throws a PublishError when Pinterest can't be read. */
export async function boardsOf(app, session) {
  const boards = [];
  let bookmark = "";
  for (let page = 0; page < BOARD_PAGES; page++) {
    const answer = await pinterestFetch(app, `/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`, { token: session.accessToken });
    if (!answer.ok) throw errorFrom(answer, "read your boards");
    for (const board of answer.data?.items ?? []) if (board?.id && typeof board.name === "string") boards.push({ id: String(board.id), name: board.name });
    bookmark = typeof answer.data?.bookmark === "string" ? answer.data.bookmark : "";
    if (!bookmark) break;
  }
  return boards;
}

/** A gone login asks for a reconnect; too many requests, trouble on their side or no answer is tried again. */
export function errorFrom(answer, what) {
  if (answer.status === 0) return new PublishError("Couldn't reach Pinterest. Trying again soon.", { retry: true });
  if (answer.status === 401) return new PublishError("Pinterest login expired. Connect the account again in Connections.", { expired: true });
  if (answer.status === 429) return new PublishError("Pinterest is limiting this account for now. Trying again later.", { retry: true });
  if (answer.status >= 500) return new PublishError(`Pinterest couldn't ${what} just now. Trying again soon.`, { retry: true });
  const said = answer.message && answer.message.length < 300 ? `: ${answer.message}` : ".";
  return new PublishError(`Pinterest didn't ${what}${said}`);
}
