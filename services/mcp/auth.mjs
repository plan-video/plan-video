/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A connector's token carries the OAuth client's `client_id`; the editor's sign-in does not. Each
// door accepts only its own kind. Connector tokens name nobody to the rest of Supabase (see the
// connector_tokens migration's access token hook); only connector_identity, asked with the
// token itself, says whose it is, and only while its session exists.

const CACHE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bearer(header) {
  const value = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return value && value.length <= 4096 ? value : null;
}

/** Unchecked: it only picks which of Supabase's checks to ask. */
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
    if (!payload) return null;
    const connector = payload.client_id != null;

    let res;
    try {
      res = await fetchImpl(`${supabaseUrl}${connector ? "/rest/v1/rpc/connector_identity" : "/auth/v1/user"}`, {
        method: connector ? "POST" : "GET",
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, ...(connector ? { "Content-Type": "application/json" } : {}) },
        body: connector ? "{}" : undefined,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error("Sign-in can't be checked right now.");
    }
    if (!res.ok) return null;
    const found = await res.json().catch(() => null);

    let entry;
    if (connector) {
      // The session's own client, not the token's word for it.
      if (typeof found?.user_id !== "string" || !UUID.test(found.user_id) || typeof found.client_id !== "string" || !found.client_id) return null;
      entry = { userId: found.user_id, clientId: found.client_id };
    } else {
      if (typeof found?.id !== "string" || !UUID.test(found.id) || payload.sub !== found.id) return null;
      entry = { userId: found.id, clientId: null };
    }
    entry.until = Math.min(Date.now() + CACHE_MS, typeof payload.exp === "number" ? payload.exp * 1000 : 0);
    if (entry.until > Date.now()) cache.set(token, entry);
    return entry;
  }

  return {
    async connector(token) {
      const who = token ? await identify(token) : null;
      return who?.clientId ? who : null;
    },
    async editor(token) {
      const who = token ? await identify(token) : null;
      return who && who.clientId === null ? who : null;
    },
  };
}
