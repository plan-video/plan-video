import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "../errors.mjs";
import { createTikTok } from "./tiktok.mjs";

const VIDEO = { id: "p1", key: "posts/u1/p1", size: 1000, type: "video/mp4", kind: "video" };
const PICTURE = { id: "p1_a", key: "posts/u1/p1_a", size: 10, type: "image/jpeg", kind: "image" };
const post = (extra = {}) => ({ id: "p1", title: "Hi", platforms: ["tiktok"], tiktok: { privacy: "public" }, ...extra });
const media = { bytes: async (_key, from, to) => Buffer.alloc(to - from + 1) };
const photos = { link: (_user, id) => `https://plan.video/api/publisher/photo/${id}` };

/**
 * Stands in for TikTok: `answers` maps an API path to what it says, or to "drop" for
 * a connection that never answers. Every call is kept, in order.
 */
function fakeTikTok(answers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method, body: init.body && typeof init.body === "string" ? JSON.parse(init.body) : null });
    const answer = typeof answers[path] === "function" ? answers[path]() : answers[path];
    if (answer === "drop") throw new TypeError("fetch failed");
    if (path === "/upload") return new Response(null, { status: answer ?? 201 });
    return new Response(JSON.stringify({ data: answer ?? {}, error: { code: "ok" } }), { status: 200 });
  };
  return { calls, restore: () => (globalThis.fetch = original), paths: () => calls.map((call) => call.path) };
}

const INIT = { publish_id: "v_pub_1", upload_url: "https://open-upload.tiktokapis.com/upload" };

test("a video keeps its publish id before the first piece goes up", async () => {
  const tiktok = fakeTikTok({ "/v2/post/publish/video/init/": INIT });
  const kept = [];
  try {
    const result = await createTikTok().send({
      post: post(),
      session: { accessToken: "a", scope: "video.publish" },
      files: [VIDEO],
      media,
      delivery: { user_id: "u1" },
      progress: async (id) => kept.push({ id, uploadsSoFar: tiktok.paths().filter((path) => path === "/upload").length }),
    });
    assert.deepEqual(result, { state: "processing", publishId: "v_pub_1" });
    assert.deepEqual(kept, [{ id: "v_pub_1", uploadsSoFar: 0 }]);
  } finally {
    tiktok.restore();
  }
});

test("a lost answer to the last piece waits for TikTok rather than uploading the video again", async () => {
  // First try: TikTok takes the last piece but the answer never arrives.
  const tiktok = fakeTikTok({ "/v2/post/publish/video/init/": INIT, "/upload": "drop" });
  const delivery = { user_id: "u1" };
  const progress = async (id) => (delivery.publish_id = id);
  try {
    await assert.rejects(
      createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery, progress }),
      (error) => error instanceof PublishError && error.retry === true,
    );
    assert.equal(delivery.publish_id, "v_pub_1");
  } finally {
    tiktok.restore();
  }

  // The retry: TikTok has every byte and is processing it.
  const again = fakeTikTok({ "/v2/post/publish/status/fetch/": { status: "PROCESSING_UPLOAD", uploaded_bytes: VIDEO.size } });
  try {
    const result = await createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery, progress });
    assert.deepEqual(result, { state: "processing", publishId: "v_pub_1" });
    assert.deepEqual(again.paths(), ["/v2/post/publish/status/fetch/"]);
  } finally {
    again.restore();
  }
});

test("an upload TikTok never got all of starts again", async () => {
  const tiktok = fakeTikTok({
    "/v2/post/publish/status/fetch/": { status: "PROCESSING_UPLOAD", uploaded_bytes: 400 },
    "/v2/post/publish/video/init/": { ...INIT, publish_id: "v_pub_2" },
  });
  const delivery = { user_id: "u1", publish_id: "v_pub_1" };
  try {
    const result = await createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery, progress: async (id) => (delivery.publish_id = id) });
    assert.deepEqual(result, { state: "processing", publishId: "v_pub_2" });
    assert.deepEqual(tiktok.paths(), ["/v2/post/publish/status/fetch/", "/v2/post/publish/video/init/", "/upload"]);
  } finally {
    tiktok.restore();
  }
});

test("an upload whose progress TikTok doesn't report is waited for, not repeated", async () => {
  const tiktok = fakeTikTok({ "/v2/post/publish/status/fetch/": { status: "PROCESSING_UPLOAD" } });
  try {
    const result = await createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery: { user_id: "u1", publish_id: "v_pub_1" } });
    assert.equal(result.state, "processing");
    assert.deepEqual(tiktok.paths(), ["/v2/post/publish/status/fetch/"]);
  } finally {
    tiktok.restore();
  }
});

test("when TikTok can't be asked about an earlier try, nothing is sent again", async () => {
  const tiktok = fakeTikTok({ "/v2/post/publish/status/fetch/": "drop" });
  try {
    await assert.rejects(
      createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery: { user_id: "u1", publish_id: "v_pub_1" } }),
      (error) => error instanceof PublishError && error.retry === true,
    );
    assert.deepEqual(tiktok.paths(), ["/v2/post/publish/status/fetch/"]);
  } finally {
    tiktok.restore();
  }
});

test("a post TikTok turned down goes again as a new one", async () => {
  const tiktok = fakeTikTok({ "/v2/post/publish/status/fetch/": { status: "FAILED" }, "/v2/post/publish/video/init/": { ...INIT, publish_id: "v_pub_2" } });
  try {
    const result = await createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery: { user_id: "u1", publish_id: "v_pub_1" } });
    assert.equal(result.publishId, "v_pub_2");
  } finally {
    tiktok.restore();
  }
});

test("a photo post whose start went unanswered isn't made again", async () => {
  const tiktok = fakeTikTok({ "/v2/post/publish/content/init/": "drop" });
  try {
    await assert.rejects(
      createTikTok({ photos }).send({ post: post(), session: { accessToken: "a" }, files: [PICTURE], media, delivery: { user_id: "u1" } }),
      (error) => error instanceof PublishError && !error.retry && /may have gone out/.test(error.message),
    );
    assert.deepEqual(tiktok.paths(), ["/v2/post/publish/content/init/"]);
  } finally {
    tiktok.restore();
  }
});

test("a video's init that went unanswered is tried again, since nothing is up yet", async () => {
  const tiktok = fakeTikTok({ "/v2/post/publish/video/init/": "drop" });
  try {
    await assert.rejects(
      createTikTok().send({ post: post(), session: { accessToken: "a" }, files: [VIDEO], media, delivery: { user_id: "u1" } }),
      (error) => error instanceof PublishError && error.retry === true,
    );
  } finally {
    tiktok.restore();
  }
});
