// plan.video is a confidential OAuth client: metadata and public key at /api/publisher/bluesky/client.json,
// private key here. One sealed session per person and Bluesky account, so one reconnecting never ends another's.
// A browser never gets the session, only a short ticket naming person, workspace and account, shown once
// to attach it, so nobody can attach an account they didn't sign in to, nor in another workspace.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { JoseKey, NodeOAuthClient, requestLocalLock } from "@atproto/oauth-client-node";
import { safeFetchWrap } from "@atproto-labs/fetch-node";

import { PublishError } from "./errors.mjs";
import { TICKET_MS, blueskyBinding, sealer } from "./vault.mjs";

const SCOPE = "atproto transition:generic";

/**
 * The library's SSRF guard needs the undici version Node reports, and distro builds leave it out,
 * so every sign-in and Bluesky post would fail while the rest of the publisher looks fine.
 */
export function blueskyNodeProblem(versions = process.versions) {
  const [major = 0, minor = 0, patch = 0] = (versions.undici || "").split(".").map(Number);
  const ok = major > 6 || (major === 6 && (minor > 11 || (minor === 11 && patch >= 1)));
  return ok ? null : `Node ${versions.node} reports undici ${versions.undici || "none"}; Bluesky needs undici 6.11.1 or later (run the official Node build)`;
}
const STATE_MS = 60 * 60_000;

export async function createBlueskyOAuth({ db, sealKey, privateJwk, publicUrl }) {
  const box = sealer(sealKey);
  const ticketKey = createHmac("sha256", Buffer.from(sealKey, "base64")).update("bluesky-ticket").digest();
  const clientId = `${publicUrl}/api/publisher/bluesky/client.json`;
  const keyset = [await JoseKey.fromImportable(privateJwk, "plan-video-bluesky-1")];
  const states = new Map();
  const binding = blueskyBinding;

  // Sign-in addresses come from the user. @atproto guards handle resolution but not its own OAuth metadata,
  // PAR, token and revoke requests, so a "handle" pointing at a loopback address could reach the other services
  // on this box (SSRF). Every request is wrapped: https, usual port, public address checked as it connects
  // so DNS can't swap one in; each redirect hop is checked too.
  const safeFetch = safeFetchWrap({ fetch: (input, init) => globalThis.fetch(input, init), ssrfProtection: true, allowImplicitRedirect: true });

  // The library keeps one session per Bluesky account in its store and ends the one there before keeping
  // a new one, so each person gets a store of their own.
  const clientFor = (userId) =>
    new NodeOAuthClient({
      fetch: safeFetch,
      clientMetadata: {
        client_id: clientId,
        client_name: "plan.video",
        client_uri: publicUrl,
        logo_uri: `${publicUrl}/apple-touch-icon.png`,
        tos_uri: `${publicUrl}/terms`,
        policy_uri: `${publicUrl}/privacy`,
        redirect_uris: [`${publicUrl}/bluesky/callback`],
        scope: SCOPE,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "web",
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_signing_alg: "ES256",
        dpop_bound_access_tokens: true,
        jwks_uri: `${publicUrl}/api/publisher/bluesky/jwks.json`,
      },
      keyset,
      requestLock: requestLocalLock,
      // Each finished only by the person who started it; a restart in the middle means starting again.
      stateStore: {
        async set(key, value) {
          const now = Date.now();
          for (const [old, entry] of states) if (entry.until < now) states.delete(old);
          states.set(`${userId}:${key}`, { value, until: now + STATE_MS });
        },
        async get(key) {
          const entry = states.get(`${userId}:${key}`);
          return entry && entry.until > Date.now() ? entry.value : undefined;
        },
        async del(key) {
          states.delete(`${userId}:${key}`);
        },
      },
      sessionStore: {
        async set(did, value) {
          await db.upsert("bluesky_sessions", { user_id: userId, did, sealed: box.seal(value, binding(userId, did)), updated_at: new Date().toISOString() }, "user_id,did");
        },
        async get(did) {
          const row = await db.selectOne("bluesky_sessions", { user_id: userId, did }, "sealed");
          return row ? box.open(row.sealed, binding(userId, did)) : undefined;
        },
        async del(did) {
          await db.delete("bluesky_sessions", { user_id: userId, did });
        },
      },
    });

  // Everyone's client has the same metadata and key. Making one now checks them before anyone signs in.
  const { clientMetadata, jwks } = clientFor("");

  const mac = ({ person, owner, workspace = "" }, did, until, nonce) =>
    createHmac("sha256", ticketKey).update(JSON.stringify([person, owner, workspace, did, until, nonce])).digest("base64url");

  return {
    metadata: () => clientMetadata,
    jwks: () => jwks,

    async authorize(userId, handle) {
      const nonce = randomBytes(8).toString("hex");
      const url = await clientFor(userId).authorize(handle || "https://bsky.social", { scope: SCOPE, state: `${userId}:${nonce}` }).catch((error) => {
        throw new PublishError(/resolve|handle/i.test(String(error?.message)) ? "Bluesky couldn't find that handle. Check it and try again." : "Bluesky's sign-in didn't start. Try again in a moment.");
      });
      return url.toString();
    },

    /** Returns the account and a ticket to attach it for `holder` (ticketBinding in vault.mjs). */
    async callback(holder, query) {
      const userId = holder.owner;
      const params = new URLSearchParams(query);
      if (!params.get("code")) throw new PublishError("Bluesky sent the sign-in back without a code. Try again.");
      const client = clientFor(userId);
      const { session, state } = await client.callback(params).catch(() => {
        throw new PublishError("Bluesky's sign-in didn't finish. Start it again from Connections.");
      });
      if (!state?.startsWith(`${userId}:`)) {
        await client.revoke(session.did).catch(() => undefined);
        throw new PublishError("That Bluesky sign-in was started by someone else. Start it again from Connections.");
      }
      const until = String(Date.now() + TICKET_MS);
      const nonce = randomBytes(12).toString("hex");
      return { did: session.did, ticket: `${until}.${nonce}.${mac(holder, session.did, until, nonce)}` };
    },

    /** `{ nonce, until }` when the ticket says this holder signed in to this account minutes ago at most, so login/save takes it once. */
    openTicket(holder, did, ticket) {
      const [until, nonce, given, extra] = String(ticket ?? "").split(".");
      if (!/^\d{1,15}$/.test(until ?? "") || !/^[0-9a-f]{24}$/.test(nonce ?? "") || !given || extra !== undefined || Number(until) <= Date.now()) return null;
      const wanted = Buffer.from(mac(holder, did, until, nonce));
      const got = Buffer.from(given);
      return wanted.length === got.length && timingSafeEqual(wanted, got) ? { nonce, until: Number(until) } : null;
    },

    async sender(userId, did) {
      const session = await clientFor(userId).restore(did).catch(() => {
        throw new PublishError("Bluesky login expired. Sign in with Bluesky again in Connections.", { expired: true });
      });
      return (method, init) => session.fetchHandler(`/xrpc/${method}`, init);
    },

    /** Anyone else's session for the same account stays. */
    async revoke(userId, did) {
      await clientFor(userId).revoke(did).catch(() => undefined);
    },
  };
}

/** A new private key for the client, as one line of JSON for publisher.env. */
export async function makeBlueskyKey() {
  const key = await JoseKey.generate(["ES256"], "plan-video-bluesky-1");
  return JSON.stringify(key.privateJwk);
}
