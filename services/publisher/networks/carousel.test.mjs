import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { bluesky } from "./bluesky.mjs";
import { createTikTok } from "./tiktok.mjs";
import { createX } from "./x.mjs";
import { youtube } from "./youtube.mjs";

const pictures = (count, type = "image/jpeg") =>
  Array.from({ length: count }, (_, index) => ({ id: index ? `p1_${index + 1}` : "p1", key: `posts/u1/p${index}`, size: 4, type, kind: "image" }));

test("X gets up to 4 of a post's pictures in one post", async (t) => {
  const tweets = [];
  let next = 10;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/initialize")) return Response.json({ data: { id: String(next++) } });
    if (path.endsWith("/append")) return new Response(null, { status: 204 });
    if (path.endsWith("/finalize")) return Response.json({ data: {} });
    tweets.push(JSON.parse(init.body));
    return Response.json({ data: { id: "99" } });
  });
  const x = createX({ limits: { xAllowed: async () => {}, countX: async () => {} } });
  const sent = await x.send({
    post: { description: "Five" },
    session: { accessToken: "a" },
    files: pictures(5),
    media: { bytes: async () => Buffer.from("jpeg") },
    delivery: { user_id: "u1" },
  });
  assert.equal(sent.state, "sent");
  assert.deepEqual(tweets, [{ text: "Five", media: { media_ids: ["10", "11", "12", "13"] } }]);
});

test("Bluesky gets up to 4 of a post's pictures, each with its shape", async (t) => {
  const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c33" } }).jpeg().toBuffer();
  const records = [];
  let blobs = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    // The server guard hands fetch a Request.
    const request = new Request(url, init);
    if (request.url.endsWith("com.atproto.repo.uploadBlob")) return Response.json({ blob: { ref: ++blobs } });
    assert.equal(request.redirect, "error");
    records.push(JSON.parse(await request.text()).record);
    return Response.json({ uri: "at://did:plc:me/app.bsky.feed.post/abc", cid: "c" });
  });
  const sent = await bluesky.send({
    post: { description: "Five" },
    session: { did: "did:plc:me", pds: "https://pds.example", accessJwt: "j" },
    files: pictures(5),
    media: { bytes: async () => jpeg },
  });
  assert.equal(sent.url, "https://bsky.app/profile/did:plc:me/post/abc");
  assert.equal(records[0].embed.$type, "app.bsky.embed.images");
  assert.deepEqual(records[0].embed.images.map((image) => image.image.ref), [1, 2, 3, 4]);
  assert.deepEqual(records[0].embed.images[0].aspectRatio, { width: 40, height: 30 });
});

test("TikTok gets a post's pictures as a photo post, pulled from signed links", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ data: { publish_id: "p_pub_1" }, error: { code: "ok" } });
  });
  const photos = { link: (userId, id) => `https://plan.video/api/publisher/photo/${userId}/${id}/1/s.jpg` };
  const sent = await createTikTok({ photos }).send({
    post: { description: "Two", tiktok: { privacy: "public", comments: true } },
    session: { accessToken: "a", scope: "video.publish" },
    files: pictures(2),
    media: {},
    delivery: { user_id: "u1", publish_id: null },
  });
  assert.deepEqual(sent, { state: "processing", publishId: "p_pub_1" });
  assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/post/publish/content/init/");
  assert.deepEqual(calls[0].body, {
    media_type: "PHOTO",
    post_mode: "DIRECT_POST",
    post_info: {
      description: "Two",
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_comment: false,
      auto_add_music: true,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: 0,
      photo_images: ["https://plan.video/api/publisher/photo/u1/p1/1/s.jpg", "https://plan.video/api/publisher/photo/u1/p1_2/1/s.jpg"],
    },
  });
});

test("TikTok's inbox gets a photo post as a draft", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ data: { publish_id: "p_pub_2" }, error: { code: "ok" } });
  });
  const photos = { link: (userId, id) => `https://plan.video/p/${id}.jpg` };
  await createTikTok({ photos }).send({
    post: { description: "", tiktok: { privacy: "private", inbox: true } },
    session: { accessToken: "a", scope: "video.upload,video.publish" },
    files: pictures(1),
    media: {},
    delivery: { user_id: "u1", publish_id: null },
  });
  assert.deepEqual(calls[0], {
    media_type: "PHOTO",
    post_mode: "MEDIA_UPLOAD",
    post_info: {},
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: ["https://plan.video/p/p1.jpg"] },
  });
});

test("a TikTok post sent again after TikTok rejected the last try goes as a new post", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    if (path.endsWith("/status/fetch/")) return Response.json({ data: { status: "FAILED", fail_reason: "spam_risk" }, error: { code: "ok" } });
    return Response.json({ data: { publish_id: "p_new" }, error: { code: "ok" } });
  });
  const sent = await createTikTok({ photos: { link: (userId, id) => `https://plan.video/p/${id}.jpg` } }).send({
    post: { description: "Again", tiktok: { privacy: "public" } },
    session: { accessToken: "a", scope: "video.publish" },
    files: pictures(1),
    media: {},
    delivery: { user_id: "u1", publish_id: "p_rejected" },
  });
  assert.deepEqual(sent, { state: "processing", publishId: "p_new" });
  assert.deepEqual(paths, ["/v2/post/publish/status/fetch/", "/v2/post/publish/content/init/"]);
});

test("a TikTok post TikTok still has from an earlier try is asked after, not sent twice", async (t) => {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    paths.push(new URL(url).pathname);
    return Response.json({ data: { status: "PROCESSING_DOWNLOAD" }, error: { code: "ok" } });
  });
  const sent = await createTikTok({ photos: { link: () => "https://plan.video/p.jpg" } }).send({
    post: { tiktok: { privacy: "public" } },
    session: { accessToken: "a", scope: "video.publish" },
    files: pictures(1),
    media: {},
    delivery: { user_id: "u1", publish_id: "p_going" },
  });
  assert.deepEqual(sent, { state: "processing", publishId: "p_going" });
  assert.deepEqual(paths, ["/v2/post/publish/status/fetch/"]);
});

test("without photo links, TikTok turns pictures down with a reason instead of sending", async (t) => {
  const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(
    createTikTok().send({ post: { tiktok: { privacy: "public" } }, session: { accessToken: "a" }, files: pictures(2), media: {}, delivery: { user_id: "u1" } }),
    (error) => error.retry === false && /photo posts aren't switched on/.test(error.message),
  );
  assert.equal(fetched.mock.callCount(), 0);
});

test("YouTube takes a post's video, and turns down a post with pictures only", async (t) => {
  const fetched = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  await assert.rejects(
    youtube.send({ post: { youtube: { title: "Hi" } }, session: { accessToken: "a" }, files: pictures(2), media: {}, delivery: {}, progress: async () => {} }),
    /YouTube needs a video/,
  );
  assert.equal(fetched.mock.callCount(), 0);
});
