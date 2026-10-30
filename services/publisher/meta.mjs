// Meta's three networks: Instagram (professional accounts, through Instagram's
// own login, so no Facebook Page is needed), Facebook Pages (Facebook Login
// for Business) and Threads. Each has its own app id and secret, in
// /etc/plan-video/meta.env, its own host, and the same Graph API shape: a
// JSON answer, or `{ error: { message, code, error_subcode } }`.
//
// This file holds what connecting, posting and reading numbers share: the
// sign-in links, swapping a code for a login, renewing it, and calling the
// API with one. The networks' posting is in networks/instagram.mjs,
// networks/facebook.mjs and networks/threads.mjs, and their numbers in
// meta-analytics.mjs.

import { PublishError } from "./errors.mjs";

/** Facebook's Graph API version. Instagram's login uses the same numbers; Threads has its own v1.0. */
export const GRAPH_VERSION = "v26.0";

export const META_NETWORKS = ["instagram", "facebook", "threads"];

export const META_NAMES = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

/** Where each network's API is, with its version. */
export const API = {
  instagram: `https://graph.instagram.com/${GRAPH_VERSION}`,
  facebook: `https://graph.facebook.com/${GRAPH_VERSION}`,
  threads: "https://graph.threads.net/v1.0",
};

/** What plan.video asks each network for. Facebook's come from the login configuration when there is one. */
export const SCOPES = {
  instagram: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"],
  facebook: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "pages_read_user_content", "read_insights", "business_management"],
  threads: ["threads_basic", "threads_content_publish", "threads_manage_insights"],
};

/**
 * The address a network's login comes back to, on the site at `publicUrl`
 * (PUBLIC_URL in publisher.env): saved on the Meta app, exactly.
 */
export const redirectFor = (publicUrl, network) => `${publicUrl}/${network}/callback`;

/** Instagram's and Threads' logins last 60 days and are renewed once this old, while they're used. */
export const RENEW_AFTER_MS = 7 * 24 * 60 * 60_000;
/** Neither renews a login less than a day old. */
const RENEWABLE_FROM_MS = 24 * 60 * 60_000;

/** Codes Meta answers with when an app or account is asking too often. */
const BUSY = new Set([4, 17, 32, 613, 80001, 80002, 80006]);

export const isMetaNetwork = (value) => META_NETWORKS.includes(value);

/** Whether the app's id and secret for the network are on the server. */
export const configured = (network, env) => !!(env?.[network]?.appId && env?.[network]?.appSecret);

/** The login dialog's address. Facebook's asks which Pages to share. */
export function authorizeUrl(network, env, { redirectUri, state }) {
  const app = env[network];
  if (network === "instagram") {
    return `https://www.instagram.com/oauth/authorize?${new URLSearchParams({
      client_id: app.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.instagram.join(","),
      state,
    })}`;
  }
  if (network === "threads") {
    return `https://threads.net/oauth/authorize?${new URLSearchParams({
      client_id: app.appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.threads.join(","),
      state,
    })}`;
  }
  // Facebook Login for Business takes the permissions from a configuration made in the app's dashboard.
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${new URLSearchParams({
    client_id: app.appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    ...(app.configId ? { config_id: app.configId } : { scope: SCOPES.facebook.join(",") }),
  })}`;
}

/**
 * Calls one of Meta's APIs. Resolves to `{ ok, status, data, error }`, where
 * `error` is Meta's `{ message, code, subcode }`, or `{ lost: true }` when
 * there was no answer. Never throws.
 */
export async function metaFetch(url, { method = "GET", token, form, json, headers = {}, timeout = 30_000 } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeout) };
  // In the address, which every one of the three takes, rather than a header Threads may not.
  if (token) url = `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  if (form) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(Object.entries(form).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]));
  } else if (json) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(json);
  }
  const response = await fetch(url, init).catch(() => null);
  if (!response) return { ok: false, status: 0, data: null, error: { lost: true, message: "" } };
  const data = await response.json().catch(() => null);
  const failed = data?.error;
  if (response.ok && data && !failed) return { ok: true, status: response.status, data, error: null };
  return {
    ok: false,
    status: response.status,
    data,
    error: {
      message: typeof failed?.error_user_msg === "string" && failed.error_user_msg ? failed.error_user_msg : typeof failed?.message === "string" ? failed.message : typeof data?.error_message === "string" ? data.error_message : "",
      code: Number(failed?.code ?? data?.code ?? 0),
      subcode: Number(failed?.error_subcode ?? 0),
    },
  };
}

/** Whether an answer means the login no longer works: it ran out, its password changed, or the app was removed. */
export const loginGone = (error) => error?.code === 190 || error?.code === 102;

/** Whether an answer means Meta wants plan.video to slow down. */
export const tooBusy = (error) => BUSY.has(error?.code);

/**
 * A failed answer as the error a post fails with: a login that's gone asks
 * for a reconnect, being too busy or no answer is tried again, and anything
 * else says what Meta said.
 */
export function publishError(network, error, what) {
  const name = META_NAMES[network];
  if (error?.lost) return new PublishError(`Couldn't reach ${name}. Trying again soon.`, { retry: true });
  if (loginGone(error)) return new PublishError(`${name} login expired. Connect the account again in Connections.`, { expired: true });
  if (tooBusy(error)) return new PublishError(`${name} is busy. Trying again soon.`, { retry: true });
  const said = error?.message ? `: ${error.message}` : ".";
  return new PublishError(`${name} didn't ${what}${said}`);
}

/** The account a login came back with, each shaped the same: who it is, and its session for the vault. */
function account(network, { accountId, handle, avatarUrl, session }) {
  return { network, accountId: String(accountId), handle: handle || META_NAMES[network], avatarUrl: avatarUrl || "", session: { accountId: String(accountId), ...session } };
}

/** Instagram answers the code swap with `{ data: [...] }` now and sent the fields alone before. */
const firstOf = (data) => (Array.isArray(data?.data) ? data.data[0] : data) ?? {};

/**
 * Swaps the code a login came back with for the accounts it reaches: one
 * Instagram or Threads account, or each Facebook Page shared. Each has a
 * session the vault keeps. Throws `Error` with words to show when it can't.
 */
export async function exchangeCode(network, env, { code, redirectUri, now = Date.now() }) {
  const app = env[network];
  const name = META_NAMES[network];
  // Instagram and Threads add `#_` to the code they send back.
  const clean = code.replace(/#_$/, "");

  if (network === "instagram" || network === "threads") {
    const tokenUrl = network === "instagram" ? "https://api.instagram.com/oauth/access_token" : "https://graph.threads.net/oauth/access_token";
    const short = await metaFetch(tokenUrl, {
      method: "POST",
      form: { client_id: app.appId, client_secret: app.appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: clean },
    });
    const first = firstOf(short.data);
    if (!short.ok || !first.access_token) throw new Error(short.error?.message || `${name} didn't accept the login. Try again.`);
    // A login lasts an hour, until it's swapped for one that lasts 60 days.
    const host = network === "instagram" ? "https://graph.instagram.com" : "https://graph.threads.net";
    const long = await metaFetch(`${host}/access_token?${new URLSearchParams({
      grant_type: network === "instagram" ? "ig_exchange_token" : "th_exchange_token",
      client_secret: app.appSecret,
      access_token: first.access_token,
    })}`);
    if (!long.ok || !long.data?.access_token) throw new Error(long.error?.message || `${name} didn't give a lasting login. Try again.`);
    const accessToken = long.data.access_token;
    const expiresAt = now + Number(long.data.expires_in || 60 * 24 * 3600) * 1000;
    const scope = typeof first.permissions === "string" ? first.permissions : Array.isArray(first.permissions) ? first.permissions.join(",") : SCOPES[network].join(",");
    const me = network === "instagram"
      ? await metaFetch(`${API.instagram}/me?fields=user_id,username,name,profile_picture_url,account_type`, { token: accessToken })
      : await metaFetch(`${API.threads}/me?fields=id,username,name,threads_profile_picture_url`, { token: accessToken });
    if (!me.ok) throw new Error(me.error?.message || `Couldn't read the ${name} account. Try again.`);
    const accountId = network === "instagram" ? me.data.user_id || first.user_id : me.data.id || first.user_id;
    if (!accountId) throw new Error(`${name} didn't say which account this is. Try again.`);
    return [account(network, {
      accountId,
      handle: me.data.username,
      avatarUrl: network === "instagram" ? me.data.profile_picture_url : me.data.threads_profile_picture_url,
      session: { accessToken, expiresAt, renewedAt: now, scope },
    })];
  }

  // Facebook: a person's login, made to last, then each Page they shared with its own login, which doesn't run out.
  const short = await metaFetch(`${API.facebook}/oauth/access_token?${new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code: clean })}`);
  if (!short.ok || !short.data?.access_token) throw new Error(short.error?.message || "Facebook didn't accept the login. Try again.");
  const long = await metaFetch(`${API.facebook}/oauth/access_token?${new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: short.data.access_token,
  })}`);
  const userToken = long.ok && long.data?.access_token ? long.data.access_token : short.data.access_token;
  const pages = [];
  let next = `${API.facebook}/me/accounts?${new URLSearchParams({ fields: "id,name,access_token,tasks,picture.type(large){url}", limit: "100" })}`;
  for (let page = 0; next && page < 5; page++) {
    // The next page's address carries the login already.
    const listed = await metaFetch(next, { token: page === 0 ? userToken : undefined });
    if (!listed.ok) throw new Error(listed.error?.message || "Couldn't read your Facebook Pages. Try again.");
    pages.push(...(listed.data?.data ?? []));
    next = typeof listed.data?.paging?.next === "string" ? listed.data.paging.next : null;
  }
  // Only Pages the person can post on.
  return pages
    .filter((page) => page?.id && page.access_token && (!Array.isArray(page.tasks) || page.tasks.includes("CREATE_CONTENT")))
    .map((page) =>
      account("facebook", {
        accountId: page.id,
        handle: page.name,
        avatarUrl: page.picture?.data?.url,
        session: { accessToken: page.access_token, expiresAt: 0, renewedAt: now, scope: SCOPES.facebook.join(",") },
      }),
    );
}

/**
 * The login renewed, when it's an Instagram or Threads one that's been in use
 * a week; null when it's fine as it is. A Page's login doesn't run out.
 */
export async function renewed(network, session, env, now = Date.now()) {
  const name = META_NAMES[network];
  if (network === "facebook") return null;
  const expired = `${name} login expired. Connect the account again in Connections.`;
  if (session.expiresAt && session.expiresAt <= now) throw new PublishError(expired, { expired: true });
  const age = now - (session.renewedAt || 0);
  if (age < RENEW_AFTER_MS || age < RENEWABLE_FROM_MS) return null;
  const host = network === "instagram" ? "https://graph.instagram.com" : "https://graph.threads.net";
  const answer = await metaFetch(`${host}/refresh_access_token?${new URLSearchParams({
    grant_type: network === "instagram" ? "ig_refresh_token" : "th_refresh_token",
    access_token: session.accessToken,
  })}`, { timeout: 15_000 });
  if (answer.ok && answer.data?.access_token) {
    return { ...session, accessToken: answer.data.access_token, expiresAt: now + Number(answer.data.expires_in || 60 * 24 * 3600) * 1000, renewedAt: now };
  }
  if (loginGone(answer.error)) throw new PublishError(expired, { expired: true });
  // The one there still works for a while: renewing is tried again next time.
  return null;
}

/** The account's name and picture now. Meta's picture links don't last, so they're asked for again. */
export async function profileFor(network, session) {
  const answer =
    network === "instagram"
      ? await metaFetch(`${API.instagram}/me?fields=user_id,username,profile_picture_url,followers_count,media_count`, { token: session.accessToken })
      : network === "threads"
        ? await metaFetch(`${API.threads}/me?fields=id,username,threads_profile_picture_url`, { token: session.accessToken })
        : await metaFetch(`${API.facebook}/${session.accountId}?fields=name,picture.type(large){url},followers_count`, { token: session.accessToken });
  if (!answer.ok) return { error: answer.error?.message || `Couldn't reach ${META_NAMES[network]}. Try again in a moment.` };
  const data = answer.data;
  if (network === "instagram") return { handle: data.username, avatarUrl: data.profile_picture_url || "", followers: data.followers_count ?? null };
  if (network === "threads") return { handle: data.username, avatarUrl: data.threads_profile_picture_url || "" };
  return { handle: data.name, avatarUrl: data.picture?.data?.url || "", followers: data.followers_count ?? null };
}
