// Requests to the Bluesky server an app-password login names. That address
// comes from the user, so it goes through the same guard @atproto's own
// "Sign in with Bluesky" requests use: https on the usual port, a public
// address on every connection (checked as it connects, so DNS can't swap in
// 127.0.0.1 after a check), no redirects, a size cap on the answer and a time
// limit. Without it a made-up server could send the publisher to the other
// services on this box, or hold up every post behind its own.

import { safeFetchWrap } from "@atproto-labs/fetch-node";

/** Bluesky's own servers, which get the long wait big videos need. */
const BLUESKY_HOST = /(^|\.)bsky\.(social|network)$/i;
/** Enough for a 100 MB video to Bluesky's own servers. */
const BLUESKY_WAIT_MS = 10 * 60_000;
/** Anyone else's server: long enough for a picture, too short to stall the queue. */
const OTHER_WAIT_MS = 60_000;
/** Bluesky's replies are small JSON; listRecords of 100 posts is the biggest. */
const MOST_REPLY_BYTES = 4 * 1024 * 1024;

/** The login's server as a bare https origin, or null when it can't be one. */
export function pdsOrigin(pds) {
  try {
    const url = new URL(pds);
    const plain = url.protocol === "https:" && !url.port && !url.username && !url.password && /[a-z]/i.test(url.hostname.split(".").at(-1) ?? "");
    return plain ? url.origin : null;
  } catch {
    return null;
  }
}

/** Whether the server is one of Bluesky's own. */
export function isBlueskyServer(pds) {
  const origin = pdsOrigin(pds);
  return !!origin && BLUESKY_HOST.test(new URL(origin).hostname);
}

const guards = new Map();

/** One guard per wait. It calls whatever fetch is in place at the time, so tests can stand in for the network. */
function guarded(timeout) {
  let send = guards.get(timeout);
  if (!send) {
    send = safeFetchWrap({ fetch: (input, init) => globalThis.fetch(input, init), timeout, responseMaxSize: MOST_REPLY_BYTES, allowIpHost: false });
    guards.set(timeout, send);
  }
  return send;
}

/** Calls one XRPC method on the login's server. Rejects like fetch does when it can't or mustn't. */
export async function pdsFetch(pds, method, init = {}) {
  const origin = pdsOrigin(pds);
  if (!origin) throw new TypeError("fetch failed", { cause: new Error("Not a Bluesky server address") });
  const { signal: _ignored, ...rest } = init;
  const send = guarded(isBlueskyServer(origin) ? BLUESKY_WAIT_MS : OTHER_WAIT_MS);
  return send(`${origin}/xrpc/${method}`, { ...rest, redirect: "error" });
}
