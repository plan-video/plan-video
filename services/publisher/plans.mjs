// What each plan allows, checked where posts go out, so someone who writes
// their account straight to the database gets no more than the dashboard
// gives them. These follow apps/web/src/lib/plans.ts:
//
//   - On Free, each account has at most 10 scheduled posts waiting at a time
//     (overScheduledLimit in components/calendar/store.ts). The publisher
//     remembers each post it sees waiting on an account, in
//     publisher_waiting. One that comes in while its account already has 10
//     waiting is over, and its runs fail instead of going out. Like the
//     dashboard, a post already waiting stays allowed after a plan gets
//     smaller, and Post now always works.
//   - YouTube uploads all come out of one daily quota for the app, so each
//     owner gets a share of it by plan, counted in publisher_uploads.
//   - X bills plan.video for every post it makes: $0.015 for one, $0.20 for
//     one with a link. So Free doesn't post to X, and each paid owner makes
//     at most so many in any 30 days, far fewer of them with a link, and 50
//     in a day. Each post X makes is counted in publisher_uploads as "x",
//     and once more as "xlink" when it has a link.

import { PublishError } from "./errors.mjs";
import { dayAt, isDayKey, momentOf, shiftDay, zoneOrUtc } from "./schedule.mjs";

/** Scheduled posts each account can have waiting on the Free plan. Paid plans have no limit. */
export const FREE_SCHEDULED_PER_ACCOUNT = 10;
/** A post due sooner than this is going out, not waiting, as the dashboard counts it. */
export const GOING_OUT_MS = 5 * 60_000;
/** YouTube videos an owner can upload in a day, by access level: Free, Creator, Pro, Agency. YOUTUBE_UPLOADS_PER_DAY in publisher.env sets others. */
export const YOUTUBE_UPLOADS_BY_LEVEL = { 1: 3, 2: 10, 3: 20, 4: 40 };
/**
 * Posts to X an owner can make in any 30 days, by access level, and how many
 * of those can have a link. At X's prices the most a month can cost is about
 * $4 on Creator, $11 on Pro and $19 on Agency. X_POSTS_PER_MONTH and
 * X_LINK_POSTS_PER_MONTH in publisher.env set others. apps/web/src/lib/plans.ts
 * sells the same numbers.
 */
export const X_POSTS_BY_LEVEL = { 1: 0, 2: 150, 3: 400, 4: 800 };
export const X_LINK_POSTS_BY_LEVEL = { 1: 0, 2: 10, 3: 25, 4: 40 };
/** Posts to X an owner can make in a day, whatever their plan. */
export const X_POSTS_PER_DAY = 50;
const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = 30 * DAY_MS;
/** The most any of the counts above can be: rows are counted by reading them, and PostgREST answers with up to 1000. */
const MOST_COUNTED = 1000;
/** Rows read at a time, under PostgREST's cap on rows per answer. */
const PAGE = 500;

export const OVER_SCHEDULED = `On the Free plan, each account can have ${FREE_SCHEDULED_PER_ACCOUNT} scheduled posts waiting at a time, so this one wasn't sent. Upgrade for unlimited posts, or post it now.`;

/** A plan's access level, 1 (Free) to 4 (Agency), from user_data.access_level. */
export const levelOf = (value) => Math.min(4, Math.max(1, Math.trunc(Number(value)) || 1));

/** Numbers by level, from "3,10,20,40"; any number missing or unreadable keeps its default from `defaults`. */
export function byLevel(text, defaults) {
  const parts = String(text ?? "").split(",");
  return Object.fromEntries(
    Object.entries(defaults).map(([level, most], index) => {
      const given = Number.parseInt(parts[index] ?? "", 10);
      return [level, Math.min(MOST_COUNTED, Number.isFinite(given) && given >= 0 ? given : most)];
    }),
  );
}

/** Uploads a day by level, from "3,10,20,40". */
export const uploadsPerDay = (text) => byLevel(text, YOUTUBE_UPLOADS_BY_LEVEL);

/** Whole days, at least 1, until the oldest of `rows` (oldest first) is older than `span`, so one more fits. */
const daysUntilFree = (rows, span, at) => Math.max(1, Math.ceil((Date.parse(rows[0]?.at ?? "") + span - at) / DAY_MS) || 1);

const inDays = (days) => (days === 1 ? "tomorrow" : `in ${days} days`);

/** When a post first goes out, or null when it has no day and time the publisher reads. */
export function startOf(post, accountZone) {
  const time = post?.allDay ? "00:00" : post?.start;
  // Strings first: test() reads an array like ["2026-10-27"] as its text, and momentOf would then throw.
  if (typeof post?.day !== "string" || typeof time !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return momentOf(post.day, time, zoneOrUtc(post.timeZone ?? accountZone));
}

/** Whether a post waits to go out: scheduled, not paused, and with a run still to come. A repeating post counts once. */
export function isWaiting(post, accountZone, at) {
  if (post?.status !== "scheduled" || post.paused) return false;
  // Only a real day ends a series: the schedule ignores any other end, so the post would still go out forever.
  if (post.recurrence) return !(isDayKey(post.recurrenceEnd) && post.recurrenceEnd < dayAt(at, zoneOrUtc(post.timeZone ?? accountZone)));
  const start = startOf(post, accountZone);
  return start !== null && start >= at + GOING_OUT_MS;
}

/**
 * Until when a post waits, if it's scheduled and not paused: a one-off until
 * it's about to go out, a series through its last day in its zone, or for
 * ever (null) while a series has no end. Waiting at a moment means at or
 * before this; it agrees with isWaiting.
 */
export function waitingUntil(post, accountZone) {
  if (post?.recurrence) {
    if (!isDayKey(post.recurrenceEnd)) return null;
    return momentOf(shiftDay(post.recurrenceEnd, 1), "00:00", zoneOrUtc(post.timeZone ?? accountZone)) - 1;
  }
  const start = startOf(post, accountZone);
  return start === null ? 0 : start - GOING_OUT_MS;
}

export function createPlanLimits({ db, now = () => Date.now(), log = console, youtube = YOUTUBE_UPLOADS_BY_LEVEL, x = { posts: X_POSTS_BY_LEVEL, links: X_LINK_POSTS_BY_LEVEL } }) {
  /** publisher_waiting as the publisher last left it, by key, or null until it's read. Only the publisher writes it. */
  let known = null;
  const keyOf = (row) => `${row.user_id}|${row.workspace_id}|${row.post_id}|${row.connection_id}`;
  const accountOf = (row) => `${row.user_id}|${row.workspace_id}|${row.connection_id}`;
  const postOf = (row) => `${row.user_id}|${row.workspace_id}|${row.post_id}`;
  const iso = (time) => (time === null ? null : new Date(time).toISOString());
  /** A publisher_waiting row as kept here: its times as numbers, `seenAt` when it was first kept. */
  const keptRow = ({ until, seen_at: seen, ...row }) => ({ ...row, until: until ? Date.parse(until) : null, seenAt: seen ? Date.parse(seen) : 0 });

  async function readKnown() {
    const rows = new Map();
    for (let offset = 0; ; offset += PAGE) {
      const page = await db.select("publisher_waiting", {}, "user_id,workspace_id,post_id,connection_id,over,until,seen_at", `&order=user_id,workspace_id,post_id,connection_id&limit=${PAGE}&offset=${offset}`);
      for (const row of page) rows.set(keyOf(row), keptRow(row));
      if (page.length < PAGE) return rows;
    }
  }

  /** Each person's plan level. Someone with no plan row is on Free. */
  async function levels(ids) {
    const found = new Map(ids.map((id) => [id, 1]));
    for (let index = 0; index < ids.length; index += 100) {
      for (const row of await db.select("user_data", { id: ids.slice(index, index + 100) }, "id,access_level")) found.set(row.id, levelOf(row.access_level));
    }
    return found;
  }

  /**
   * Takes in scheduled posts as they are now, as one entry per post and
   * account it goes out from: `{ user_id, workspace_id, post_id,
   * connection_id, waiting, until, start }`. One newly waiting on a Free
   * account that already has 10 waiting is over. Anything no longer scheduled
   * on its account is forgotten, so it's looked at afresh if it comes back.
   *
   * With `posts` (keys `user|workspace|post`), only those posts were looked
   * at: the others are counted as they were last seen, waiting until their
   * `until`. Without it, `entries` is every scheduled post there was when they
   * were read, at `readAt`: a post kept since then, by a look that ran
   * meanwhile, isn't taken as gone.
   */
  /** What keeps `known` takes turns, so two at once can't both count 9 waiting and both let a 10th in. */
  let turn = Promise.resolve();
  const alone = (work) => {
    const run = turn.then(work, work);
    turn = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const review = (entries, options) => alone(() => reviewNow(entries, options));

  async function reviewNow(entries, { posts, readAt = Infinity } = {}) {
    try {
      known ??= await readKnown();
      const at = now();
      const level = await levels([...new Set(entries.map((entry) => entry.user_id))]);
      const listed = new Map(entries.map((entry) => [keyOf(entry), entry]));
      const looked = (row) => (posts ? posts.has(postOf(row)) : row.seenAt < readAt);

      const gone = new Map();
      for (const [key, row] of known) {
        if (listed.has(key) || !looked(row)) continue;
        const post = `${row.user_id}|${row.workspace_id}|${row.post_id}`;
        gone.set(post, [...(gone.get(post) ?? []), row]);
      }
      for (const rows of gone.values()) {
        const [{ user_id, workspace_id, post_id }] = rows;
        await db.delete("publisher_waiting", { user_id, workspace_id, post_id, connection_id: rows.map((row) => row.connection_id) });
        for (const row of rows) known.delete(keyOf(row));
      }

      // A post kept since it arrived waits as long as it says now, or, when it wasn't looked at, until when it said last. Kept in one write.
      const moved = [];
      for (const entry of entries) {
        const row = known.get(keyOf(entry));
        if (!row || row.until === (entry.until ?? null)) continue;
        moved.push({ row, until: entry.until ?? null });
      }
      if (moved.length) {
        await db.upsert(
          "publisher_waiting",
          moved.map(({ row, until }) => ({ user_id: row.user_id, workspace_id: row.workspace_id, post_id: row.post_id, connection_id: row.connection_id, over: row.over, until: iso(until) })),
          "user_id,workspace_id,post_id,connection_id",
        );
        for (const { row, until } of moved) row.until = until;
      }

      const waiting = new Map();
      for (const row of known.values()) {
        if (row.over !== false) continue;
        const entry = listed.get(keyOf(row));
        const still = entry ? entry.waiting : row.until === null || at <= row.until;
        if (still) waiting.set(accountOf(row), (waiting.get(accountOf(row)) ?? 0) + 1);
      }
      // Several new at once, from two tabs or a write to the database: the soonest come first.
      const arrivals = entries
        .filter((entry) => entry.waiting && !known.has(keyOf(entry)))
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || a.post_id.localeCompare(b.post_id));
      const rows = [];
      for (const entry of arrivals) {
        const count = waiting.get(accountOf(entry)) ?? 0;
        const over = level.get(entry.user_id) <= 1 && count >= FREE_SCHEDULED_PER_ACCOUNT;
        if (!over) waiting.set(accountOf(entry), count + 1);
        rows.push({ user_id: entry.user_id, workspace_id: entry.workspace_id, post_id: entry.post_id, connection_id: entry.connection_id, over, until: iso(entry.until ?? null) });
      }
      if (rows.length) {
        await db.insertNew("publisher_waiting", rows, "user_id,workspace_id,post_id,connection_id");
        for (const row of rows) known.set(keyOf(row), { ...keptRow(row), seenAt: at });
      }
    } catch (error) {
      // Read again next time, rather than judge by a copy that may be out of step.
      known = null;
      log.error("[publisher] couldn't check scheduled posts against plans", error instanceof Error ? error.message : error);
    }
  }

  /**
   * The owners who had posts over the Free limit and pay now: their posts
   * aren't over any more, and the worker looks at them again so their runs go
   * out after all. Asked every pass; costs nothing while nobody is over.
   */
  const upgraded = () => alone(upgradedNow);

  async function upgradedNow() {
    try {
      known ??= await readKnown();
      const owners = [...new Set([...known.values()].filter((row) => row.over).map((row) => row.user_id))];
      if (!owners.length) return [];
      const level = await levels(owners);
      const paying = owners.filter((userId) => level.get(userId) > 1);
      for (const userId of paying) {
        await db.update("publisher_waiting", { user_id: userId, over: true }, { over: false });
        for (const row of known.values()) if (row.user_id === userId) row.over = false;
      }
      return paying;
    } catch (error) {
      known = null;
      log.error("[publisher] couldn't check plans of posts over the limit", error instanceof Error ? error.message : error);
      return [];
    }
  }

  /** Whether a post came in over its account's limit. */
  const over = (userId, workspaceId, postId, connectionId) => known?.get(keyOf({ user_id: userId, workspace_id: workspaceId, post_id: postId, connection_id: connectionId }))?.over === true;

  /**
   * Whether the owner has a YouTube upload left today. Returns null when one
   * may start, or when it waits: `{ most, until }`, the moment the oldest of
   * their last day's uploads stops counting. Nothing is taken here: an
   * upload counts once YouTube starts it (countUpload), so a try that fails
   * before then costs nothing.
   */
  async function uploadWait(userId, platform) {
    let most;
    let recent;
    try {
      most = youtube[(await levels([userId])).get(userId)];
      recent = await db.uploadsSince(userId, platform, new Date(now() - DAY_MS).toISOString(), most);
    } catch (error) {
      if (!(error instanceof PublishError) || error.retry) throw error;
      // A database without publisher_uploads yet: the upload goes, as it did before.
      log.error("[publisher] couldn't count uploads", error.message);
      return null;
    }
    if (recent.length >= most) return { most, until: Date.parse(recent[0]?.at ?? "") + DAY_MS || now() + DAY_MS };
    return null;
  }

  /** Counts one of the owner's uploads for today, once YouTube has started it. */
  async function countUpload(userId, platform) {
    await db.insert("publisher_uploads", [{ user_id: userId, platform, at: new Date(now()).toISOString() }]);
  }

  /**
   * Throws why the owner can't have X make a post now, `link` saying whether
   * it has one: on Free, or past their plan's posts in 30 days, or links
   * among them. Those fail the post. Past 50 today it waits instead: the
   * error's `until` is when one frees up. A count that can't be read stops
   * the post too, since X bills for it either way.
   */
  async function xAllowed(userId, link) {
    const level = (await levels([userId])).get(userId);
    const most = x.posts[level] ?? 0;
    if (level <= 1 || !most) throw new PublishError("Posting to X needs a paid plan. Upgrade, then post it again.");
    const at = now();
    const since = new Date(at - MONTH_MS).toISOString();
    const month = await db.uploadsSince(userId, "x", since, most);
    if (month.length >= most) {
      throw new PublishError(`Your plan posts to X up to ${most} times in 30 days, and they're used, so this one wasn't sent. More free up ${inDays(daysUntilFree(month, MONTH_MS, at))}: post it again then, or upgrade for more.`);
    }
    if (link) {
      const mostLinks = x.links[level] ?? 0;
      if (!mostLinks) throw new PublishError("Your plan doesn't post links to X, so this one wasn't sent. Take the link out, then post it again.");
      const links = await db.uploadsSince(userId, "xlink", since, mostLinks);
      if (links.length >= mostLinks) {
        throw new PublishError(
          `Your plan posts up to ${mostLinks} X posts with a link in 30 days, since X charges far more for those, and they're used, so this one wasn't sent. Take the link out and post it again, or post it ${inDays(daysUntilFree(links, MONTH_MS, at))}.`,
        );
      }
    }
    // All of the month's are here, oldest first, since there are fewer than the most read.
    const today = month.filter((row) => Date.parse(row.at) >= at - DAY_MS);
    if (today.length >= X_POSTS_PER_DAY) {
      throw new PublishError(`plan.video posts to X up to ${X_POSTS_PER_DAY} times a day, and today's are used. This one goes out on its own once one frees up.`, {
        retry: true,
        until: Date.parse(today[0].at) + DAY_MS,
      });
    }
  }

  /** Counts a post X made for the owner, and once more when it has a link. */
  async function countX(userId, link) {
    const at = new Date(now()).toISOString();
    await db.insert("publisher_uploads", [{ user_id: userId, platform: "x", at }, ...(link ? [{ user_id: userId, platform: "xlink", at }] : [])]);
  }

  /** Drops counted uploads that no longer count: YouTube's after two days, X's after 31. */
  async function prune() {
    await db.pruneUploads(new Date(now() - 2 * DAY_MS).toISOString(), ["youtube"]);
    await db.pruneUploads(new Date(now() - MONTH_MS - DAY_MS).toISOString(), ["x", "xlink"]);
  }

  return { review, upgraded, over, uploadWait, countUpload, xAllowed, countX, prune };
}
