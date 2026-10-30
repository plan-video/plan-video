// Deleting an account, all on the server, so none of it can be skipped: a
// browser that called the database itself could delete the account and leave
// its plan being charged, its files stored and its logins working.
//
// In order, each step before anything is lost for good:
//
//   1. the plan ends in Stripe (services/billing, with the person's own token),
//      or nothing else happens
//   2. the files in cloud storage and the profile photo are erased
//   3. plan.video's access ends at each connected network: the logins kept
//      here, older ones still in account_state, and "Sign in with Bluesky"
//      sessions. A network that doesn't answer still loses the login, since
//      it's deleted with the account.
//   4. Supabase deletes the account, and every row of it with it: each table
//      cascades from auth.users.
//
// A step that fails stops the rest, so trying again finishes the job.

import { Refused } from "./errors.mjs";
import { cleanSession } from "./vault.mjs";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const PLATFORMS = new Set(["tiktok", "youtube", "linkedin", "bluesky", "x"]);

export function createAccountDeletion({ db, vault, media, bluesky, revoke, env, supabaseUrl, serviceKey, billingUrl, fetch: send = fetch }) {
  const running = new Set();

  const admin = (path, init = {}) =>
    send(`${supabaseUrl}${path}`, {
      ...init,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);

  /** Ends every subscription, unless the person never paid. Throws when Stripe couldn't be reached. */
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
    const listed = await admin("/storage/v1/object/list/avatars", { method: "POST", body: JSON.stringify({ prefix: userId, limit: 1000, offset: 0 }) });
    const files = listed?.ok ? await listed.json().catch(() => null) : null;
    if (!Array.isArray(files)) throw new Refused(503, "Your profile photo couldn't be removed, so the account wasn't deleted. Try again in a moment.");
    const prefixes = files.filter((file) => typeof file?.name === "string").map((file) => `${userId}/${file.name}`);
    if (!prefixes.length) return;
    const removed = await admin("/storage/v1/object/avatars", { method: "DELETE", body: JSON.stringify({ prefixes }) });
    if (!removed?.ok) throw new Refused(503, "Your profile photo couldn't be removed, so the account wasn't deleted. Try again in a moment.");
  }

  async function eraseFiles(userId) {
    try {
      await media.eraseUser(userId);
    } catch (error) {
      console.error(`[publisher] erasing the files of ${userId} failed`, error instanceof Error ? error.message : error);
      throw new Refused(503, "Your files couldn't be erased, so the account wasn't deleted. Try again in a moment.");
    }
  }

  /** Logins browsers saved in account_state before they moved to the server, which the publisher hasn't taken in yet. */
  async function olderLogins(userId, kept) {
    const row = await db.selectOne("account_state", { user_id: userId }, "payload");
    const found = [];
    for (const slice of Object.values(row?.payload?.slices ?? {})) {
      for (const connection of Array.isArray(slice?.connections) ? slice.connections : []) {
        const platform = connection?.platform;
        if (!PLATFORMS.has(platform) || !ID.test(connection.id ?? "") || kept.has(connection.id)) continue;
        const session = cleanSession(platform, connection[platform]);
        if (session) found.push({ platform, session });
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

    await Promise.allSettled([
      ...sessions.map((found) => revoke(found.platform, found.session, env, bluesky)),
      ...signIns.map((row) => bluesky.revoke(userId, row.did)),
    ]);
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
    /** Deletes the account of the person `token` signs in, whose id is `userId`. */
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
