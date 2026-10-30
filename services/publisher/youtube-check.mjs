// Daily, so nothing kept from YouTube outlives its API policies (III.E.4): channel data is refreshed or
// deleted within 30 days, and within 7 of the person taking plan.video's access away (invalid_grant).
// Anything that may pass (no answer, daily quota, a 5xx, the account saved meanwhile) deletes nothing:
// the next day's run tries again.

import { randomUUID } from "node:crypto";

import { channelFor } from "../youtube/handler.mjs";

import { PublishError } from "./errors.mjs";

const DAY_MS = 24 * 60 * 60_000;
/** A video sent this recently isn't looked up yet: YouTube may still be taking it in. */
const SETTLE_MS = DAY_MS;
/** Assistant chats with YouTube's numbers in them are kept this long after their last message. */
export const YOUTUBE_CHAT_DAYS = 30;
/** The most ids one videos.list call takes. */
const BATCH = 50;
const PAGE = 500;
const CHAT_PAGE = 20;
/** Between channels, to go easy on YouTube's quota. */
const PAUSE_MS = 500;
const CLEARED = { publish_id: null, url: null, error: null };
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** The longest one channel's check may take, so a call that never answers can't hold up the runs after it. */
const CHANNEL_MS = 2 * 60_000;

const iso = (ms) => new Date(ms).toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function within(promise, ms, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const holds = (row) => (row.state === "sent" || row.state === "failed") && (row.publish_id != null || row.url != null || row.error != null);

/** Only rows still done going out are cleared. */
async function clearRows(db, ids, at) {
  let cleared = 0;
  for (let index = 0; index < ids.length; index += 100) {
    const rows = await db.update("post_deliveries", { id: ids.slice(index, index + 100), state: ["sent", "failed"] }, { ...CLEARED, updated_at: at });
    cleared += rows.length;
  }
  return cleared;
}

/**
 * The rows stay, so a post still shows it went out. Rows still going out are left alone; they fail
 * without the login, and the daily run clears them after.
 */
export async function clearYouTubeConnection(db, userId, connectionId, at = iso(Date.now())) {
  const rows = await db.select("post_deliveries", { user_id: userId, connection_id: connectionId, platform: "youtube" }, "id,state,publish_id,url,error");
  return clearRows(db, rows.filter(holds).map((row) => row.id), at);
}

/** Throws when YouTube didn't say, which deletes nothing. */
async function videosKept(accessToken, ids) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "id");
  url.searchParams.set("id", ids.join(","));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response) throw new Error("YouTube didn't answer");
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`YouTube answered ${response.status} ${payload?.error?.errors?.[0]?.reason ?? ""}`.trim());
  if (!Array.isArray(payload?.items)) throw new Error("YouTube's answer had no list");
  return new Set(payload.items.map((item) => item?.id).filter((id) => typeof id === "string"));
}

/** Same rule as the dashboard's chatHoldsYouTube (apps/web/src/lib/agent-chat.ts). */
export function chatHoldsYouTube(messages) {
  if (!Array.isArray(messages)) return false;
  const analytics = new Set();
  for (const message of messages) {
    if (!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type === "tool_use" && block.name === "analytics") analytics.add(block.id);
      if (block?.type === "tool_result" && analytics.has(block.tool_use_id) && /"platform":\s*"youtube"/.test(String(block.content))) return true;
    }
  }
  return false;
}

/** Must match how the dashboard names a channel when connecting it (connectYouTube). */
const handleOf = (name) => (typeof name === "string" ? name.trim().replace(/^@+/, "") : "") || "YouTube";

/**
 * Saves the account only if nobody saved it since it was read (browsers merge a newer copy in).
 * `change` returns the new item or null to leave it. Says "same", "saved", or "busy" when it kept being saved.
 */
async function changeItems(db, userId, list, change, now) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = await db.selectOne("account_state", { user_id: userId }, "payload");
    const payload = state?.payload;
    if (!payload || typeof payload !== "object" || typeof payload.revision !== "string" || !payload.slices || typeof payload.slices !== "object") return "same";
    let changed = false;
    const slices = {};
    for (const [workspace, slice] of Object.entries(payload.slices)) {
      if (!slice || typeof slice !== "object" || !Array.isArray(slice[list])) {
        slices[workspace] = slice;
        continue;
      }
      const items = slice[list].map((item) => {
        if (!item || typeof item !== "object") return item;
        const next = change(item);
        if (!next) return item;
        changed = true;
        return next;
      });
      slices[workspace] = { ...slice, [list]: items };
    }
    if (!changed) return "same";
    const { base: _base, ...rest } = payload;
    if (await db.replaceAccountState(userId, payload.revision, { ...rest, slices, revision: randomUUID() }, iso(now()))) return "saved";
  }
  return "busy";
}

const changeAccount = (db, userId, connectionId, change, now) =>
  changeItems(db, userId, "connections", (row) => (row.id === connectionId && row.platform === "youtube" ? change(row) : null), now);

const named = (channel) => (row) => {
  // A row for another channel, as after reconnecting, isn't this login's to rename.
  if (row.youtube?.channelId && row.youtube.channelId !== channel.channelId) return null;
  const handle = handleOf(channel.handle);
  const avatar = typeof channel.avatarUrl === "string" ? channel.avatarUrl : "";
  if (row.handle === handle && (row.avatarUrl || "") === avatar) return null;
  const { avatarUrl: _old, ...rest } = row;
  return { ...rest, handle, ...(avatar ? { avatarUrl: avatar } : {}) };
};

const unnamed = (row) => {
  if (row.handle === "YouTube" && !("avatarUrl" in row)) return null;
  const { avatarUrl: _old, ...rest } = row;
  return { ...rest, handle: "YouTube" };
};

export function createYouTubeCheck({ db, vault, env, channel = channelFor, now = () => Date.now(), pause = PAUSE_MS, log = console }) {
  let running = false;

  async function heldRows() {
    const held = new Map();
    let after = "";
    for (;;) {
      const rows = await db.youtubeHeld(after, PAGE);
      for (const row of rows) {
        const key = `${row.user_id}:${row.connection_id}`;
        held.set(key, [...(held.get(key) ?? []), row]);
      }
      if (rows.length < PAGE) return held;
      after = rows[rows.length - 1].id;
    }
  }

  async function checkChannel(token, rows, counts) {
    const { user_id: userId, connection_id: connectionId } = token;
    const found = await vault.read(userId, connectionId);
    if (!found || found.platform !== "youtube") return;
    let login;
    try {
      login = await vault.fresh(userId, connectionId);
    } catch (error) {
      // Only Google saying the access was taken away counts; anything else may pass by tomorrow.
      if (!(error instanceof PublishError && error.expired)) throw error;
      // The name and picture go first: if the account can't be saved now, the login stays for tomorrow's run to find again.
      if ((await changeAccount(db, userId, connectionId, unnamed, now)) === "busy") throw new Error("the account kept changing");
      counts.cleared += await clearRows(db, rows.filter(holds).map((row) => row.id), iso(now()));
      // Only the login that failed: one saved by connecting the channel again meanwhile stays.
      await db.delete("social_tokens", { user_id: userId, connection_id: connectionId, sealed: found.sealed });
      counts.revoked++;
      return;
    }
    counts.confirmed++;

    const settled = iso(now() - SETTLE_MS);
    const posted = rows.filter((row) => typeof row.publish_id === "string" && VIDEO_ID.test(row.publish_id) && row.updated_at < settled);
    const ids = [...new Set(posted.map((row) => row.publish_id))];
    for (let index = 0; index < ids.length; index += BATCH) {
      const batch = ids.slice(index, index + BATCH);
      const kept = await videosKept(login.session.accessToken, batch);
      counts.videos += batch.length;
      for (const row of posted) {
        if (!batch.includes(row.publish_id) || kept.has(row.publish_id)) continue;
        // Only while the row still names that video, and is done going out.
        const [cleared] = await db.update("post_deliveries", { id: row.id, state: row.state, publish_id: row.publish_id }, { ...CLEARED, updated_at: iso(now()) });
        if (cleared) counts.gone++;
      }
    }

    const about = await within(channel(login.session.accessToken), 20_000, "YouTube's channel");
    if (!about || about.error) throw new Error("YouTube didn't say who the channel is");
    // A login allowed to upload but not to read the channel was named "YouTube" when connected, with no picture, and stays so.
    if (!about.channelId) return;
    const saved = await changeAccount(db, userId, connectionId, named(about), now);
    if (saved === "saved") counts.renamed++;
    if (saved === "busy") throw new Error("the account kept changing");
  }

  async function pruneChats() {
    const before = iso(now() - YOUTUBE_CHAT_DAYS * DAY_MS);
    let deleted = 0;
    let after = "";
    for (;;) {
      const rows = await db.oldChats(before, after, CHAT_PAGE);
      const ids = rows.filter((row) => chatHoldsYouTube(row.messages)).map((row) => row.id);
      await db.deleteOldChats(ids, before);
      deleted += ids.length;
      if (rows.length < CHAT_PAGE) return deleted;
      after = rows[rows.length - 1].id;
    }
  }

  async function check() {
    const counts = { channels: 0, confirmed: 0, revoked: 0, failed: 0, videos: 0, gone: 0, renamed: 0, cleared: 0, chats: 0 };
    let problems = 0;
    if (env?.clientId) {
      const tokens = await db.select("social_tokens", { platform: "youtube" }, "user_id,connection_id");
      const held = await heldRows();
      for (const [index, token] of tokens.entries()) {
        if (index && pause) await sleep(pause);
        counts.channels++;
        await within(checkChannel(token, held.get(`${token.user_id}:${token.connection_id}`) ?? [], counts), CHANNEL_MS, "the channel's check").catch((error) => {
          counts.failed++;
          log.warn("[publisher] YouTube check skipped a channel until tomorrow:", error instanceof Error ? error.message : error);
        });
      }
      // Rows of channels disconnected since, or before plan.video cleared them on disconnect.
      const kept = new Set(tokens.map((token) => `${token.user_id}:${token.connection_id}`));
      for (const [key, rows] of held) {
        if (kept.has(key)) continue;
        const { user_id: userId, connection_id: connectionId } = rows[0];
        try {
          // Asked again on its own, so a list that came back short never reads as every channel gone.
          if (await db.selectOne("social_tokens", { user_id: userId, connection_id: connectionId }, "platform")) continue;
          counts.cleared += await clearRows(db, rows.map((row) => row.id), iso(now()));
        } catch (error) {
          problems++;
          log.warn("[publisher] YouTube check couldn't clear a disconnected channel:", error instanceof Error ? error.message : error);
        }
      }
    }
    try {
      counts.chats = await pruneChats();
    } catch (error) {
      problems++;
      log.warn("[publisher] YouTube check couldn't prune Assistant chats:", error instanceof Error ? error.message : error);
    }
    log.log(
      `[publisher] YouTube check: ${counts.channels} channels, ${counts.confirmed} still allowed, ${counts.revoked} access removed, ${counts.failed} to try again; ` +
        `${counts.videos} videos looked up, ${counts.gone} gone; ${counts.renamed} names or pictures updated; ${counts.cleared} rows of removed channels cleared; ` +
        `${counts.chats} old chats with YouTube numbers deleted${problems ? `; ${problems} problems` : ""}`,
    );
    return counts;
  }

  return {
    async run() {
      if (running) return null;
      running = true;
      try {
        return await check();
      } finally {
        running = false;
      }
    },
  };
}
