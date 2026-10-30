import { PublishError } from "../errors.mjs";
import { isBlueskyServer, pdsFetch } from "../pds-fetch.mjs";
import { captionOf, graphemes } from "./text.mjs";

export const BLUESKY_TEXT_LIMIT = 300;
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_PICTURES = 4;
const APPVIEW = "https://public.api.bsky.app";

function explain(problem, fallback, ownWords = true) {
  const code = problem?.error ?? "";
  if (code === "ExpiredToken" || code === "InvalidToken") return "Bluesky login expired. Connect the account again in Connections.";
  if (code === "AccountTakedown" || code === "AccountDeactivated") return "This Bluesky account can't post right now.";
  if (code === "RateLimitExceeded") return "Bluesky is limiting posts from this account. Trying again soon.";
  if (code === "BlobTooLarge") return "That file is too large for Bluesky.";
  const message = problem?.message;
  return ownWords && typeof message === "string" && message && message.length < 300 ? message : fallback;
}

let oauth = null;

export function useBlueskyOAuth(client) {
  oauth = client;
}

async function transport(session) {
  if (session.oauth) {
    if (!oauth) throw new PublishError("Sign in with Bluesky isn't set up on the server yet.", { retry: true });
    return oauth.sender(session.owner, session.did);
  }
  return (method, init) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.accessJwt}`);
    return pdsFetch(session.pds, method, { ...init, headers });
  };
}

export async function sender(session) {
  const send = await transport(session);
  // Another server's own words could be anything it was sent to, so only Bluesky's are shown.
  const ownWords = !!session.oauth || isBlueskyServer(session.pds);
  return async (method, init = {}, fallback = "Bluesky refused the request.") => {
    const response = await send(method, init).catch(() => null);
    if (!response) throw new PublishError("Couldn't reach Bluesky. Trying again soon.", { retry: true });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.error ?? "";
      throw new PublishError(explain(payload, fallback, ownWords), {
        // use_dpop_nonce: the server asked for a fresh proof, which the next try brings.
        retry: response.status >= 500 || code === "RateLimitExceeded" || code === "use_dpop_nonce",
        expired: code === "ExpiredToken" || code === "InvalidToken",
      });
    }
    if (!payload) throw new PublishError("Bluesky sent an empty reply. Trying again soon.", { retry: true });
    return payload;
  };
}

/** Links and hashtags in the text. Bluesky counts their places in UTF-8 bytes. */
export function facetsOf(text) {
  const byteAt = (index) => Buffer.byteLength(text.slice(0, index), "utf8");
  const facets = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g)) {
    const start = match.index ?? 0;
    facets.push({
      index: { byteStart: byteAt(start), byteEnd: byteAt(start + match[0].length) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: match[0] }],
    });
  }
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const start = (match.index ?? 0) + match[1].length;
    facets.push({
      index: { byteStart: byteAt(start), byteEnd: byteAt(start + 1 + match[2].length) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: match[2] }],
    });
  }
  return facets;
}

/** A picture under Bluesky's 1 MB, as a JPEG no wider or taller than 2000 pixels, with its size for the layout. */
async function preparedImage(bytes, type) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    if (bytes.length > MAX_IMAGE_BYTES) throw new PublishError("That picture is over Bluesky's 1 MB. Attach a smaller one.");
    return { bytes, type };
  }
  const meta = await sharp(bytes).metadata().catch(() => ({}));
  const aspectRatio = meta.width && meta.height ? { width: meta.width, height: meta.height } : undefined;
  if (bytes.length <= MAX_IMAGE_BYTES) return { bytes, type, aspectRatio };
  for (const side of [2000, 1600, 1200]) {
    for (const quality of [90, 80, 70]) {
      const out = await sharp(bytes).rotate().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      if (out.length <= MAX_IMAGE_BYTES) {
        const shrunk = await sharp(out).metadata();
        return { bytes: out, type: "image/jpeg", aspectRatio: shrunk.width && shrunk.height ? { width: shrunk.width, height: shrunk.height } : aspectRatio };
      }
    }
  }
  throw new PublishError("That picture is too large for Bluesky, even made smaller.");
}

const postUrl = (uri) => {
  const [, , did, , rkey] = uri.split("/");
  return `https://bsky.app/profile/${did}/post/${rkey}`;
};

async function embedOf(send, media, chosen) {
  const upload = async (file) => {
    // In memory, up to 100 MB, since a "Sign in with Bluesky" session may have to send it twice.
    const bytes = await media.bytes(file.key, 0, file.size - 1);
    const ready = file.kind === "image" ? await preparedImage(bytes, file.type) : { bytes, type: file.type, aspectRatio: undefined };
    const reply = await send(
      "com.atproto.repo.uploadBlob",
      { method: "POST", headers: { "Content-Type": ready.type || "application/octet-stream" }, body: ready.bytes },
      "Bluesky didn't take the file.",
    );
    return { blob: reply.blob, ...(ready.aspectRatio ? { aspectRatio: ready.aspectRatio } : {}) };
  };

  const video = chosen.find((file) => file.kind === "video");
  if (video) {
    const { blob, ...shape } = await upload(video);
    return { $type: "app.bsky.embed.video", video: blob, ...shape };
  }
  if (!chosen.length) return undefined;
  const images = [];
  for (const file of chosen) {
    const { blob, ...shape } = await upload(file);
    images.push({ image: blob, alt: "", ...shape });
  }
  return { $type: "app.bsky.embed.images", images };
}

export const bluesky = {
  needsFile: false,

  /** Memory (pool.mjs): each file read whole and sent as a copy; sharp shrinking a picture over 1 MB takes a few times its bytes. */
  holds(files) {
    const video = files.find((file) => file.kind === "video");
    const chosen = video ? [video] : files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
    return chosen.reduce((sum, file) => sum + (file.size || 0) * (file.kind === "image" && file.size > MAX_IMAGE_BYTES ? 6 : 2), 0);
  },

  async send({ post, session, files, media }) {
    const text = captionOf(post, "bluesky").trim();
    const video = files.find((file) => file.kind === "video");
    const chosen = video ? [video] : files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
    if (graphemes(text) > BLUESKY_TEXT_LIMIT) throw new PublishError(`Bluesky posts can be ${BLUESKY_TEXT_LIMIT} characters. Shorten the caption for Bluesky.`);
    if (!text && !chosen.length) throw new PublishError("Write something or attach a file for Bluesky.");
    if (video && video.size > MAX_VIDEO_BYTES) throw new PublishError("Bluesky takes videos up to 100 MB.");
    const send = await sender(session);
    const embed = await embedOf(send, media, chosen);

    const facets = facetsOf(text);
    const record = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
      ...(facets.length ? { facets } : {}),
      ...(embed ? { embed } : {}),
    };
    const reply = await send(
      "com.atproto.repo.createRecord",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }) },
      "Bluesky didn't take the post.",
    ).catch((error) => {
      // A lost answer may still have made the post, so it isn't tried again on its own.
      if (error instanceof PublishError && error.retry && !/limiting/.test(error.message)) {
        throw new PublishError("Bluesky didn't confirm the post. Check your profile, and post it again if it isn't there.");
      }
      throw error;
    });
    return { state: "sent", publishId: reply.uri, url: postUrl(reply.uri) };
  },

  replyMedia: true,

  /** `root` and `parent` are at:// addresses. */
  async reply({ session, text, root, parent, files = [], media }) {
    const body = text.trim();
    if (graphemes(body) > BLUESKY_TEXT_LIMIT) throw new PublishError(`A follow-up on Bluesky can be ${BLUESKY_TEXT_LIMIT} characters. Shorten it in the post's thread.`);
    const video = files.find((file) => file.kind === "video");
    const chosen = video ? [video] : files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
    if (!body && !chosen.length) throw new PublishError("This follow-up has nothing Bluesky can post.");
    if (video && video.size > MAX_VIDEO_BYTES) throw new PublishError("Bluesky takes videos up to 100 MB.");
    const send = await sender(session);
    /** A reply names the post's version (cid) along with its address. */
    const ref = async (uri) => {
      const [, , repo, collection, rkey] = uri.split("/");
      if (!repo || collection !== "app.bsky.feed.post" || !rkey) throw new PublishError("Bluesky didn't say where the post before this follow-up is.");
      const found = await send(
        `com.atproto.repo.getRecord?repo=${encodeURIComponent(repo)}&collection=${collection}&rkey=${encodeURIComponent(rkey)}`,
        {},
        "Bluesky couldn't find the post this follow-up goes under. It may have been deleted.",
      );
      if (typeof found.cid !== "string") throw new PublishError("Bluesky couldn't find the post this follow-up goes under. It may have been deleted.");
      return { uri, cid: found.cid };
    };
    const rootRef = await ref(root);
    const parentRef = parent === root ? rootRef : await ref(parent);
    const embed = await embedOf(send, media, chosen);
    const facets = facetsOf(body);
    const record = {
      $type: "app.bsky.feed.post",
      text: body,
      createdAt: new Date().toISOString(),
      ...(facets.length ? { facets } : {}),
      ...(embed ? { embed } : {}),
      reply: { root: rootRef, parent: parentRef },
    };
    const made = await send(
      "com.atproto.repo.createRecord",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }) },
      "Bluesky didn't take the follow-up.",
    ).catch((error) => {
      if (error instanceof PublishError && error.retry && !/limiting/.test(error.message)) {
        throw new PublishError("Bluesky didn't confirm the follow-up. Check the thread on your profile, and post it there if it isn't.");
      }
      throw error;
    });
    return { state: "sent", publishId: made.uri, url: postUrl(made.uri) };
  },
};

export async function postNow(uri) {
  const response = await fetch(`${APPVIEW}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) throw new PublishError("Couldn't reach Bluesky.", { retry: true });
  const post = (await response.json().catch(() => null))?.posts?.[0];
  return post ? { uri: post.uri, cid: post.cid, likes: post.likeCount ?? 0, root: post.record?.reply?.root } : null;
}

async function recentRecords(send, did, collection) {
  const reply = await send(`com.atproto.repo.listRecords?repo=${encodeURIComponent(did)}&collection=${collection}&limit=100`, {}, "Couldn't reach Bluesky.");
  return (reply.records ?? []).map((record) => record.value);
}

/** Unless the account already reposted it; says whether it reposted now. */
export async function repost(session, post) {
  const send = await sender(session);
  const reposts = await recentRecords(send, session.did, "app.bsky.feed.repost");
  if (reposts.some((item) => item.subject?.uri === post.uri)) return false;
  await send("com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.repost",
      record: { $type: "app.bsky.feed.repost", subject: { uri: post.uri, cid: post.cid }, createdAt: new Date().toISOString() },
    }),
  }, "Bluesky didn't take the repost.");
  return true;
}

/** Unless the account already replied there; says whether it replied now. */
export async function reply(session, post, text) {
  const body = text.trim();
  if (!body || graphemes(body) > BLUESKY_TEXT_LIMIT) throw new PublishError(`A plug's reply can be ${BLUESKY_TEXT_LIMIT} characters.`);
  const send = await sender(session);
  const posts = await recentRecords(send, session.did, "app.bsky.feed.post");
  if (posts.some((item) => item.reply?.parent?.uri === post.uri)) return false;
  const facets = facetsOf(body);
  const parent = { uri: post.uri, cid: post.cid };
  await send("com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: { $type: "app.bsky.feed.post", text: body, createdAt: new Date().toISOString(), ...(facets.length ? { facets } : {}), reply: { root: post.root ?? parent, parent } },
    }),
  }, "Bluesky didn't take the reply.");
  return true;
}
