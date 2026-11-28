/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only a connector's token, which carries the OAuth client's `client_id`, is let in. Connector tokens
// name nobody to the rest of Supabase (see the connector_tokens migration's access token hook); only
// connector_identity, asked with the token itself, says whose it is, and only while its session exists.

const CACHE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bearer(header) {
  const value = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return value && value.length <= 4096 ? value : null;
}

/** Unchecked: it only turns away what isn't a connector's token before asking Supabase. */
function claims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function createAuth({ supabaseUrl, supabaseAnonKey, fetch: fetchImpl = fetch }) {
  /** token → { userId, clientId, until } */
  const cache = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [token, entry] of cache) if (entry.until <= now) cache.delete(token);
  }, CACHE_MS).unref();

  async function identify(token) {
    const cached = cache.get(token);
    if (cached && cached.until > Date.now()) return cached;

    const payload = claims(token);
    if (payload?.client_id == null) return null;

    let res;
    try {
      res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/connector_identity`, {
        method: "POST",
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error("Sign-in can't be checked right now.");
    }
    if (!res.ok) return null;
    const found = await res.json().catch(() => null);

    // The session's own client, not the token's word for it.
    if (typeof found?.user_id !== "string" || !UUID.test(found.user_id) || typeof found.client_id !== "string" || !found.client_id) return null;
    const entry = { userId: found.user_id, clientId: found.client_id };
    entry.expires = typeof payload.exp === "number" ? payload.exp * 1000 : 0;
    entry.until = Math.min(Date.now() + CACHE_MS, entry.expires);
    if (entry.until > Date.now()) cache.set(token, entry);
    return entry;
  }

  return {
    async connector(token) {
      return token ? identify(token) : null;
    },
  };
}
