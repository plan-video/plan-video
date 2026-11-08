// All on the server, so no step can be skipped (a browser could otherwise delete the account and leave its
// plan charged, files stored and logins working). In order, each before anything is lost for good: end the
// plan in Stripe, erase stored files, end access at each network (a network that doesn't answer still loses
// the login), then Supabase deletes the account, cascading from auth.users. A failed step stops the rest.

import { Refused } from "./errors.mjs";
import { cleanSession } from "./vault.mjs";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const PLATFORMS = new Set(["tiktok", "youtube", "linkedin", "bluesky", "x"]);

/** A browser could leave any number of these in account_state; real accounts have a handful. */
const MOST_OLD_LOGINS = 300;
const REVOKES_AT_ONCE = 16;
const PHOTO_PAGE = 1000;

export function createAccountDeletion({ db, vault, media, bluesky, revoke, env, supabaseUrl, serviceKey, billingUrl, fetch: send = fetch }) {
  const running = new Set();

  const admin = (path, init = {}) =>
    send(`${supabaseUrl}${path}`, {
      ...init,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);

  /** Unless the person never paid. Throws when Stripe couldn't be reached. */
  async function endPlan(userId, token) {
    const row = await db.selectOne("user_data", { id: userId }, "stripe_customer_id");
    if (!row?.stripe_customer_id) return;
    const response = await send(`${billingUrl}/api/billing/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!response?.ok) {
      console.error(`[publisher] ending the plan of ${userId} failed: ${response?.status ?? "no answer"}`);
      throw new Refused(503, "Your plan couldn't be ended, so the account wasn't deleted. Try again in a moment.");
    }
  }

  async function removePhotos(userId) {
    const failed = "Your profile photo couldn't be removed, so the account wasn't deleted. Try again in a moment.";
    for (let pages = 0; pages < 100; pages++) {
      const listed = await admin("/storage/v1/object/list/avatars", { method: "POST", body: JSON.stringify({ prefix: userId, limit: PHOTO_PAGE, offset: 0 }) });
      const files = listed?.ok ? await listed.json().catch(() => null) : null;
      if (!Array.isArray(files)) throw new Refused(503, failed);
      const prefixes = files.filter((file) => typeof file?.name === "string").map((file) => `${userId}/${file.name}`);
      if (prefixes.length) {
        const removed = await admin("/storage/v1/object/avatars", { method: "DELETE", body: JSON.stringify({ prefixes }) });
        if (!removed?.ok) throw new Refused(503, failed);
      }
      if (files.length < PHOTO_PAGE) return;
    }
  }

  async function eraseFiles(userId) {
    try {
      await media.eraseUser(userId);
    } catch (error) {
      console.error(`[publisher] erasing the files of ${userId} failed`, error instanceof Error ? error.message : error);
      throw new Refused(503, "Your files couldn't be erased, so the account wasn't deleted. Try again in a moment.");
    }
  }

  /** Logins still in account_state that the publisher hasn't taken in yet. */
  async function olderLogins(userId, kept) {
    const row = await db.selectOne("account_state", { user_id: userId }, "payload");
    const found = [];
    const seen = new Set();
    for (const slice of Object.values(row?.payload?.slices ?? {})) {
      for (const connection of Array.isArray(slice?.connections) ? slice.connections : []) {
        const platform = connection?.platform;
        if (!PLATFORMS.has(platform) || !ID.test(connection.id ?? "") || kept.has(connection.id)) continue;
        const session = cleanSession(platform, connection[platform]);
        const same = `${platform}|${JSON.stringify(session)}`;
        if (session && !seen.has(same) && found.length < MOST_OLD_LOGINS) found.push({ platform, session });
        seen.add(same);
      }
    }
    return found;
  }

  async function endAccess(userId) {
    const kept = await vault.list(userId);
    const sessions = [];
    for (const { connectionId } of kept) {
      const found = await vault.read(userId, connectionId).catch(() => null);
      // "Sign in with Bluesky" ends below, with every such session of theirs.
      if (found && !found.session.oauth) sessions.push(found);
    }
    sessions.push(...(await olderLogins(userId, new Set(kept.map((login) => login.connectionId)))));
    const signIns = bluesky ? await db.select("bluesky_sessions", { user_id: userId }, "did") : [];

    const waiting = [
      ...sessions.map((found) => () => revoke(found.platform, found.session, env, bluesky)),
      ...signIns.map((row) => () => bluesky.revoke(userId, row.did)),
    ];
    await Promise.all(Array.from({ length: Math.min(REVOKES_AT_ONCE, waiting.length) }, async () => {
      while (waiting.length) await waiting.shift()().catch(() => undefined);
    }));
    await db.delete("social_tokens", { user_id: userId });
  }

  async function deleteUser(userId) {
    const response = await admin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    // Already gone, from an earlier try that lost its answer.
    if (response?.ok || response?.status === 404) return;
    console.error(`[publisher] deleting the account ${userId} failed: ${response?.status ?? "no answer"}`);
    throw new Refused(503, "The account couldn't be deleted. Try again in a moment.");
  }

  return {
    async remove(userId, token) {
      if (running.has(userId)) throw new Refused(409, "Your account is already being deleted.");
      running.add(userId);
      try {
        await endPlan(userId, token);
        await eraseFiles(userId);
        await removePhotos(userId);
        await endAccess(userId);
        await deleteUser(userId);
      } finally {
        running.delete(userId);
      }
    },
  };
}
