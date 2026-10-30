// A post's thread: the follow-ups saved on it (`post.thread`, set in New
// post) go out under it once it's sent, each its delay after the one before.
// X and Bluesky post each as a reply to the one before, with the pictures or
// video it carries; LinkedIn as a comment on the post, in words alone.
// Networks without `reply` get the post alone.
//
// Each follow-up has a post_replies row before it's sent, the way
// post_deliveries keeps the post itself, so none goes out twice. A row is made
// only once the one before it went out, so a follow-up that fails stops the
// ones after it. Its words are read from the post when it goes, so changes
// made while it waits reach it, and one taken off the thread meanwhile isn't
// sent.

import { PublishError } from "./errors.mjs";
import { zoneOrUtc } from "./schedule.mjs";

/** Follow-ups one post can have, as New post allows. */
export const MAX_REPLIES = 10;
/** Files one follow-up can carry: 4 pictures, or a video. */
const MAX_FILES = 4;
/** Without its files in cloud storage this long after it came due, a follow-up fails instead of waiting for the upload. */
const FILE_WAIT_MS = 30 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** The longest wait New post offers is a day; anything saved past a week is held to it. */
const MAX_DELAY_MS = 7 * 24 * 60 * 60_000;
/** Waits before the 2nd, 3rd and 4th try of a follow-up that may work later. */
const BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
/** A follow-up still marked as going after this was cut off, by a restart. */
const STALE_MS = 30 * 60_000;
const CHECK_EVERY_MS = 60_000;
const TABLE_CHECK_MS = 10 * 60_000;

const NAMES = { bluesky: "Bluesky", linkedin: "LinkedIn", x: "X" };

const delayOf = (minutes) => (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes * 60_000, MAX_DELAY_MS) : 0);

/**
 * A follow-up's files, by id. Only the post's own: `<post id>_<random>`, as
 * New post names them, so a thread can't name another post's files.
 */
function filesOf(post, reply) {
  if (!Array.isArray(reply?.files)) return [];
  const own = (id) => typeof id === "string" && ID.test(id) && id.startsWith(`${post.id}_`);
  return [...new Set(reply.files.filter(own))].slice(0, MAX_FILES);
}

/** The follow-ups a post goes out with, in order: the ones with words or files, each with its wait in milliseconds. */
export function threadOf(post) {
  const list = Array.isArray(post?.thread) ? post.thread : [];
  return list
    .map((reply) => ({ text: typeof reply?.text === "string" ? reply.text.trim() : "", delay: delayOf(reply?.delay), files: filesOf(post, reply) }))
    .filter((reply) => reply.text || reply.files.length)
    .slice(0, MAX_REPLIES);
}

/**
 * `postIn(owner, post, workspace)` is the worker's: the post as the account
 * has it now. `memory` is its memory gate (pool.mjs), for follow-ups that
 * hold their files in memory. Without post_replies in the database yet,
 * nothing is sent and the posts go out alone.
 */
export function createReplies({ db, vault, networks, media, notices, postIn, memory, now = () => Date.now(), log = console }) {
  const iso = (time) => new Date(time).toISOString();
  let missingTable = false;
  let missingAt = 0;

  /** Whether the database turned away post_replies because it isn't there yet. Said once in the log. */
  function noTable(error) {
    if (!/PGRST205|42P01/.test(String(error?.message))) return false;
    if (!missingTable) log.warn("[publisher] post_replies isn't in the database yet, so threads aren't sent. Apply 20261025120000_post_replies.sql.");
    missingTable = true;
    missingAt = now();
    return true;
  }

  /** Makes the row of one follow-up, due `delay` from now. */
  async function queue(delivery, step, delay) {
    await db.insertNew(
      "post_replies",
      [
        {
          delivery_id: delivery.id,
          user_id: delivery.user_id,
          post_id: delivery.post_id,
          platform: delivery.platform,
          connection_id: delivery.connection_id,
          step,
          state: "queued",
          next_at: iso(now() + delay),
          // By this clock, which the wait for its files counts from.
          created_at: iso(now()),
        },
      ],
      "delivery_id,step",
    );
  }

  /** Once a post is sent, its first follow-up waits for its time. `delivery` is its row, as sent. */
  async function start(delivery, post) {
    if (!networks[delivery.platform]?.reply || !delivery.publish_id) return;
    const [first] = threadOf(post);
    if (!first) return;
    try {
      await queue(delivery, 0, first.delay);
    } catch (error) {
      if (!noTable(error)) log.error("[publisher] couldn't queue a follow-up", delivery.id, error instanceof Error ? error.message : error);
    }
  }

  const settle = (row, values) => db.update("post_replies", { id: row.id }, { ...values, updated_at: iso(now()) });

  async function failed(row, error, { post, zone, delivery } = {}) {
    const message = error instanceof PublishError ? error.message : "Something went wrong on plan.video's side. Trying again soon.";
    const retry = !(error instanceof PublishError) || error.retry;
    if (!(error instanceof PublishError)) log.error("[publisher] follow-up failed", row.id, error);
    if (retry && row.attempts < MAX_ATTEMPTS) {
      await settle(row, { state: "queued", error: message, next_at: iso(now() + BACKOFF_MS[row.attempts - 1]) });
      return;
    }
    await settle(row, { state: "failed", error: message });
    const said = error instanceof PublishError ? message : "Something went wrong on plan.video's side.";
    await notices
      ?.failed(
        { ...row, requested: false, due_at: delivery?.due_at ?? row.created_at },
        { post, zone, reply: true, message: `Follow-up ${row.step + 1} of the thread didn't go out on ${NAMES[row.platform] ?? row.platform}. ${said}` },
      )
      .catch((problem) => log.error("[publisher] couldn't note a failed follow-up", row.id, problem instanceof Error ? problem.message : problem));
  }

  async function sendOne(row) {
    // Claimed by matching its state and time, so no other loop takes it too.
    const [claimed] = await db.update("post_replies", { id: row.id, state: "queued", next_at: row.next_at }, { state: "sending", attempts: row.attempts + 1, updated_at: iso(now()) });
    if (!claimed) return;
    let post = null;
    let zone;
    let delivery = null;
    let thread = [];
    let result;
    try {
      delivery = await db.selectOne("post_deliveries", { id: row.delivery_id });
      if (!delivery?.publish_id || delivery.state !== "sent") throw new PublishError("The post didn't go out, so its thread didn't either.");
      const [found] = await postIn(row.user_id, row.post_id, delivery.workspace_id);
      post = found?.post ?? null;
      zone = zoneOrUtc(post?.timeZone ?? found?.time_zone);
      thread = threadOf(post);
      const reply = thread[row.step];
      // Deleted, taken off the network, or the follow-up taken off the thread while it waited: it's dropped without a word.
      if (!post || !post.platforms?.includes(row.platform) || !reply) {
        await db.delete("post_replies", { id: row.id });
        return;
      }
      const parent = row.step === 0 ? delivery.publish_id : (await db.selectOne("post_replies", { delivery_id: row.delivery_id, step: row.step - 1 }))?.publish_id;
      if (!parent) throw new PublishError("The follow-up before it didn't go out.");
      const network = networks[row.platform];
      // Its files, on a network that posts them. One the network is still working on from an earlier try isn't fetched again.
      const pending = claimed.publish_id || null;
      let files = [];
      if (network.replyMedia && reply.files.length && !pending) {
        files = (await Promise.all(reply.files.map((id) => media.postFile(row.user_id, id)))).filter(Boolean);
        if (files.length < reply.files.length) {
          if (now() - (Date.parse(claimed.created_at) + reply.delay) >= FILE_WAIT_MS) {
            throw new PublishError("The follow-up's media never reached plan.video's storage. Open plan.video in the browser it was made in, then post it there yourself.");
          }
          // Not a try, since the files are on their way.
          await settle(claimed, { state: "queued", attempts: row.attempts, error: "The follow-up's media is still uploading to plan.video.", next_at: iso(now() + CHECK_EVERY_MS) });
          return;
        }
      }
      const login = await vault.fresh(row.user_id, row.connection_id);
      const release = (await memory?.hold(network.holds?.(files) ?? 0)) ?? (() => {});
      try {
        result = await network.reply({ session: login.session, text: reply.text, root: delivery.publish_id, parent, delivery, files, media, pending });
      } finally {
        release();
      }
      if (result.state === "processing") {
        // The network is still working on the files: it looks again in a minute, and that wasn't a try.
        await settle(claimed, { state: "queued", attempts: row.attempts, publish_id: result.publishId, error: null, next_at: iso(now() + CHECK_EVERY_MS) });
        return;
      }
    } catch (error) {
      // A limit that frees up later, like X's posts a day: it waits for then, and that wasn't a try.
      if (error instanceof PublishError && error.until) {
        await settle(claimed, { state: "queued", attempts: row.attempts, error: error.message, next_at: iso(Math.max(error.until, now() + CHECK_EVERY_MS)) });
        return;
      }
      await failed(claimed, error, { post, zone, delivery });
      return;
    }
    // The network has it now. If keeping that fails, the row stays as sending and is later marked cut off, rather than sent again.
    try {
      await settle(claimed, { state: "sent", publish_id: result.publishId ?? null, url: result.url ?? null, error: result.note ?? null });
      const next = thread[row.step + 1];
      if (next) await queue(delivery, row.step + 1, next.delay);
    } catch (error) {
      log.error("[publisher] couldn't keep a sent follow-up", claimed.id, error instanceof Error ? error.message : error);
    }
  }

  /** Without the table, it's asked again every few minutes, in case it's been added since. */
  const away = () => missingTable && now() - missingAt < TABLE_CHECK_MS;

  /** Follow-ups cut off by a restart fail, as they may have gone out. The ones in `going` are still being sent. */
  async function housekeep(going) {
    if (away()) return;
    try {
      await db.abandonStaleReplies(iso(now() - STALE_MS), iso(now()), going);
    } catch (error) {
      if (!noTable(error)) throw error;
    }
  }

  /** Up to `limit` follow-ups due now, oldest first, leaving out `skip`'s people and lanes (pool.mjs). */
  async function due(limit, skip) {
    if (away()) return [];
    try {
      const rows = await db.repliesDue(iso(now()), limit, skip);
      missingTable = false;
      return rows;
    } catch (error) {
      if (noTable(error)) return [];
      throw error;
    }
  }

  return { start, housekeep, due, sendOne };
}
