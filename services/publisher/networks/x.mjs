// Posts to the member's own X account through the X API v2: the words, with
// the post's video or up to 4 of its pictures, uploaded in 5 MB chunks. X
// processes a video after the upload, so a post with one is `processing`
// until X has it ready; then publish makes the post, after the publisher has
// claimed the row, so it's made once only. X bills plan.video for every
// post, and far more for one with a link, so only paid plans post to X, up to
// their plan's posts and links a month and 50 a day (xAllowed in plans.mjs).
// A thread's follow-ups are posts too, each a reply to the one before, and
// count the same.

import { PublishError } from "../errors.mjs";
import { captionOf } from "./text.mjs";

const MEDIA_URL = "https://api.x.com/2/media/upload";
const POSTS_URL = "https://api.x.com/2/tweets";
const TEXT_LIMIT = 25_000;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Pictures one post can carry. */
const MAX_PICTURES = 4;
const CHUNK = 5 * 1024 * 1024;
const PROCESSING_MS = 60 * 60_000;

export function explain(status, payload) {
  const error = typeof payload?.error === "string" ? payload.error : "";
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
  const message =
    typeof payload?.detail === "string"
      ? payload.detail
      : typeof first?.message === "string"
        ? first.message
        : typeof payload?.error_description === "string"
          ? payload.error_description
          : typeof payload?.title === "string"
            ? payload.title
            : "";
  if (status === 401 || error === "invalid_token" || error === "invalid_grant") return "X login expired. Connect the account again in Connections.";
  if (status === 402) return "plan.video can't post to X right now. Trying again later.";
  if (status === 429) return "X is limiting posts from this account for now. Trying again later.";
  if (/duplicate/i.test(message)) return "X already has this post.";
  if (status === 403 && !message) return "X didn't let plan.video post for this account. Disconnect it in Connections and connect it again.";
  if (message && message.length < 300 && !/secret|bearer|client_secret/i.test(message)) return message;
  return "X refused the request.";
}

async function call(url, accessToken, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers },
    signal: AbortSignal.timeout(init.timeout ?? 30_000),
  }).catch(() => null);
  if (!response) throw new PublishError("Couldn't reach X. Trying again soon.", { retry: true });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PublishError(explain(response.status, payload), { retry: response.status >= 500 || response.status === 429 || response.status === 402, expired: response.status === 401 });
  }
  return payload;
}

/** Where X is with an upload: ready, still working on it, or turned down. */
function processing(info) {
  if (!info || info.state === "succeeded") return "ready";
  if (info.state === "failed") {
    const message = typeof info.error?.message === "string" ? info.error.message : "";
    throw new PublishError(message && message.length < 300 ? `X couldn't process this file: ${message}` : "X couldn't process this file.");
  }
  return "processing";
}

/** Makes the post, as a reply when `replyTo` names one. When X's answer is lost, it may have made it anyway, so that's never tried again on its own. */
async function makePost(session, text, mediaIds = [], replyTo = null) {
  const payload = await call(POSTS_URL, session.accessToken, {
    method: "POST",
    body: JSON.stringify({
      ...(text ? { text } : {}),
      ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
      ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
    }),
  }).catch((error) => {
    if (error instanceof PublishError && error.retry && !/limiting|can't post/.test(error.message)) {
      throw new PublishError("X didn't confirm the post. Check your X profile, and post it again if it isn't there.");
    }
    throw error;
  });
  const id = payload?.data?.id;
  if (typeof id !== "string" || !id) throw new PublishError("X took the post but didn't say where it is.");
  return { state: "sent", publishId: id, url: `https://x.com/i/status/${id}` };
}

/** Uploads one file in 5 MB chunks. Says whether X has it ready, or is still working on it. */
async function upload(session, media, file) {
  const max = file.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > max) throw new PublishError(file.kind === "video" ? "That video is too large for X. It can be 1 GB." : "A picture is too large for X. Each can be 5 MB.");
  const started = await call(`${MEDIA_URL}/initialize`, session.accessToken, {
    method: "POST",
    body: JSON.stringify({ media_type: file.type, total_bytes: file.size, media_category: file.kind === "video" ? "tweet_video" : "tweet_image" }),
  });
  const mediaId = started?.data?.id;
  if (typeof mediaId !== "string" || !/^\d{1,30}$/.test(mediaId)) throw new PublishError("X didn't start the upload. Trying again soon.", { retry: true });

  for (let offset = 0, segment = 0; offset < file.size; offset += CHUNK, segment++) {
    const bytes = await media.bytes(file.key, offset, Math.min(offset + CHUNK, file.size) - 1);
    const form = new FormData();
    form.set("segment_index", String(segment));
    form.set("media", new Blob([bytes]), "chunk");
    await call(`${MEDIA_URL}/${mediaId}/append`, session.accessToken, { method: "POST", body: form, timeout: 120_000 });
  }
  const finished = await call(`${MEDIA_URL}/${mediaId}/finalize`, session.accessToken, { method: "POST" });
  return { mediaId, ready: processing(finished?.data?.processing_info) === "ready" };
}

/** Endings of files and code that look like a web address but aren't one, as "Next.js" or "notes.md". */
const NOT_DOMAINS = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "rs", "go", "md", "txt", "json", "yml", "yaml", "toml", "css", "html", "htm", "php", "sh", "exe", "zip", "png", "jpg", "jpeg", "gif", "webp", "svg", "mp3", "mp4", "mov", "wav", "pdf", "doc", "docx", "csv"]);
const ADDRESS = /(?:^|[^\p{L}\p{N}_@#$.-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(\p{L}{2,24}|xn--[a-z0-9-]+))(?=$|[/?#:]|[^\p{L}\p{N}_-])/gu;

/**
 * Whether X reads a link in the words, which it bills at $0.20 rather than
 * $0.015. It errs towards yes: an address with https:// or www., or a name
 * with a dot and letters after it, as plan.video, counts, unless the letters
 * end a file's name.
 */
export function hasLink(text) {
  if (/(?:https?:\/\/|\bwww\.)\S/iu.test(text)) return true;
  for (const [, , ending] of text.matchAll(ADDRESS)) if (!NOT_DOMAINS.has(ending.toLowerCase())) return true;
  return false;
}

/** The words a post goes out with on X. */
const textOf = (post) => [...captionOf(post, "x").trim()].slice(0, TEXT_LIMIT).join("");

/** The uploads a send left on the row, which X may still be working on. */
const uploads = (delivery) => String(delivery.publish_id ?? "").split(",").filter((id) => /^\d{1,30}$/.test(id));

/** A follow-up's uploads X is still working on, as its row keeps them: `media:<when started>:<id>,<id>`. */
const PENDING = /^media:(\d{1,15}):(\d{1,30}(?:,\d{1,30}){0,3})$/;

/**
 * X for paid plans, up to what their plan allows. `limits` is plans.mjs's:
 * it says whether the owner has a post left, and counts the ones X makes.
 */
export function createX({ limits, log = console }) {
  /** The last post started for each owner, which the next waits for, so two at once can't both take the last one left. */
  const turns = new Map();

  /** Makes the post once the owner's plan has room for it, then counts it. One X may have made without saying so counts too. */
  function makeWithin(userId, session, text, mediaIds, replyTo = null) {
    const link = hasLink(text);
    const run = async () => {
      await limits.xAllowed(userId, link);
      const count = () => limits.countX(userId, link).catch((error) => log.error("[publisher] couldn't count an X post", error instanceof Error ? error.message : error));
      try {
        const result = await makePost(session, text, mediaIds, replyTo);
        await count();
        return result;
      } catch (error) {
        if (error instanceof PublishError && /didn't confirm|didn't say where/.test(error.message)) await count();
        throw error;
      }
    };
    const turn = (turns.get(userId) ?? Promise.resolve()).then(run, run);
    const settled = turn.catch(() => undefined);
    turns.set(userId, settled);
    void settled.then(() => turns.get(userId) === settled && turns.delete(userId));
    return turn;
  }

  return {
    needsFile: false,

    /** About the memory an upload holds (pool.mjs): a piece of a file at a time, read whole, copied into the form, and sent. */
    holds: (files) => (files.length ? 3 * CHUNK : 0),

    /** Posts the words with the post's video, or up to 4 of its pictures. */
    async send({ post, session, files, media, delivery }) {
      const text = textOf(post);
      // Asked before anything is uploaded too, so a post that can't go doesn't send its video for nothing.
      await limits.xAllowed(delivery.user_id, hasLink(text));
      const video = files.find((file) => file.kind === "video");
      const chosen = video ? [video] : files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
      if (!chosen.length) {
        if (!text) throw new PublishError("Write something for X, or attach a video or picture.");
        return makeWithin(delivery.user_id, session, text, []);
      }
      const uploaded = [];
      for (const file of chosen) uploaded.push(await upload(session, media, file));
      const ids = uploaded.map((item) => item.mediaId);
      if (uploaded.every((item) => item.ready)) return makeWithin(delivery.user_id, session, text, ids);
      return { state: "processing", publishId: ids.join(",") };
    },

    /** Whether X has the files ready. Only asks: the post is made in publish. */
    async check({ session, delivery }) {
      for (const id of uploads(delivery)) {
        const payload = await call(`${MEDIA_URL}?command=STATUS&media_id=${id}`, session.accessToken);
        if (processing(payload?.data?.processing_info) === "ready") continue;
        if (Date.now() - Date.parse(delivery.updated_at) > PROCESSING_MS) throw new PublishError("X didn't finish processing the video. Try again.");
        return { state: "processing", publishId: delivery.publish_id };
      }
      return { state: "ready" };
    },

    /** Makes the post with the files, once check finds them ready. */
    async publish({ post, session, delivery }) {
      return makeWithin(delivery.user_id, session, textOf(post), uploads(delivery));
    },

    /** A follow-up's pictures or video go with it. */
    replyMedia: true,

    /**
     * Posts a follow-up of the post's thread, as a reply to the one before,
     * with its video or up to 4 pictures. A video X is still processing is
     * `processing`, and `pending` brings it back on the next look, so the
     * reply is made once X has it ready.
     */
    async reply({ session, text, parent, delivery, files = [], media, pending }) {
      if (!/^\d{1,30}$/.test(parent)) throw new PublishError("X didn't say where the post before this follow-up is.");
      const words = [...text.trim()].slice(0, TEXT_LIMIT).join("");
      const waiting = PENDING.exec(pending ?? "");
      if (waiting) {
        const ids = waiting[2].split(",");
        for (const id of ids) {
          const payload = await call(`${MEDIA_URL}?command=STATUS&media_id=${id}`, session.accessToken);
          if (processing(payload?.data?.processing_info) === "ready") continue;
          if (Date.now() - Number(waiting[1]) > PROCESSING_MS) throw new PublishError("X didn't finish processing the follow-up's video.");
          return { state: "processing", publishId: pending };
        }
        return makeWithin(delivery.user_id, session, words, ids, parent);
      }
      const video = files.find((file) => file.kind === "video");
      const chosen = video ? [video] : files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
      if (!chosen.length) {
        if (!words) throw new PublishError("This follow-up has nothing X can post.");
        return makeWithin(delivery.user_id, session, words, [], parent);
      }
      // Asked before anything is uploaded, so a follow-up that can't go doesn't send its files for nothing.
      await limits.xAllowed(delivery.user_id, hasLink(words));
      const uploaded = [];
      for (const file of chosen) uploaded.push(await upload(session, media, file));
      const ids = uploaded.map((item) => item.mediaId);
      if (uploaded.every((item) => item.ready)) return makeWithin(delivery.user_id, session, words, ids, parent);
      return { state: "processing", publishId: `media:${Date.now()}:${ids.join(",")}` };
    },
  };
}
