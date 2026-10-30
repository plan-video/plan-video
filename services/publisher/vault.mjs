// The logins of connected accounts. Each is sealed with AES-256-GCM under a
// key only this service holds, bound to its account and connection so a row
// can't be moved to another, and kept in social_tokens. This service is the
// only one that refreshes them, so a network that hands out a new refresh
// token each time never sees two copies racing.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import { tokenRequest as tiktokToken } from "../tiktok/handler.mjs";
import { tokenRequest as youtubeToken } from "../youtube/handler.mjs";
import { tokenRequest as linkedinToken } from "../linkedin/handler.mjs";

import { PublishError } from "./errors.mjs";
import { isMetaNetwork, renewed as metaRenewed } from "./meta.mjs";
import { pdsFetch, pdsOrigin } from "./pds-fetch.mjs";

/** Refreshed this long before it runs out, so an upload doesn't outlive its token. */
const AHEAD_MS = 10 * 60_000;

export function sealer(base64Key) {
  const key = Buffer.from(base64Key || "", "base64");
  if (key.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64.");
  return {
    seal(value, binding) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(binding));
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return `v1.${Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64")}`;
    },
    open(sealed, binding) {
      if (typeof sealed !== "string" || !sealed.startsWith("v1.")) throw new Error("Unknown sealed format.");
      const raw = Buffer.from(sealed.slice(3), "base64");
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      const text = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
      return JSON.parse(text);
    },
  };
}

/** What each sealed row is bound to: a login in social_tokens, a Bluesky session in bluesky_sessions. */
export const tokenBinding = (userId, connectionId) => `${userId}:${connectionId}`;
export const blueskyBinding = (userId, did) => `bluesky:${userId}:${did}`;

/** How long a connect ticket attaches its login: the browser hands it to login/save as soon as it has it. */
export const TICKET_MS = 15 * 60_000;

/**
 * Who a connect ticket is for: the person who connected the account and the
 * workspace they connected it in, as `{ person, owner, workspace }`. The
 * workspace is "" for the owner's own, any of which they can attach their
 * accounts to. Someone acting for an owner names which of the owner's it is,
 * so an admin taken out of one workspace can't attach its account in another.
 */
export const ticketBinding = (network, { person, owner, workspace = "" }) => `${network}-ticket:${person}:${owner}:${workspace}`;

/** A ticket for a login: sealed for its holder, with a nonce so login/save takes it once. */
export function sealTicket(box, network, holder, session, now) {
  return box.seal({ session, until: now + TICKET_MS, nonce: randomUUID() }, ticketBinding(network, holder));
}

/** What a ticket holds, `{ session, nonce, until }`, when it was made for this holder and hasn't run out; otherwise null. */
export function openTicket(box, network, holder, ticket, now) {
  try {
    const { session, until, nonce } = box.open(ticket, ticketBinding(network, holder));
    return Number(until) > now && typeof nonce === "string" && nonce ? { session, nonce, until: Number(until) } : null;
  } catch {
    return null;
  }
}

const str = (value, max = 8192) => (typeof value === "string" && value.length <= max ? value : "");
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * A login as a browser hands it over after connecting, cut down to what each
 * network's login holds. Null when it isn't one.
 */
export function cleanSession(platform, value, { allowOAuth = false } = {}) {
  if (!value || typeof value !== "object") return null;
  if (platform === "tiktok") {
    const session = { openId: str(value.openId, 200), accessToken: str(value.accessToken), refreshToken: str(value.refreshToken), expiresAt: num(value.expiresAt), scope: str(value.scope, 1000) };
    return session.accessToken || session.refreshToken ? session : null;
  }
  if (platform === "youtube") {
    const session = { channelId: str(value.channelId, 200), accessToken: str(value.accessToken), refreshToken: str(value.refreshToken), expiresAt: num(value.expiresAt), scope: str(value.scope, 1000) };
    return session.accessToken || session.refreshToken ? session : null;
  }
  if (platform === "linkedin") {
    const session = { personId: str(value.personId, 200), accessToken: str(value.accessToken), refreshToken: str(value.refreshToken), expiresAt: num(value.expiresAt), scope: str(value.scope, 1000) };
    return session.accessToken && /^[\w-]{1,64}$/.test(session.personId) ? session : null;
  }
  if (platform === "x") {
    const session = { xUserId: str(value.xUserId, 200), accessToken: str(value.accessToken), refreshToken: str(value.refreshToken), expiresAt: num(value.expiresAt), scope: str(value.scope, 1000) };
    return session.accessToken && session.xUserId ? session : null;
  }
  if (isMetaNetwork(platform)) {
    // Only ever from the ticket its login gave this person: no browser has Meta's tokens to hand over.
    const session = { accountId: str(value.accountId, 200), accessToken: str(value.accessToken), expiresAt: num(value.expiresAt), renewedAt: num(value.renewedAt), scope: str(value.scope, 1000) };
    return session.accessToken && /^\d{1,40}$/.test(session.accountId) ? session : null;
  }
  if (platform === "bluesky") {
    // "Sign in with Bluesky": the session is the person's own, in bluesky_sessions; this names the account.
    if (value.oauth === true) {
      // Only after the sign-in ticket was checked: on its own it would let anyone name any account.
      if (!allowOAuth) return null;
      const did = str(value.did, 300);
      return did.startsWith("did:") ? { did, oauth: true } : null;
    }
    // Kept as a bare https origin; pdsFetch checks where it really leads each time it's called.
    const pds = pdsOrigin(str(value.pds, 500));
    const session = { did: str(value.did, 300), pds, accessJwt: str(value.accessJwt), refreshJwt: str(value.refreshJwt) };
    return session.did.startsWith("did:") && pds && session.refreshJwt ? session : null;
  }
  return null;
}

/** When a JWT runs out, in milliseconds, or 0 when it doesn't say. */
function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

const EXPIRED = {
  tiktok: "TikTok login expired. Connect the account again in Connections.",
  youtube: "YouTube login expired. Connect the account again in Connections.",
  linkedin: "LinkedIn login expired. Connect the account again in Connections.",
  bluesky: "Bluesky login expired. Connect the account again in Connections.",
  x: "X login expired. Connect the account again in Connections.",
  instagram: "Instagram login expired. Connect the account again in Connections.",
  facebook: "Facebook login expired. Connect the Page again in Connections.",
  threads: "Threads login expired. Connect the account again in Connections.",
};

/** X's confidential clients sign token requests with their id and secret. */
export const xBasic = (env) => `Basic ${Buffer.from(`${encodeURIComponent(env?.clientId ?? "")}:${encodeURIComponent(env?.clientSecret ?? "")}`).toString("base64")}`;

async function refreshed(platform, session, env) {
  if (platform === "tiktok") {
    if (session.expiresAt - Date.now() > AHEAD_MS) return null;
    if (!session.refreshToken) throw new PublishError(EXPIRED.tiktok);
    const token = await tiktokToken(env.tiktok, { grant_type: "refresh_token", refresh_token: session.refreshToken });
    if (token.error) throw new PublishError(EXPIRED.tiktok, { expired: true });
    return { ...session, accessToken: token.accessToken, refreshToken: token.refreshToken || session.refreshToken, expiresAt: Date.now() + token.expiresIn * 1000, scope: token.scope || session.scope };
  }
  if (platform === "youtube") {
    if (session.expiresAt - Date.now() > AHEAD_MS) return null;
    if (!session.refreshToken) throw new PublishError(EXPIRED.youtube);
    const token = await youtubeToken(env.youtube, { grant_type: "refresh_token", refresh_token: session.refreshToken });
    if (token.error) throw new PublishError(token.revoked ? "YouTube access was removed. Connect the channel again in Connections." : EXPIRED.youtube, { expired: !!token.revoked, retry: !token.revoked });
    return { ...session, accessToken: token.accessToken, refreshToken: token.refreshToken || session.refreshToken, expiresAt: Date.now() + token.expiresIn * 1000, scope: token.scope || session.scope };
  }
  if (platform === "linkedin") {
    if (session.expiresAt - Date.now() > AHEAD_MS) return null;
    if (!session.refreshToken) {
      if (session.expiresAt > Date.now()) return null;
      throw new PublishError(EXPIRED.linkedin, { expired: true });
    }
    const token = await linkedinToken(env.linkedin, { grant_type: "refresh_token", refresh_token: session.refreshToken });
    if (token.error) throw new PublishError(EXPIRED.linkedin, { expired: true });
    return { ...session, accessToken: token.accessToken, refreshToken: token.refreshToken || session.refreshToken, expiresAt: Date.now() + token.expiresIn * 1000, scope: token.scope || session.scope };
  }
  if (platform === "x") {
    if (session.expiresAt - Date.now() > AHEAD_MS) return null;
    if (!session.refreshToken) throw new PublishError(EXPIRED.x, { expired: true });
    // X hands out a new refresh token each time, and the old one stops working.
    const response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: xBasic(env.x) },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response) throw new PublishError("Couldn't reach X. Trying again soon.", { retry: true });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) {
      const expired = response.status === 400 || response.status === 401;
      throw new PublishError(expired ? EXPIRED.x : "X didn't renew the login. Trying again soon.", { expired, retry: !expired });
    }
    return { ...session, accessToken: payload.access_token, refreshToken: payload.refresh_token || session.refreshToken, expiresAt: Date.now() + (payload.expires_in || 0) * 1000, scope: payload.scope || session.scope };
  }
  if (platform === "bluesky") {
    // The OAuth client refreshes those itself, as it uses them.
    if (session.oauth) return null;
    if (session.accessJwt && jwtExpiry(session.accessJwt) - Date.now() > AHEAD_MS) return null;
    const response = await pdsFetch(session.pds, "com.atproto.server.refreshSession", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.refreshJwt}` },
    }).catch(() => null);
    if (!response) throw new PublishError("Couldn't reach Bluesky. Trying again soon.", { retry: true });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.accessJwt) {
      const expired = payload?.error === "ExpiredToken" || payload?.error === "InvalidToken" || response.status === 401;
      throw new PublishError(expired ? EXPIRED.bluesky : "Bluesky didn't renew the login. Trying again soon.", { expired, retry: !expired });
    }
    return { ...session, accessJwt: payload.accessJwt, refreshJwt: payload.refreshJwt || session.refreshJwt };
  }
  // Instagram's and Threads' are renewed every week they're used; a Page's doesn't run out.
  if (isMetaNetwork(platform)) return metaRenewed(platform, session, env);
  throw new PublishError("plan.video can't post to this network from the server yet.");
}

/**
 * The vault over a table. `db` reads and writes social_tokens; `env` holds
 * each network's client id and secret for refreshing.
 */
export function createVault({ db, key, env }) {
  const box = sealer(key);
  const binding = tokenBinding;
  /** One refresh at a time per login. */
  const pending = new Map();

  async function read(userId, connectionId) {
    const row = await db.selectOne("social_tokens", { user_id: userId, connection_id: connectionId }, "platform,sealed");
    if (!row) return null;
    const session = box.open(row.sealed, binding(userId, connectionId));
    // "Sign in with Bluesky" names the account; the session is its owner's own, in bluesky_sessions.
    return { platform: row.platform, session: session.oauth ? { ...session, owner: userId } : session, sealed: row.sealed };
  }

  async function write(userId, connectionId, platform, session) {
    await db.upsert("social_tokens", {
      user_id: userId,
      connection_id: connectionId,
      platform,
      sealed: box.seal(session, binding(userId, connectionId)),
      updated_at: new Date().toISOString(),
    }, "user_id,connection_id");
  }

  return {
    /**
     * Keeps a login handed over by a browser. A login just made replaces the
     * one kept; an older copy only fills a gap, since the one kept may have
     * been refreshed since, and some networks accept only the newest.
     */
    async put(userId, connectionId, platform, value, { replace = true, allowOAuth = false } = {}) {
      const session = cleanSession(platform, value, { allowOAuth });
      if (!session) throw new PublishError("That isn't a login plan.video can keep.");
      if (replace) await write(userId, connectionId, platform, session);
      else {
        await db.insertNew("social_tokens", [{
          user_id: userId,
          connection_id: connectionId,
          platform,
          sealed: box.seal(session, binding(userId, connectionId)),
          updated_at: new Date().toISOString(),
        }], "user_id,connection_id");
      }
      return session;
    },

    read,

    /** The connected accounts with a login kept here. */
    async list(userId) {
      const rows = await db.select("social_tokens", { user_id: userId }, "connection_id,platform");
      return rows.map((row) => ({ connectionId: row.connection_id, platform: row.platform }));
    },

    async remove(userId, connectionId) {
      await db.delete("social_tokens", { user_id: userId, connection_id: connectionId });
    },

    /** A login that works for at least a few more minutes, refreshed and saved first when it wouldn't. */
    async fresh(userId, connectionId) {
      const id = binding(userId, connectionId);
      const running = pending.get(id);
      if (running) return running;
      const work = (async () => {
        const found = await read(userId, connectionId);
        if (!found) throw new PublishError("This account's login isn't on plan.video. Connect it again in Connections.", { expired: true });
        const next = await refreshed(found.platform, found.session, env);
        if (!next) return found;
        // Only over the copy it refreshed, which no two saves share: a reconnect saved
        // meanwhile is newer, and a removed login stays removed.
        const [kept] = await db.update("social_tokens", { user_id: userId, connection_id: connectionId, sealed: found.sealed }, {
          sealed: box.seal(next, binding(userId, connectionId)),
          updated_at: new Date().toISOString(),
        });
        if (kept) return { platform: found.platform, session: next };
        const now = await read(userId, connectionId);
        if (!now) throw new PublishError("This account was disconnected. Connect it again in Connections.", { expired: true });
        return now;
      })();
      pending.set(id, work);
      try {
        return await work;
      } finally {
        pending.delete(id);
      }
    },
  };
}
