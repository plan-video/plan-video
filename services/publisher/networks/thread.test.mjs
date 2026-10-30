import assert from "node:assert/strict";
import test from "node:test";

import { bluesky } from "./bluesky.mjs";
import { linkedin } from "./linkedin.mjs";
import { createX } from "./x.mjs";

test("X posts a follow-up as a reply to the one before, and counts it like any post", async (t) => {
  const tweets = [];
  t.mock.method(globalThis, "fetch", async (_url, init = {}) => {
    tweets.push(JSON.parse(init.body));
    return Response.json({ data: { id: "202" } });
  });
  const counted = [];
  const x = createX({ limits: { xAllowed: async () => {}, countX: async (userId, link) => counted.push([userId, link]) } });
  const sent = await x.reply({ session: { accessToken: "a" }, text: " More at plan.video ", root: "100", parent: "101", delivery: { user_id: "u1" } });
  assert.deepEqual(tweets, [{ text: "More at plan.video", reply: { in_reply_to_tweet_id: "101" } }]);
  assert.deepEqual(sent, { state: "sent", publishId: "202", url: "https://x.com/i/status/202" });
  assert.deepEqual(counted, [["u1", true]]);
});

test("X turns down a follow-up whose post before it has no id it knows", async () => {
  const x = createX({ limits: { xAllowed: async () => {}, countX: async () => {} } });
  await assert.rejects(x.reply({ session: { accessToken: "a" }, text: "Hi", root: "1", parent: "media:1", delivery: { user_id: "u1" } }), /didn't say where/);
});

test("Bluesky replies under the one before, naming the thread's first post as its root", async (t) => {
  const asked = [];
  const records = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const request = new Request(url, init);
    const path = new URL(request.url);
    if (path.pathname.endsWith("com.atproto.repo.getRecord")) {
      asked.push(path.searchParams.get("rkey"));
      return Response.json({ uri: "ignored", cid: `cid-${path.searchParams.get("rkey")}` });
    }
    records.push(JSON.parse(await request.text()).record);
    return Response.json({ uri: "at://did:plc:me/app.bsky.feed.post/r2", cid: "c" });
  });
  const session = { did: "did:plc:me", pds: "https://pds.example", accessJwt: "j" };
  const sent = await bluesky.reply({
    session,
    text: "Part two #thread",
    root: "at://did:plc:me/app.bsky.feed.post/root",
    parent: "at://did:plc:me/app.bsky.feed.post/r1",
  });
  assert.deepEqual(asked, ["root", "r1"]);
  assert.deepEqual(records[0].reply, {
    root: { uri: "at://did:plc:me/app.bsky.feed.post/root", cid: "cid-root" },
    parent: { uri: "at://did:plc:me/app.bsky.feed.post/r1", cid: "cid-r1" },
  });
  assert.equal(records[0].text, "Part two #thread");
  assert.equal(records[0].facets[0].features[0].tag, "thread");
  assert.equal(sent.url, "https://bsky.app/profile/did:plc:me/post/r2");
});

test("Bluesky's first follow-up asks for the post once, as both root and parent", async (t) => {
  let looked = 0;
  const records = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const request = new Request(url, init);
    if (request.url.includes("getRecord")) {
      looked++;
      return Response.json({ cid: "cid-root" });
    }
    records.push(JSON.parse(await request.text()).record);
    return Response.json({ uri: "at://did:plc:me/app.bsky.feed.post/r1", cid: "c" });
  });
  const root = "at://did:plc:me/app.bsky.feed.post/root";
  await bluesky.reply({ session: { did: "did:plc:me", pds: "https://pds.example", accessJwt: "j" }, text: "Hi", root, parent: root });
  assert.equal(looked, 1);
  assert.deepEqual(records[0].reply.root, records[0].reply.parent);
});

test("Bluesky turns down a follow-up over 300 characters before asking anything", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const root = "at://did:plc:me/app.bsky.feed.post/root";
  await assert.rejects(bluesky.reply({ session: { did: "did:plc:me", pds: "https://pds.example", accessJwt: "j" }, text: "a".repeat(301), root, parent: root }), /300 characters/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("LinkedIn posts every follow-up as a comment on the post itself", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response("{}", { status: 201, headers: { "x-restli-id": "urn:li:comment:(urn:li:activity:1,2)" } });
  });
  const sent = await linkedin.reply({ session: { accessToken: "a", personId: "p1" }, text: "A link: https://plan.video", root: "urn:li:share:1", parent: "urn:li:comment:(urn:li:activity:1,1)" });
  assert.equal(calls[0].url, "https://api.linkedin.com/v2/socialActions/urn%3Ali%3Ashare%3A1/comments");
  assert.deepEqual(calls[0].body, { actor: "urn:li:person:p1", object: "urn:li:share:1", message: { text: "A link: https://plan.video" } });
  assert.deepEqual(sent, { state: "sent", publishId: "urn:li:comment:(urn:li:activity:1,2)", url: "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1/" });
});

test("a LinkedIn comment whose answer is lost isn't tried again on its own", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    linkedin.reply({ session: { accessToken: "a", personId: "p1" }, text: "Hi", root: "urn:li:share:1", parent: "urn:li:share:1" }),
    (error) => error.retry === false && /didn't confirm/.test(error.message),
  );
});

test("X uploads a follow-up's pictures and replies with them", async (t) => {
  const tweets = [];
  let next = 50;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/initialize")) return Response.json({ data: { id: String(next++) } });
    if (path.endsWith("/append")) return new Response(null, { status: 204 });
    if (path.endsWith("/finalize")) return Response.json({ data: {} });
    tweets.push(JSON.parse(init.body));
    return Response.json({ data: { id: "300" } });
  });
  const x = createX({ limits: { xAllowed: async () => {}, countX: async () => {} } });
  const files = ["p1_a", "p1_b"].map((id) => ({ id, key: `posts/u1/${id}`, size: 4, type: "image/jpeg", kind: "image" }));
  const sent = await x.reply({ session: { accessToken: "a" }, text: "", root: "100", parent: "101", delivery: { user_id: "u1" }, files, media: { bytes: async () => Buffer.from("jpeg") } });
  assert.equal(sent.publishId, "300");
  assert.deepEqual(tweets, [{ media: { media_ids: ["50", "51"] }, reply: { in_reply_to_tweet_id: "101" } }]);
});

test("X holds a follow-up whose video is processing, then replies once it's ready", async (t) => {
  let ready = false;
  const tweets = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/initialize")) return Response.json({ data: { id: "77" } });
    if (path.endsWith("/append")) return new Response(null, { status: 204 });
    if (path.endsWith("/finalize")) return Response.json({ data: { processing_info: { state: "pending" } } });
    if (init.method !== "POST") return Response.json({ data: { processing_info: { state: ready ? "succeeded" : "in_progress" } } });
    tweets.push(JSON.parse(init.body));
    return Response.json({ data: { id: "301" } });
  });
  const x = createX({ limits: { xAllowed: async () => {}, countX: async () => {} } });
  const args = { session: { accessToken: "a" }, text: "Watch", root: "100", parent: "100", delivery: { user_id: "u1" }, media: { bytes: async () => Buffer.from("mp4") } };
  const first = await x.reply({ ...args, files: [{ id: "p1_v", key: "posts/u1/p1_v", size: 4, type: "video/mp4", kind: "video" }] });
  assert.equal(first.state, "processing");
  assert.match(first.publishId, /^media:\d+:77$/);
  assert.deepEqual(await x.reply({ ...args, pending: first.publishId }), { state: "processing", publishId: first.publishId });
  ready = true;
  const done = await x.reply({ ...args, pending: first.publishId });
  assert.equal(done.publishId, "301");
  assert.deepEqual(tweets, [{ text: "Watch", media: { media_ids: ["77"] }, reply: { in_reply_to_tweet_id: "100" } }]);
});

test("Bluesky replies with a follow-up's picture", async (t) => {
  const records = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const request = new Request(url, init);
    if (request.url.includes("getRecord")) return Response.json({ cid: "cid-root" });
    if (request.url.endsWith("com.atproto.repo.uploadBlob")) return Response.json({ blob: { ref: "b1" } });
    records.push(JSON.parse(await request.text()).record);
    return Response.json({ uri: "at://did:plc:me/app.bsky.feed.post/r1", cid: "c" });
  });
  const root = "at://did:plc:me/app.bsky.feed.post/root";
  const files = [{ id: "p1_a", key: "posts/u1/p1_a", size: 4, type: "image/png", kind: "image" }];
  await bluesky.reply({ session: { did: "did:plc:me", pds: "https://pds.example", accessJwt: "j" }, text: "", root, parent: root, files, media: { bytes: async () => Buffer.from("png") } });
  assert.equal(records[0].embed.$type, "app.bsky.embed.images");
  assert.deepEqual(records[0].embed.images.map((image) => image.image.ref), ["b1"]);
  assert.equal(records[0].reply.parent.uri, root);
});

test("LinkedIn leaves off a follow-up with media and no words, without asking LinkedIn", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const sent = await linkedin.reply({ session: { accessToken: "a", personId: "p1" }, text: " ", root: "urn:li:share:1", parent: "urn:li:share:1" });
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(sent.publishId, "urn:li:share:1");
  assert.match(sent.note, /words only/);
});
