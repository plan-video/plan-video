import { test } from "node:test";
import assert from "node:assert/strict";

import { createFacebook } from "./facebook.mjs";
import { createInstagram } from "./instagram.mjs";
import { createThreads } from "./threads.mjs";

const photos = {
  link: (user, id) => `https://plan.video/api/publisher/photo/${user}/${id}/1/sig.jpg`,
  feedLink: (user, id) => `https://plan.video/api/publisher/photo/feed/${user}/${id}/1/sig.jpg`,
  videoLink: (user, id) => `https://plan.video/api/publisher/video/${user}/${id}/1/sig.mp4`,
};
const delivery = (publishId = null) => ({ id: "d1", user_id: "u1", publish_id: publishId, updated_at: new Date().toISOString() });
const image = (id) => ({ id, kind: "image", size: 1000, type: "image/png", key: `posts/u1/${id}` });
const video = (id, size = 5_000_000) => ({ id, kind: "video", size, type: "video/mp4", key: `posts/u1/${id}` });
const IG = { accountId: "17841400000000001", accessToken: "ig-token" };
const TH = { accountId: "555", accessToken: "th-token" };
const FB = { accountId: "111", accessToken: "page-token" };

/** Containers get ids c1, c2…, report `statuses` (FINISHED unless said), and publishing makes m1. */
function fakeGraph(t, { statuses = {}, published = { id: "m1" }, permalink = "https://www.instagram.com/p/abc/", extra = [] } = {}) {
  const asked = [];
  let made = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const href = String(url);
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(String(init.body)) : {};
    asked.push({ url: href, method: init.method ?? "GET", form, headers: init.headers ?? {} });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    for (const [match, body] of extra) if (href.includes(match)) return reply(typeof body === "function" ? body(href, form) : body);
    if (/\/(media|threads)\?/.test(href) && init.method === "POST") return reply({ id: `c${++made}` });
    if (/(media_publish|threads_publish)/.test(href)) return typeof published === "function" ? published() : reply(published);
    const status = /\/(c\d+)\?fields=(status_code|status)/.exec(href);
    if (status) {
      const value = statuses[status[1]] ?? "FINISHED";
      return reply(href.includes("status_code") ? { status_code: value, status: value === "ERROR" ? "2207026" : "" } : { status: value, error_message: value === "ERROR" ? "INVALID_DURATION" : undefined });
    }
    if (href.includes("fields=permalink")) return reply({ permalink, permalink_url: permalink });
    return reply({ error: { message: `unexpected ${href}`, code: 100 } }, 400);
  });
  return asked;
}

const instagram = createInstagram({ photos });
const threads = createThreads({ photos });
const facebook = createFacebook({ photos });

test("Instagram: a picture goes up as a JPEG link, with its caption and collaborators, and is published at once when ready", async (t) => {
  const asked = fakeGraph(t);
  const post = { description: "Shared", captions: { instagram: "Hello Instagram" }, instagram: { shareToFeed: true, collaborators: ["@friend", "bad name!"] } };
  const result = await instagram.send({ post, session: IG, files: [image("f1")], delivery: delivery() });
  assert.deepEqual(result, { state: "sent", publishId: "m1", url: "https://www.instagram.com/p/abc/" });
  const [create] = asked;
  assert.match(create.url, /graph\.instagram\.com\/v26\.0\/17841400000000001\/media\?access_token=ig-token/);
  assert.equal(create.form.image_url, photos.feedLink("u1", "f1"));
  assert.equal(create.form.caption, "Hello Instagram");
  assert.equal(create.form.collaborators, JSON.stringify(["friend"]));
  assert.equal(asked.find((call) => call.url.includes("media_publish")).form.creation_id, "c1");
});

test("Instagram: a video is a Reel, left processing while Instagram works on it, then published once", async (t) => {
  const statuses = { c1: "IN_PROGRESS" };
  const asked = fakeGraph(t, { statuses });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const sending = instagram.send({ post: { description: "Reel", instagram: { shareToFeed: false }, coverTime: 2.5 }, session: IG, files: [video("v1")], delivery: delivery() });
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(3_000);
  }
  const result = await sending;
  t.mock.timers.reset();
  assert.deepEqual(result, { state: "processing", publishId: "one:c1" });
  const create = asked[0].form;
  assert.equal(create.media_type, "REELS");
  assert.equal(create.video_url, photos.videoLink("u1", "v1"));
  assert.equal(create.share_to_feed, "false");
  assert.equal(create.thumb_offset, "2500");

  assert.deepEqual(await instagram.check({ session: IG, delivery: delivery("one:c1") }), { state: "processing", publishId: "one:c1" });
  statuses.c1 = "FINISHED";
  assert.deepEqual(await instagram.check({ session: IG, delivery: delivery("one:c1") }), { state: "ready" });
  const sent = await instagram.publish({ post: {}, session: IG, delivery: delivery("one:c1") });
  assert.equal(sent.publishId, "m1");
  assert.equal(asked.filter((call) => call.url.includes("media_publish")).length, 1);
});

test("Instagram: several files are a carousel of up to 10, its holder made once the items are ready", async (t) => {
  const asked = fakeGraph(t);
  const files = [video("v1"), ...Array.from({ length: 11 }, (_, index) => image(`p${index}`))];
  const result = await instagram.send({ post: { description: "Carousel" }, session: IG, files, delivery: delivery() });
  assert.equal(result.state, "sent");
  const creates = asked.filter((call) => call.method === "POST" && /\/media\?/.test(call.url));
  assert.equal(creates.length, 11);
  assert.deepEqual(creates[0].form, { media_type: "VIDEO", video_url: photos.videoLink("u1", "v1"), is_carousel_item: "true" });
  assert.equal(creates[1].form.is_carousel_item, "true");
  const holder = creates.at(-1).form;
  assert.equal(holder.media_type, "CAROUSEL");
  assert.equal(holder.children.split(",").length, 10);
  assert.equal(holder.caption, "Carousel");
});

test("Instagram: a Story goes without a caption, and a post with no files isn't sent", async (t) => {
  const asked = fakeGraph(t);
  await instagram.send({ post: { story: true, description: "No words on stories" }, session: IG, files: [image("s1")], delivery: delivery() });
  assert.deepEqual(asked[0].form, { media_type: "STORIES", image_url: photos.link("u1", "s1") });
  await assert.rejects(instagram.send({ post: { description: "Words" }, session: IG, files: [], delivery: delivery() }), /need a video or pictures/);
});

test("Instagram: a file it can't use fails the post with why, and the day's limit waits instead of failing", async (t) => {
  fakeGraph(t, { statuses: { c1: "ERROR" } });
  await assert.rejects(instagram.check({ session: IG, delivery: delivery("one:c1") }), /couldn't use one of the post's files: 2207026/);
  t.mock.restoreAll();
  fakeGraph(t, { published: () => new Response(JSON.stringify({ error: { message: "limit", code: 9, error_subcode: 2207042 } }), { status: 400 }) });
  await assert.rejects(instagram.publish({ post: {}, session: IG, delivery: delivery("one:c1") }), (error) => error.until > Date.now() && error.retry === true);
});

test("Instagram: when publishing gets no answer, the post isn't made again on its own", async (t) => {
  fakeGraph(t, { published: () => Promise.reject(new Error("socket hang up")) });
  await assert.rejects(instagram.publish({ post: {}, session: IG, delivery: delivery("one:c1") }), (error) => /didn't confirm/.test(error.message) && !error.retry);
});

test("Instagram: a login that's gone asks for a reconnect", async (t) => {
  fakeGraph(t, { extra: [["/media?", { error: { message: "Error validating access token", code: 190 } }]] });
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190 } }), { status: 400 }));
  await assert.rejects(instagram.send({ post: {}, session: IG, files: [image("f1")], delivery: delivery() }), (error) => error.expired === true);
});

test("Threads: words alone go as a text post with the post's link, cut to 500 characters", async (t) => {
  const asked = fakeGraph(t, { permalink: "https://www.threads.net/@maker/post/abc" });
  const result = await threads.send({ post: { description: "x".repeat(600), link: "https://plan.video" }, session: TH, files: [], delivery: delivery() });
  assert.deepEqual(result, { state: "sent", publishId: "m1", url: "https://www.threads.net/@maker/post/abc" });
  assert.match(asked[0].url, /graph\.threads\.net\/v1\.0\/555\/threads\?access_token=th-token/);
  assert.equal(asked[0].form.media_type, "TEXT");
  assert.equal(asked[0].form.text.length, 500);
  assert.equal(asked[0].form.link_attachment, "https://plan.video");
  assert.match(asked.find((call) => call.url.includes("threads_publish")).url, /\/555\/threads_publish/);
});

test("Threads: pictures and videos go as a carousel of up to 20 with the words on the holder", async (t) => {
  const asked = fakeGraph(t);
  await threads.send({ post: { description: "Set" }, session: TH, files: [image("a"), video("b")], delivery: delivery() });
  const creates = asked.filter((call) => call.method === "POST" && /\/threads\?/.test(call.url));
  assert.deepEqual(creates.map((call) => call.form.media_type), ["IMAGE", "VIDEO", "CAROUSEL"]);
  assert.equal(creates[1].form.video_url, photos.videoLink("u1", "b"));
  assert.equal(creates[2].form.children, "c1,c2");
  assert.equal(creates[2].form.text, "Set");
  assert.equal(creates[0].form.text, undefined);
});

test("Threads: a video Threads can't use fails with its reason", async (t) => {
  fakeGraph(t, { statuses: { c1: "ERROR" } });
  await assert.rejects(threads.check({ session: TH, delivery: delivery("one:c1") }), /invalid duration/);
});

test("Facebook: words alone go to the Page's feed with the post's link, and the post's address comes back", async (t) => {
  const asked = fakeGraph(t, { extra: [["/111/feed", { id: "111_9" }]], permalink: "https://www.facebook.com/111/posts/9" });
  const result = await facebook.send({ post: { description: "Page news", link: "https://plan.video" }, session: FB, files: [], delivery: delivery() });
  assert.deepEqual(result, { state: "sent", publishId: "111_9", url: "https://www.facebook.com/111/posts/9" });
  assert.deepEqual(asked[0].form, { message: "Page news", link: "https://plan.video" });
  assert.match(asked[0].url, /graph\.facebook\.com\/v26\.0\/111\/feed\?access_token=page-token/);
});

test("Facebook: several pictures go up unpublished, then as one post", async (t) => {
  let photo = 0;
  const asked = fakeGraph(t, { extra: [["/111/photos", () => ({ id: `ph${++photo}` })], ["/111/feed", { id: "111_10" }]] });
  await facebook.send({ post: { description: "Album" }, session: FB, files: [image("a"), image("b")], delivery: delivery() });
  const uploads = asked.filter((call) => call.url.includes("/111/photos"));
  assert.deepEqual(uploads.map((call) => call.form), [{ url: photos.link("u1", "a"), published: "false" }, { url: photos.link("u1", "b"), published: "false" }]);
  const feed = asked.find((call) => call.url.includes("/111/feed"));
  assert.deepEqual(feed.form, { message: "Album", attached_media: [{ media_fbid: "ph1" }, { media_fbid: "ph2" }] });
});

test("Facebook: a video goes up from its link with the words as its description", async (t) => {
  const asked = fakeGraph(t, { extra: [["/111/videos", { id: "v77" }]], permalink: "/111/videos/v77/" });
  const result = await facebook.send({ post: { description: "Watch" }, session: FB, files: [video("v1"), image("a")], delivery: delivery() });
  assert.equal(result.publishId, "v77");
  assert.equal(result.url, "https://www.facebook.com/111/videos/v77/");
  assert.match(result.note, /not both/);
  assert.match(asked[0].url, /graph-video\.facebook\.com\/v26\.0\/111\/videos/);
  assert.deepEqual(asked[0].form, { file_url: photos.videoLink("u1", "v1"), description: "Watch" });
});

test("Facebook: a picture Story is posted from an unpublished picture", async (t) => {
  const asked = fakeGraph(t, { extra: [["/111/photos", { id: "ph1" }], ["/111/photo_stories", { success: true, post_id: "st1" }]] });
  const result = await facebook.send({ post: { story: true }, session: FB, files: [image("a")], delivery: delivery() });
  assert.equal(result.publishId, "st1");
  assert.deepEqual(asked[1].form, { photo_id: "ph1" });
});

test("Facebook: a lost answer isn't tried again on its own", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("reset");
  });
  await assert.rejects(facebook.send({ post: { description: "Hi" }, session: FB, files: [], delivery: delivery() }), (error) => /didn't confirm/.test(error.message) && !error.retry);
});
