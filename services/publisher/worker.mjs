// Posts live in account_state, which only browsers write; the publisher writes only its own rows.
// A post_deliveries row per network and account keeps a post from going out twice.
// A send whose outcome is unknown (answer or service cut off) is never retried on its own:
// it fails with a note to check the network. Making a post once its file is ready is claimed the same way.

import { connectWithin } from "./accounts.mjs";
import { PublishError } from "./errors.mjs";
import { fileIdsOf } from "./media.mjs";
import { OVER_SCHEDULED, isWaiting, startOf, waitingUntil } from "./plans.mjs";
import { createMemoryGate, createPool } from "./pool.mjs";
import { createReplies } from "./replies.mjs";
import { dayAt, dueAtOf, nextRunAfter, runsBetween, zoneOrUtc } from "./schedule.mjs";

/** Runs that came due longer ago than this (publisher down) fail with LATE instead of sending. */
export const GRACE_MS = 24 * 60 * 60_000;
export const LATE = "This post's time passed over a day ago while plan.video couldn't send it, so it didn't go out. Post it now, or give it a new time.";
/** Slack for a post saved as due "now" whose time was given a few moments after its minute. */
const TIMED_SLACK_MS = 5 * 60_000;
const BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const CHECK_EVERY_MS = 60_000;
/** An upload the network is still processing after this fails the post. */
const CHECK_LIMIT_MS = 2 * 60 * 60_000;
/** A send still marked as sending after this was cut off by a restart. */
const STALE_SEND_MS = 30 * 60_000;
const FILE_WAIT_MS = 30 * 60_000;
const PLUG_EVERY_MS = 6 * 60 * 60_000;
const PLUG_CHECKS = 3;
const LOOK = 50;
export const SENDS_AT_ONCE = 16;
export const PER_USER = 4;
/** Kept well inside the unit's 1 GB, with photos.mjs making pictures beside the sends. */
export const MEMORY_BUDGET = 256 * 1024 * 1024;
/** Cap on a row's immediate restarts a second, so one stuck row can't spin. */
const STARTS_A_SECOND = 3;
const AHEAD_MS = 2 * 60_000;
const DUE_PAGE = 200;
const MAX_DUE_PAGES = 500;
const RETRY_LOOK_MS = 60_000;
/** Kept this long so devices away that long still learn of the delete. */
const DELETED_KEPT_MS = 90 * 24 * 60 * 60_000;

export function lookAgainIn(waited) {
  return waited < 15_000 ? 5_000 : waited < 45_000 ? 10_000 : waited < 2 * 60_000 ? 20_000 : CHECK_EVERY_MS;
}
/** Under PostgREST's cap of 1000 rows an answer. */
export const PAGE = 500;
/** Bounds a pass (10 million rows) so no answer can keep it reading for ever. */
const MAX_PAGES = 20_000;

/** Ids post_deliveries accepts; posts with other ids are skipped, not sent. */
const ID = /^[A-Za-z0-9_-]{1,100}$/;

// Anyone can write their own account state, so malformed posts are skipped rather than read.
const isPost = (post) => typeof post?.id === "string" && ID.test(post.id) && (post.platforms === undefined || Array.isArray(post.platforms));

/** Postgres orders uuids by their bytes, which is the order of their hex. Null past the last uuid or for non-uuids. */
export function nextUuid(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? "")) return null;
  const next = BigInt(`0x${id.replaceAll("-", "")}`) + 1n;
  if (next >> 128n) return null;
  const hex = next.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const NAMES = { tiktok: "TikTok", youtube: "YouTube", bluesky: "Bluesky", linkedin: "LinkedIn", x: "X", instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

function namedOn(post, platform) {
  const raw = post.accounts?.[platform];
  return typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
}

// Only a post naming no account here falls back to the one connected; a post whose named
// accounts were all removed goes out from none, never from an account nobody picked.
export function accountsFor(post, platform, connections) {
  const list = connections.filter((item) => item.platform === platform && ID.test(item.id ?? "")).map((item) => item.id);
  const chosen = namedOn(post, platform);
  if (chosen.length) return list.filter((id) => chosen.includes(id));
  return list.length === 1 ? list : [];
}

function noAccount(post, platform, connections) {
  const name = NAMES[platform];
  if (!connections.some((item) => item.platform === platform)) return `Connect ${name} in Connections, then post it.`;
  if (namedOn(post, platform).length) return `Its ${name} account was removed. Pick which ${name} account it goes out from, then post it.`;
  return `Pick which ${name} account it goes out from, then post it.`;
}

/** When the browser last timed the post (`sendFrom`), less slack; 0 when it has none. */
export function timedFrom(post) {
  const at = Date.parse(post?.sendFrom ?? "");
  return Number.isFinite(at) ? at - TIMED_SLACK_MS : 0;
}

// accountLimits, planLimits and notices are optional: without them nothing is limited and
// failed sends show only in the dashboard.
export function createWorker({
  db,
  vault,
  media,
  networks,
  plugs,
  accountLimits,
  planLimits,
  notices,
  sendFrom = 0,
  sendsAtOnce = SENDS_AT_ONCE,
  perUser = PER_USER,
  memoryBudget = MEMORY_BUDGET,
  now = () => Date.now(),
  log = console,
}) {
  const iso = (time) => new Date(time).toISOString();
  const pool = createPool({ size: sendsAtOnce, perUser, onFree: () => void dispatch() });
  const memory = createMemoryGate(memoryBudget);
  const replies = createReplies({ db, vault, networks, media, notices, postIn, memory, now, log });

  function rowsFor(userId, workspaceId, connections, post, runs, { requested = false, late = false } = {}) {
    if (!isPost(post) || typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 100) return [];
    const rows = [];
    for (const run of runs) {
      for (const platform of new Set(post.platforms ?? [])) {
        if (!networks[platform]) continue;
        const base = { user_id: userId, workspace_id: workspaceId, post_id: post.id, occurrence: run.occurrence, platform, due_at: iso(run.dueAt), requested };
        const accounts = accountsFor(post, platform, connections);
        if (!accounts.length) {
          rows.push({ ...base, connection_id: "none", state: "failed", error: noAccount(post, platform, connections), next_at: iso(run.dueAt) });
          continue;
        }
        for (const connectionId of accounts) {
          if (late) {
            rows.push({ ...base, connection_id: connectionId, state: "failed", error: LATE, next_at: iso(run.dueAt) });
          } else if (!requested && planLimits?.over(userId, workspaceId, post.id, connectionId)) {
            // Only scheduled runs are held to the plan; Post now always goes.
            rows.push({ ...base, connection_id: connectionId, state: "failed", error: OVER_SCHEDULED, next_at: iso(run.dueAt) });
          } else rows.push({ ...base, connection_id: connectionId, state: "queued", next_at: iso(now()) });
        }
      }
    }
    return rows;
  }

  function waitingEntries(found, at, skipped) {
    const entries = [];
    for (const item of found) {
      const post = item?.post;
      if (!isPost(post) || typeof item.workspace_id !== "string" || !item.workspace_id || item.workspace_id.length > 100) continue;
      try {
        const accounts = new Set();
        for (const platform of new Set(post.platforms ?? [])) {
          if (networks[platform]) for (const id of accountsFor(post, platform, item.connections ?? [])) accounts.add(id);
        }
        const waiting = isWaiting(post, item.time_zone, at);
        const start = startOf(post, item.time_zone);
        const until = waitingUntil(post, item.time_zone);
        for (const connectionId of accounts) entries.push({ user_id: item.user_id, workspace_id: item.workspace_id, post_id: post.id, connection_id: connectionId, waiting, until, start });
      } catch (error) {
        skipped.add(item.user_id, error);
      }
    }
    return entries;
  }

  // Logs unreadable posts once a person a pass: anyone can save anything in their own account state.
  function skipList() {
    const people = new Map();
    return {
      add(userId, error) {
        if (!people.has(userId)) people.set(userId, error instanceof Error ? error.message : String(error));
      },
      report() {
        if (people.size) log.error("[publisher] skipped posts that can't be read", Object.fromEntries(people));
      },
    };
  }

  let nextDue = null;
  const firstSeen = new Map();

  // `sendFrom` is the saving device's clock; one running fast would put it after the post's own time
  // and the run would never be planned, so it's capped at when this publisher first saw it.
  function timedFor(item, at) {
    const timed = timedFrom(item.post);
    if (!timed) return timed;
    const key = `${item.user_id}|${item.workspace_id ?? ""}|${item.post.id}|${item.post.sendFrom}`;
    const first = firstSeen.get(key) ?? at;
    firstSeen.set(key, first);
    return Math.min(timed, first - TIMED_SLACK_MS);
  }

  function forgetFirstSeen(at) {
    for (const [key, first] of firstSeen) if (at - first > GRACE_MS + TIMED_SLACK_MS) firstSeen.delete(key);
  }

  const keyOf = (row) => `${row.user_id}|${row.post_id}|${row.occurrence}|${row.platform}|${row.connection_id}`;

  // Falls back to the one-call function (max 1000 rows) on a database without the paged one.
  // When `after` can't give a row's key exactly (a numeric post id the db orders as text "1.0"),
  // the next page starts past that person's rows, so pages always move on.
  async function everyRow(paged, whole, after) {
    const rows = [];
    let last = null;
    for (let from = {}, pages = 0; ; pages++) {
      if (pages >= MAX_PAGES) {
        log.error("[publisher] stopped reading pages: too many", paged);
        return rows;
      }
      let page;
      try {
        page = (await db.rpc(paged, { ...from, size: PAGE })) ?? [];
      } catch (error) {
        if (rows.length || !/PGRST202/.test(String(error?.message))) throw error;
        return (await db.rpc(whole)) ?? [];
      }
      rows.push(...page);
      if (page.length < PAGE) return rows;
      const end = page.at(-1);
      let next = after(end);
      if (!next || JSON.stringify(next) === last) {
        const user = nextUuid(end?.user_id);
        if (!user) return rows;
        log.error("[publisher] skipped the rest of an account's rows that can't be paged past", paged, end.user_id);
        next = { after_user: user };
      }
      last = JSON.stringify(next);
      from = next;
    }
  }

  const sendable = (post) => post.status === "scheduled" && !post.paused && (post.platforms ?? []).some((platform) => networks[platform]);

  // A run due before its post was given its time (moved into the past, passed while paused) is sent
  // only by Post now. A run older than GRACE_MS without a row (publisher down) gets a failed row, so
  // it isn't dropped silently; each post is scanned for that once, from planned_through.
  async function plan() {
    const at = now();
    const from = Math.max(at - GRACE_MS, sendFrom);
    const looked = new Set();
    let made = 0;
    for (const owner of (await planLimits?.upgraded?.()) ?? []) await db.rpc("publisher_look_again", { owner });
    for (let pages = 0; pages < MAX_DUE_PAGES; pages++) {
      const due = (await db.rpc("publisher_due", { before: iso(at), size: DUE_PAGE })) ?? [];
      // A post changed while this pass ran is due again: it waits for the next pass rather than looping this one.
      const fresh = due.filter((row) => !looked.has(`${row.user_id}|${row.post_id}`));
      for (const row of fresh) looked.add(`${row.user_id}|${row.post_id}`);
      if (fresh.length) made += await planPosts(fresh, at, from);
      if (due.length < DUE_PAGE || !fresh.length) break;
    }
    forgetFirstSeen(at);
    const soonest = Date.parse((await db.rpc("publisher_next_due")) ?? "");
    // Never sooner than a second from now, so a post that can't be kept as looked at can't make the passes spin.
    nextDue = Number.isFinite(soonest) && soonest <= at + AHEAD_MS ? Math.max(soonest, now() + 1_000) : null;
    return made;
  }

  async function planPosts(due, at, from) {
    const skipped = skipList();
    const items = [];
    const entries = [];
    for (const row of due) {
      const item = { user_id: row.user_id, workspace_id: row.workspace_id, time_zone: row.time_zone, connections: row.connections, post: row.post };
      const look = { user_id: row.user_id, post_id: row.post_id, version: row.version, next_run_at: null, planned_through: iso(at) };
      items.push({ row, item, look });
      if (row.post && isPost(row.post) && sendable(row.post)) entries.push(...waitingEntries([item], at, skipped));
    }
    // Only these posts were looked at: everyone else's waiting posts count as they were.
    await planLimits?.review(entries, { posts: new Set(due.map((row) => `${row.user_id}|${row.workspace_id}|${row.post_id}`)) });

    const byUser = new Map();
    const failing = new Map();
    for (const { row, item, look } of items) {
      if (!row.post || !isPost(row.post)) {
        if (row.post) skipped.add(row.user_id, new Error("unreadable post"));
        continue;
      }
      if (!sendable(row.post)) continue;
      try {
        const timed = timedFor(item, at);
        const planned = Date.parse(row.planned_through ?? "");
        const lateFrom = Math.max(Number.isFinite(planned) ? planned : sendFrom, sendFrom, timed);
        const late = runsBetween(item.post, item.time_zone, lateFrom, from);
        const runs = runsBetween(item.post, item.time_zone, Math.max(from, timed), at);
        const next = nextRunAfter(item.post, item.time_zone, at);
        look.next_run_at = next === null ? null : iso(next);
        if (!runs.length && !late.length) continue;
        const rows = [
          ...rowsFor(item.user_id, item.workspace_id, item.connections ?? [], item.post, late, { late: true }),
          ...rowsFor(item.user_id, item.workspace_id, item.connections ?? [], item.post, runs),
        ];
        for (const made of rows) if (made.state === "failed") failing.set(keyOf(made), item);
        if (!byUser.has(item.user_id)) byUser.set(item.user_id, []);
        byUser.get(item.user_id).push(...rows);
      } catch (error) {
        skipped.add(item.user_id, error);
        Object.assign(look, { next_run_at: iso(at + RETRY_LOOK_MS), planned_through: row.planned_through ?? null });
      }
    }
    skipped.report();

    let made = 0;
    for (const [userId, rows] of byUser) {
      try {
        const inserted = await db.insertNew("post_deliveries", rows, "user_id,post_id,occurrence,platform,connection_id");
        made += inserted.length;
        for (const row of inserted) {
          const item = failing.get(keyOf(row));
          if (row.state === "failed" && item) await notices?.failed(row, { post: item.post, zone: zoneOrUtc(item.post.timeZone ?? item.time_zone), message: row.error });
        }
        await retryClashes(userId, rows, new Set(inserted.map(keyOf)));
      } catch (error) {
        log.error("[publisher] planning failed for one account", userId, error instanceof Error ? error.message : error);
        for (const { row, look } of items) {
          if (row.user_id === userId) Object.assign(look, { next_run_at: iso(at + RETRY_LOOK_MS), planned_through: row.planned_through ?? null });
        }
      }
    }
    await db.rpc("publisher_schedule", { items: items.map(({ look }) => look) });
    return made;
  }

  // Hourly: recounts Free's waiting posts and fixes any next look later than its next run (a lost write).
  // Runs beside planning: skips waiting posts kept after `readAt`, fixes a look only over the version it read.
  async function sweep() {
    const at = now();
    const found = await everyRow("publisher_posts_after", "publisher_posts", (row) => {
      const id = row.post?.id;
      // The database orders by the id's text, which only a string (or no id) gives back exactly.
      if (id != null && typeof id !== "string") return null;
      return { after_user: row.user_id, after_workspace: row.workspace_id, after_post: id ?? "" };
    });
    const skipped = skipList();
    await planLimits?.review(waitingEntries(found, at, skipped), { readAt: at });
    const wrong = [];
    for (const item of found) {
      if (!isPost(item?.post) || !sendable(item.post)) continue;
      try {
        const next = nextRunAfter(item.post, item.time_zone, at);
        const kept = Date.parse(item.next_run_at ?? "");
        if (next !== null && !(kept <= next)) wrong.push({ user_id: item.user_id, post_id: item.post.id, version: item.version, next_run_at: iso(at), planned_through: null });
      } catch (error) {
        skipped.add(item.user_id, error);
      }
    }
    skipped.report();
    if (wrong.length) {
      log.error("[publisher] posts whose next look came after their next run, looked at again", wrong.length);
      await db.rpc("publisher_schedule", { items: wrong });
    }
    await db.rpc("publisher_prune_deleted", { before: iso(at - DELETED_KEPT_MS) });
    return wrong.length;
  }

  async function retryClashes(userId, rows, inserted) {
    const clashing = new Map(rows.filter((row) => row.state === "queued" && !inserted.has(keyOf(row))).map((row) => [keyOf(row), row]));
    if (!clashing.size) return;
    const ids = [...new Set([...clashing.values()].map((row) => row.post_id))];
    const before = await db.select("post_deliveries", { user_id: userId, state: "failed", post_id: ids }, "id,user_id,post_id,occurrence,platform,connection_id,due_at,attempts");
    for (const existing of before) {
      const row = clashing.get(keyOf(existing));
      if (!row) continue;
      const movedLater = row.occurrence === "once" && Date.parse(existing.due_at) < Date.parse(row.due_at) - 60_000;
      // Never reached the network (paused or moved to drafts, since undone), so it's safe to queue again.
      const neverTried = existing.attempts === 0;
      if (!movedLater && !neverTried) continue;
      await db.update("post_deliveries", { id: existing.id, state: "failed" }, {
        state: "queued",
        error: null,
        due_at: row.due_at,
        next_at: row.next_at,
        publish_id: null,
        url: null,
        attempts: 0,
        updated_at: iso(now()),
      });
    }
  }

  // A post of the same id in another workspace never goes out in its place.
  // A database whose publisher_post takes no workspace is asked without one.
  async function postIn(owner, post, workspace) {
    if (workspace === undefined) return (await db.rpc("publisher_post", { owner, post })) ?? [];
    try {
      return (await db.rpc("publisher_post", { owner, post, workspace })) ?? [];
    } catch (error) {
      if (!/PGRST202/.test(String(error?.message))) throw error;
      const found = (await db.rpc("publisher_post", { owner, post })) ?? [];
      return found.filter((row) => row.workspace_id === workspace);
    }
  }

  async function failedRun(userId, postId) {
    const rows = (await db.select("post_deliveries", { user_id: userId, post_id: postId }, "occurrence,state")).filter((row) => row.occurrence !== "once");
    const latest = rows.reduce((day, row) => (row.occurrence > day ? row.occurrence : day), "");
    return rows.some((row) => row.occurrence === latest && row.state === "failed") ? latest : null;
  }

  // `workspace`, for a team member, is the one workspace of the owner's they may post from.
  // A repeating post whose latest run failed sends that run again rather than using up today's.
  async function request(userId, postId, workspace) {
    const [found] = await postIn(userId, postId, workspace);
    if (!found?.post || (workspace !== undefined && found.workspace_id !== workspace)) throw new PublishError("This post isn't saved yet. Wait a moment and try again.");
    const post = found.post;
    if (post.status === "posted") throw new PublishError("This post has already gone out.");
    const zone = zoneOrUtc(post.timeZone ?? found.time_zone);
    const occurrence = post.recurrence ? ((await failedRun(userId, postId)) ?? dayAt(now(), zone)) : "once";
    const rows = rowsFor(userId, found.workspace_id, found.connections ?? [], post, [{ occurrence, dueAt: now() }], { requested: true });
    if (!rows.length) throw new PublishError("None of this post's networks can publish from plan.video.");
    await db.insertNew("post_deliveries", rows, "user_id,post_id,occurrence,platform,connection_id");
    // Anything that failed or is waiting goes now, with its tries counted afresh; anything sent stays sent.
    const existing = await db.select("post_deliveries", { user_id: userId, post_id: postId, occurrence }, "id,state,platform,connection_id");
    for (const row of existing) {
      const wanted = rows.some((item) => item.platform === row.platform && item.connection_id === row.connection_id && item.state === "queued");
      if (!wanted || (row.state !== "failed" && row.state !== "queued")) continue;
      await db.update("post_deliveries", { id: row.id, state: row.state }, {
        state: "queued",
        error: null,
        attempts: 0,
        next_at: iso(now()),
        requested: true,
        updated_at: iso(now()),
      });
    }
    return db.select("post_deliveries", { user_id: userId, post_id: postId, occurrence }, "*");
  }

  function stillWanted(row, post, zone) {
    if (!post) return "The post was deleted before it went out.";
    if (post.paused) return "The post was paused before it went out.";
    if (!post.platforms?.includes(row.platform)) return `${NAMES[row.platform]} was taken off the post before it went out.`;
    if (row.requested) return null;
    if (post.status !== "scheduled") return "The post was moved to drafts before it went out.";
    const dueAt = dueAtOf(post, zone, row.occurrence);
    if (dueAt === null) return "The post was moved before it went out.";
    return null;
  }

  // Repeating runs are keyed by their day in the post's zone, so saving it in another zone gives a run a
  // new day at the same moment. Rows never tried don't count, so a run stopped by a pause still goes.
  async function sameRun(row) {
    if (row.occurrence === "once" || row.requested) return null;
    const rows = await db.select(
      "post_deliveries",
      { user_id: row.user_id, post_id: row.post_id, platform: row.platform, connection_id: row.connection_id, due_at: row.due_at },
      "occurrence,state,attempts,publish_id,url,error",
    );
    return rows.find((other) => other.occurrence !== row.occurrence && other.attempts > 0) ?? null;
  }

  async function settle(row, values) {
    return db.update("post_deliveries", { id: row.id }, { ...values, updated_at: iso(now()) });
  }

  async function failed(row, error, about = {}) {
    const message = error instanceof PublishError ? error.message : "Something went wrong on plan.video's side. Trying again soon.";
    const retry = !(error instanceof PublishError) || error.retry;
    if (!(error instanceof PublishError)) log.error("[publisher] send failed", row.id, error);
    if (retry && row.attempts < MAX_ATTEMPTS) {
      await settle(row, { state: "queued", error: message, next_at: iso(now() + BACKOFF_MS[row.attempts - 1]) });
    } else {
      await settle(row, { state: "failed", error: message, next_at: iso(now()) });
      await notices?.failed(row, { ...about, message: error instanceof PublishError ? message : "Something went wrong on plan.video's side." });
    }
  }

  /** Keeps how far a send got, such as an upload the network started, so a later try carries on from there. */
  const progress = (row) => async (publishId) => {
    await db.update("post_deliveries", { id: row.id }, { publish_id: publishId });
    row.publish_id = publishId;
  };

  // Counts against the owner's daily YouTube uploads only once the network takes the upload. A count
  // that can't be kept is logged rather than stopping an upload YouTube already has.
  const counted = (row) => {
    const keep = progress(row);
    let first = true;
    return async (publishId) => {
      await keep(publishId);
      if (!first) return;
      first = false;
      await planLimits.countUpload(row.user_id, row.platform).catch((error) => log.error("[publisher] couldn't count an upload", row.id, error instanceof Error ? error.message : error));
    };
  };

  async function sendOne(row) {
    // Claimed by matching its state and time, so no other loop takes it too.
    const [claimed] = await db.update("post_deliveries", { id: row.id, state: row.state, next_at: row.next_at }, {
      state: "sending",
      attempts: row.attempts + 1,
      updated_at: iso(now()),
    });
    if (!claimed) return;
    let result;
    let post = null;
    let zone;
    try {
      const [found] = await postIn(row.user_id, row.post_id, row.workspace_id);
      post = found?.post ?? null;
      zone = zoneOrUtc(post?.timeZone ?? found?.time_zone);
      if (post && !row.requested) {
        // Moved later since the row was made: the row waits for the new time, without an earlier wait's reason.
        const dueAt = dueAtOf(post, zone, row.occurrence);
        if (dueAt !== null && dueAt > now() + 60_000) {
          await settle(claimed, { state: "queued", attempts: row.attempts, error: null, due_at: iso(dueAt), next_at: iso(dueAt) });
          return;
        }
      }
      const unwanted = stillWanted(claimed, post, zone);
      if (unwanted) {
        // Never reached the network, so undoing the pause or the move sends it after all.
        await settle(claimed, { state: "failed", error: unwanted, attempts: row.attempts });
        return;
      }
      const twin = await sameRun(claimed);
      if (twin) {
        // It went out, or is going, as another day's run: this row waits for that one and says the same.
        const done = twin.state === "sent" || twin.state === "failed";
        await settle(
          claimed,
          done
            ? { state: twin.state, publish_id: twin.publish_id, url: twin.url, error: twin.error, plug_checks: PLUG_CHECKS }
            : { state: "queued", attempts: row.attempts, next_at: iso(now() + CHECK_EVERY_MS) },
        );
        return;
      }
      const network = networks[row.platform];
      const login = await vault.fresh(row.user_id, row.connection_id);
      // The files it goes out with here, in order. One saved before posts listed them has its one file, if any, under its own id.
      const ids = fileIdsOf(post, row.platform);
      const files = (await Promise.all((ids ?? [row.post_id]).map((id) => media.postFile(row.user_id, id)))).filter(Boolean);
      // A post made from a project goes with the project's video. Saved without it, as when the export failed, it isn't sent as words alone.
      if (post.projectId && (ids ? !ids.length : !files.length) && !claimed.publish_id) {
        throw new PublishError("The project's video didn't export, so the post has no video. Open it, retry the export or attach a video, then post it again.");
      }
      // Every file the post lists goes with it, never the words without them. TikTok and YouTube
      // need their video from an older post too, unless an earlier try already got it to them.
      const missing = ids ? files.length < ids.length : network.needsFile && !files.length;
      if (missing && !(network.needsFile && claimed.publish_id)) {
        if (now() - Date.parse(claimed.due_at) >= FILE_WAIT_MS) {
          throw new PublishError("The post's media never reached plan.video's storage. Open plan.video in the browser it was made in, then post it again.");
        }
        // Not a try, since the files are on their way: it looks again soon, and goes once the upload lands.
        await settle(claimed, {
          state: "queued",
          attempts: row.attempts,
          error: "The post's media is still uploading to plan.video. Trying again soon.",
          next_at: iso(now() + lookAgainIn(now() - Date.parse(claimed.due_at))),
        });
        return;
      }
      // A new upload needs one of the owner's for the day left; one an earlier try started already has its own.
      const counts = row.platform === "youtube" && !claimed.publish_id && planLimits;
      if (counts) {
        const wait = await planLimits.uploadWait(row.user_id, row.platform);
        if (wait) {
          await settle(claimed, {
            state: "queued",
            attempts: row.attempts,
            error: `Your plan uploads up to ${wait.most} YouTube videos a day for now, and today's are used. This one goes out on its own once one frees up.`,
            next_at: iso(Math.max(wait.until, now() + CHECK_EVERY_MS)),
          });
          return;
        }
      }
      const release = await memory.hold(network.holds?.(files) ?? 0);
      try {
        result = await network.send({ post, session: login.session, files, media, delivery: claimed, progress: counts ? counted(claimed) : progress(claimed) });
      } finally {
        release();
      }
    } catch (error) {
      // A limit on the plan that frees up later, like X's posts a day: it waits for then, and that wasn't a try.
      if (error instanceof PublishError && error.until) {
        await settle(claimed, { state: "queued", attempts: row.attempts, error: error.message, next_at: iso(Math.max(error.until, now() + CHECK_EVERY_MS)) });
        return;
      }
      await failed(claimed, error, { post, zone });
      return;
    }
    // The network has it now. If keeping that fails, the row stays as sending and
    // is later marked to be checked, rather than sent again.
    await record(claimed, result, post).catch((error) => log.error("[publisher] couldn't keep a finished send", claimed.id, error));
  }

  async function record(row, result, post) {
    if (result.state === "processing") {
      await settle(row, { state: "processing", publish_id: result.publishId, error: null, next_at: iso(now() + lookAgainIn(0)) });
      return;
    }
    const plugged = plugs?.platforms.includes(row.platform);
    const [sent] = await settle(row, {
      state: "sent",
      publish_id: result.publishId ?? row.publish_id,
      url: result.url ?? null,
      error: result.note ?? null,
      next_at: iso(now() + (plugged ? PLUG_EVERY_MS : 0)),
      plug_checks: plugged ? 0 : PLUG_CHECKS,
    });
    if (sent) {
      await replies.start(sent, post);
      if (sent.occurrence === "once") await markPosted(sent);
    }
  }

  // Best effort: the browser still marks it posted when it sees the sends.
  async function markPosted(row) {
    try {
      const runs = await db.select("post_deliveries", { user_id: row.user_id, post_id: row.post_id, occurrence: "once" }, "state");
      if (runs.length && runs.every((run) => run.state === "sent")) await db.rpc("publisher_mark_posted", { owner: row.user_id, post: row.post_id });
    } catch (error) {
      log.error("[publisher] couldn't mark a post as posted", row.post_id, error instanceof Error ? error.message : error);
    }
  }

  async function checkOne(row) {
    const network = networks[row.platform];
    const waited = now() - Date.parse(row.updated_at);
    let claimed = null;
    let result;
    let post = null;
    let zone;
    try {
      const [found] = await postIn(row.user_id, row.post_id, row.workspace_id);
      post = found?.post ?? null;
      zone = zoneOrUtc(post?.timeZone ?? found?.time_zone);
      // Where the post is made only once the network has the file, a post stopped meanwhile isn't made.
      if (network.publish) {
        const unwanted = stillWanted(row, post, zone);
        if (unwanted) {
          await settle(row, { state: "failed", error: unwanted });
          return;
        }
      }
      const login = await vault.fresh(row.user_id, row.connection_id);
      result = await network.check({ post, session: login.session, delivery: row });
      if (result.state === "processing") {
        // Only the next look moves: updated_at stays when processing started.
        await db.update("post_deliveries", { id: row.id }, { next_at: iso(now() + lookAgainIn(waited)) });
        return;
      }
      if (result.state === "ready") {
        // Claimed before the post is made, like a send: if anything is cut off, the row is left sending
        // and later marked to be checked, instead of the next look making it again.
        [claimed] = await db.update("post_deliveries", { id: row.id, state: "processing", next_at: row.next_at }, { state: "sending" });
        if (!claimed) return;
        result = await network.publish({ post, session: login.session, delivery: claimed });
      }
    } catch (error) {
      // Nothing was made: publish says to try again only when the network turned the post down.
      if (error instanceof PublishError && error.retry && waited < CHECK_LIMIT_MS) {
        await db.update("post_deliveries", { id: row.id, state: claimed ? "sending" : "processing" }, { state: "processing", next_at: iso(now() + lookAgainIn(waited)) });
        return;
      }
      await failed({ ...row, attempts: MAX_ATTEMPTS }, error, { post, zone });
      return;
    }
    // The network has it now. If keeping that fails, a post just made stays as
    // sending, like a send, and anything else is looked at again.
    await record(row, result, post).catch((error) => log.error("[publisher] couldn't keep a finished send", row.id, error));
  }

  async function plugOne(row) {
    const finish = (values) => db.update("post_deliveries", { id: row.id }, values);
    try {
      const settings = (await db.rpc("publisher_plugs", { owner: row.user_id, workspace: row.workspace_id })) ?? [];
      const sentAt = Date.parse(row.updated_at);
      const wanted = plugs.forAccount(settings, row.connection_id, row.platform, sentAt).filter((plug) => !row.plugs_done.includes(plug.kind));
      if (!wanted.length) return finish({ plug_checks: PLUG_CHECKS });
      const done = await plugs.run(row, wanted, (await vault.fresh(row.user_id, row.connection_id)).session);
      const checks = row.plug_checks + 1;
      await finish({ plugs_done: [...row.plugs_done, ...done], plug_checks: checks, next_at: iso(Date.parse(row.next_at) + PLUG_EVERY_MS) });
    } catch (error) {
      if (error instanceof PublishError && error.retry) return finish({ next_at: iso(now() + 15 * 60_000) });
      log.error("[publisher] plug failed", row.id, error instanceof Error ? error.message : error);
      await finish({ plug_checks: row.plug_checks + 1, next_at: iso(Date.parse(row.next_at) + PLUG_EVERY_MS) });
    }
  }

  // Logins left in account_state from before they moved to the server, so those posts still go out.
  // Anyone can write their own account_state, so a "Sign in with Bluesky" login, which only names an
  // account, is never taken from there. A new account is taken only while the plan has room for it.
  async function adopt() {
    const found = await everyRow("publisher_legacy_logins_after", "publisher_legacy_logins", (row) => ({
      after_user: row.user_id,
      after_workspace: row.workspace_id,
      after_connection: row.connection_id,
    }));
    let kept = 0;
    for (const row of found) {
      if (!ID.test(row.connection_id ?? "") || row.session?.oauth) continue;
      try {
        const keep = () => vault.put(row.user_id, row.connection_id, row.platform, row.session, { replace: false });
        // Strict: a limit that can't be read waits for the next look.
        const turnedAway = await connectWithin({ vault, limits: accountLimits, userId: row.user_id, connectionId: row.connection_id, strict: true }, keep);
        if (turnedAway === null) kept++;
      } catch {
        // Not a login the server can use: the browser hands it over, or the account connects again.
      }
    }
    return kept;
  }

  async function cutOff(row) {
    if (!notices) return;
    const [found] = await postIn(row.user_id, row.post_id, row.workspace_id).catch(() => []);
    await notices.failed(row, { post: found?.post, zone: zoneOrUtc(found?.post?.timeZone ?? found?.time_zone), message: row.error });
  }

  const sources = [
    { table: "post_deliveries", due: (at, skip) => db.due(["queued", "processing"], at, LOOK, skip), run: (row) => (row.state === "queued" ? sendOne(row) : checkOne(row)) },
    { table: "post_replies", due: (_at, skip) => replies.due(LOOK, skip), run: (row) => replies.sendOne(row) },
    ...(plugs ? [{ table: "plugs", due: (at, skip) => db.plugsDue(PLUG_CHECKS, at, LOOK, skip), run: (row) => plugOne(row) }] : []),
  ];
  const started = new Map();
  let stopped = false;

  function start(source, row) {
    const key = `${source.table}|${row.id}`;
    const recent = started.get(key);
    if (recent && now() - recent.at < 1_000 && recent.count >= STARTS_A_SECOND) return false;
    const taken = pool.take(source.table, row, async () => {
      try {
        await source.run(row);
      } catch (error) {
        log.error(`[publisher] ${source.table === "post_replies" ? "sending a follow-up" : source.table === "plugs" ? "a plug" : "sending"} failed`, row.id, error instanceof Error ? error.message : error);
      }
    });
    if (taken) started.set(key, recent && now() - recent.at < 1_000 ? { at: recent.at, count: recent.count + 1 } : { at: now(), count: 1 });
    return taken;
  }

  async function fill() {
    const at = iso(now());
    for (const [key, recent] of started) if (now() - recent.at >= 1_000) started.delete(key);
    for (const source of sources) {
      for (let round = 0; round < sendsAtOnce && pool.free > 0 && !stopped; round++) {
        let rows;
        try {
          rows = await source.due(at, pool.busy());
        } catch (error) {
          log.error(`[publisher] couldn't look for due ${source.table}`, error instanceof Error ? error.message : error);
          break;
        }
        let count = 0;
        for (const row of rows ?? []) {
          if (!pool.free || stopped) break;
          if (start(source, row)) count++;
        }
        if (!count) break;
      }
    }
  }

  let filling = null;
  let refill = false;

  // Never two fills at once: one asked for during another runs again after it, so a lane freed
  // meanwhile is filled. The last look and letting go happen in one step, so no ask falls between.
  function dispatch() {
    if (filling) {
      refill = true;
      return filling;
    }
    filling = (async () => {
      await null;
      try {
        do {
          refill = false;
          await fill();
        } while (refill && !stopped);
      } finally {
        filling = null;
      }
    })();
    return filling;
  }

  let passing = null;
  let passAgain = false;

  async function passOnce() {
    const planned = await plan().then(
      () => true,
      (error) => {
        log.error("[publisher] planning failed", error);
        return false;
      },
    );
    const at = iso(now());
    // Sends cut off by a restart: an upload that can carry on does; anything else may have gone out. The ones going here aren't.
    const cut = await db.abandonStale(iso(now() - STALE_SEND_MS), at, pool.goingIn("post_deliveries")).catch((error) => log.error("[publisher] couldn't settle cut-off sends", error));
    for (const row of cut ?? []) await cutOff(row);
    await replies.housekeep(pool.goingIn("post_replies")).catch((error) => log.error("[publisher] couldn't settle cut-off follow-ups", error instanceof Error ? error.message : error));
    return planned;
  }

  // Passes don't overlap: one asked for during another runs once it ends. True only when it planned,
  // so health turns red when planning keeps failing.
  function pass() {
    if (passing) {
      passAgain = true;
      return passing;
    }
    passing = (async () => {
      await null;
      try {
        let planned;
        do {
          passAgain = false;
          planned = await passOnce();
          void dispatch();
        } while (passAgain && !stopped);
        return planned;
      } finally {
        passing = null;
      }
    })();
    return passing;
  }

  const idle = () => pool.idle(() => filling ?? passing);

  // For tests; the service runs pass and dispatch on their own timers.
  async function tick() {
    const planned = await pass();
    await dispatch();
    await idle();
    return planned;
  }

  async function stop(ms) {
    stopped = true;
    let timer;
    await Promise.race([idle(), new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
    clearTimeout(timer);
    return !pool.going;
  }

  return { tick, pass, dispatch, stop, nextRun: () => nextDue, plan, sweep, request, adopt, pool, memory };
}
