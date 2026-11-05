import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { renewed, RENEW_AFTER_MS, authorizeUrl, exchangeCode, boardsOf } from "../pinterest.mjs";
import { createPinterest, linkOf } from "./pinterest.mjs";

const app = { appId: "app", appSecret: "secret" };
const sandbox = { ...app, sandbox: true };
const photos = { link: (user, id) => `https://plan.video/api/publisher/photo/${user}/${id}/1/sig.jpg` };
const pinterest = createPinterest({ photos, app });
const SESSION = { accountId: "a1", accessToken: "pina-token", refreshToken: "pinr-token", expiresAt: Date.now() + 86_400_000, renewedAt: Date.now() };
const delivery = (publishId = null, updatedAt = new Date().toISOString()) => ({ id: "d1", user_id: "u1", publish_id: publishId, updated_at: updatedAt });
const image = (id) => ({ id, kind: "image", size: 1000, type: "image/png", key: `posts/u1/${id}` });
const video = (id, size = 11) => ({ id, kind: "video", size, type: "video/mp4", key: `posts/u1/${id}` });
const post = (extra = {}) => ({ description: "Shared words", pinterest: { title: "A title", board: "Recipes" }, ...extra });

/** `routes` are [method and path start, answer] pairs, tried in order; an answer may be a function of the call. Boards start with Recipes. */
function fakePinterest(t, routes = [], { boards = [{ id: "10", name: "Recipes" }] } = {}) {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const href = String(url);
    const path = href.replace(/^https:\/\/api(-sandbox)?\.pinterest\.com\/v5/, "");
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    const call = { href, path, method: init.method ?? "GET", body, headers: init.headers ?? {} };
    asked.push(call);
    for (const [match, answer] of routes) {
      if (`${call.method} ${path}`.startsWith(match)) {
        const made = typeof answer === "function" ? answer(call) : answer;
        if (made === null) throw new TypeError("fetch failed");
        return new Response(JSON.stringify(made.body ?? {}), { status: made.status ?? 200 });
      }
    }
    if (call.method === "GET" && path.startsWith("/boards")) return new Response(JSON.stringify({ items: boards, bookmark: null }));
    return new Response(JSON.stringify({ code: 1, message: `unexpected ${call.method} ${path}` }), { status: 400 });
  });
  return { asked, pins: () => asked.filter((call) => call.method === "POST" && call.path === "/pins") };
}

test("a picture becomes one Pin on the board named, pulled from its link, with its title, words and link", async (t) => {
  const { pins } = fakePinterest(t, [["POST /pins", { status: 201, body: { id: "99" } }]]);
  const result = await pinterest.send({ post: post({ link: "shop.example.com/a", captions: { pinterest: "Own words" } }), session: SESSION, files: [image("f1")], delivery: delivery() });
  assert.deepEqual(result, { state: "sent", publishId: "99", url: "https://www.pinterest.com/pin/99/" });
  assert.equal(pins().length, 1);
  assert.deepEqual(pins()[0].body, {
    board_id: "10",
    title: "A title",
    description: "Own words",
    link: "https://shop.example.com/a",
    media_source: { source_type: "image_url", url: photos.link("u1", "f1") },
  });
  assert.equal(pins()[0].headers.Authorization, "Bearer pina-token");
});

test("several pictures go as one Pin of at most five", async (t) => {
  const { pins } = fakePinterest(t, [["POST /pins", { status: 201, body: { id: "99" } }]]);
  await pinterest.send({ post: post(), session: SESSION, files: ["a", "b", "c", "d", "e", "f"].map(image), delivery: delivery() });
  assert.equal(pins()[0].body.media_source.source_type, "multiple_image_urls");
  assert.deepEqual(pins()[0].body.media_source.items.map((item) => item.url), ["a", "b", "c", "d", "e"].map((id) => photos.link("u1", id)));
});

test("the board is matched however it was typed, and across pages of boards", async (t) => {
  const { pins, asked } = fakePinterest(t, [
    ["GET /boards?page_size=100&bookmark=next", { body: { items: [{ id: "20", name: "Summer  Holiday" }], bookmark: null } }],
    ["GET /boards", { body: { items: [{ id: "10", name: "Recipes" }], bookmark: "next" } }],
    ["POST /pins", { status: 201, body: { id: "99" } }],
  ]);
  await pinterest.send({ post: post({ pinterest: { board: " summer holiday " } }), session: SESSION, files: [image("f1")], delivery: delivery() });
  assert.equal(pins()[0].body.board_id, "20");
  assert.equal(asked.filter((call) => call.path.startsWith("/boards")).length, 2);
});

test("a board the account doesn't have yet is made, so the post isn't missed", async (t) => {
  const { pins, asked } = fakePinterest(t, [["POST /boards", { status: 201, body: { id: "30", name: "New one" } }], ["POST /pins", { status: 201, body: { id: "99" } }]]);
  await pinterest.send({ post: post({ pinterest: { board: "New one" } }), session: SESSION, files: [image("f1")], delivery: delivery() });
  assert.deepEqual(asked.find((call) => call.method === "POST" && call.path === "/boards").body, { name: "New one" });
  assert.equal(pins()[0].body.board_id, "30");
});

test("a board made by a try whose answer was lost is found, not made twice", async (t) => {
  let listed = 0;
  const { pins } = fakePinterest(t, [
    ["GET /boards", () => ({ body: { items: listed++ ? [{ id: "30", name: "New one" }] : [], bookmark: null } })],
    ["POST /boards", null],
    ["POST /pins", { status: 201, body: { id: "99" } }],
  ]);
  await pinterest.send({ post: post({ pinterest: { board: "New one" } }), session: SESSION, files: [image("f1")], delivery: delivery() });
  assert.equal(pins()[0].body.board_id, "30");
});

test("a post with no board or no media fails with words to act on, before anything is sent", async (t) => {
  const { pins } = fakePinterest(t);
  await assert.rejects(pinterest.send({ post: post({ pinterest: { board: " " } }), session: SESSION, files: [image("f1")], delivery: delivery() }), (error) => /Pick a board/.test(error.message) && !error.retry);
  await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [], delivery: delivery() }), /needs a video or pictures/);
  assert.equal(pins().length, 0);
});

test("a Pin whose answer is lost, or that Pinterest failed on, isn't made again on its own", async (t) => {
  for (const answer of [null, { status: 502, body: { message: "Bad gateway" } }]) {
    t.mock.restoreAll();
    fakePinterest(t, [["POST /pins", answer]]);
    await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [image("f1")], delivery: delivery() }), (error) => /didn't confirm/.test(error.message) && !error.retry);
  }
});

test("too many requests tries again; a gone login asks for a reconnect; a refusal says why", async (t) => {
  fakePinterest(t, [["POST /pins", { status: 429, body: { code: 8 } }]]);
  await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [image("f1")], delivery: delivery() }), (error) => error.retry && !error.expired);
  t.mock.restoreAll();
  fakePinterest(t, [["POST /pins", { status: 401, body: { code: 2, message: "Authentication failed." } }]]);
  await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [image("f1")], delivery: delivery() }), (error) => error.expired && !error.retry);
  t.mock.restoreAll();
  fakePinterest(t, [["POST /pins", { status: 400, body: { code: 1, message: "Sorry, this image is too small." } }]]);
  await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [image("f1")], delivery: delivery() }), (error) => /too small/.test(error.message) && !error.retry);
});

test("a video reaches the upload address whole, as a form S3 takes, with its length up front and no login", async (t) => {
  const received = { };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      Object.assign(received, { headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const uploadUrl = `http://127.0.0.1:${server.address().port}/`;
  const real = globalThis.fetch;
  const asked = [];
  t.mock.method(globalThis, "fetch", (url, init = {}) => {
    if (String(url).startsWith(uploadUrl)) return real(url, init);
    asked.push(`${init.method ?? "GET"} ${url}`);
    if (String(url).endsWith("/media")) return Promise.resolve(new Response(JSON.stringify({ media_id: "555", upload_url: uploadUrl, upload_parameters: { key: "uploads/1", policy: "abc" } })));
    return Promise.resolve(new Response(JSON.stringify({ items: [{ id: "10", name: "Recipes" }] })));
  });
  const media = { stream: async () => new Blob(["hello", " ", "video"]).stream() };
  const result = await pinterest.send({ post: post(), session: SESSION, files: [video("v1")], media, delivery: delivery() });
  assert.deepEqual(result, { state: "processing", publishId: "555" });
  assert.equal(asked.some((call) => call.endsWith("/pins")), false);
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.headers["transfer-encoding"], undefined);
  assert.equal(Number(received.headers["content-length"]), received.body.length);
  const form = await new Response(received.body, { headers: { "Content-Type": received.headers["content-type"] } }).formData();
  assert.equal(form.get("key"), "uploads/1");
  assert.equal(form.get("policy"), "abc");
  assert.equal(await form.get("file").text(), "hello video");
  assert.equal([...form.keys()].at(-1), "file");
});

test("an upload that stops tries again, and no Pin is made", async (t) => {
  const { pins } = fakePinterest(t, [["POST /media", { body: { media_id: "555", upload_url: "https://uploads.example/", upload_parameters: {} } }]]);
  const real = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, init) => (String(url).startsWith("https://uploads.example") ? Promise.resolve(new Response("<Error/>", { status: 403 })) : real(url, init)));
  await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [video("v1")], media: { stream: async () => new Blob(["hello video"]).stream() }, delivery: delivery() }), (error) => error.retry);
  assert.equal(pins().length, 0);
});

test("a video too large is turned down before anything is uploaded", async (t) => {
  const { asked } = fakePinterest(t);
  await assert.rejects(pinterest.send({ post: post(), session: SESSION, files: [video("v1", 3 * 1024 ** 3)], media: {}, delivery: delivery() }), /too large/);
  assert.equal(asked.some((call) => call.path === "/media"), false);
});

test("while Pinterest works on a video it waits; when done it's ready; a failed one fails; one stuck too long gives up", async (t) => {
  for (const [status, want] of [["registered", "processing"], ["processing", "processing"], ["succeeded", "ready"]]) {
    t.mock.restoreAll();
    fakePinterest(t, [["GET /media/555", { body: { status } }]]);
    assert.equal((await pinterest.check({ session: SESSION, delivery: delivery("555") })).state, want);
  }
  t.mock.restoreAll();
  fakePinterest(t, [["GET /media/555", { body: { status: "failed" } }]]);
  await assert.rejects(pinterest.check({ session: SESSION, delivery: delivery("555") }), /couldn't process/);
  t.mock.restoreAll();
  fakePinterest(t, [["GET /media/555", { body: { status: "processing" } }]]);
  await assert.rejects(pinterest.check({ session: SESSION, delivery: delivery("555", new Date(Date.now() - 2 * 60 * 60_000).toISOString()) }), /didn't finish/);
});

test("a ready video makes its Pin with the chosen cover moment; a lost answer isn't tried again, too many requests is", async (t) => {
  const { pins } = fakePinterest(t, [["POST /pins", { status: 201, body: { id: "99" } }]]);
  const result = await pinterest.publish({ post: post({ coverTime: 2.7 }), session: SESSION, delivery: delivery("555") });
  assert.equal(result.state, "sent");
  assert.deepEqual(pins()[0].body.media_source, { source_type: "video_id", media_id: "555", cover_image_key_frame_time: 2 });
  t.mock.restoreAll();
  fakePinterest(t, [["POST /pins", null]]);
  await assert.rejects(pinterest.publish({ post: post(), session: SESSION, delivery: delivery("555") }), (error) => !error.retry);
  t.mock.restoreAll();
  fakePinterest(t, [["POST /pins", { status: 429 }]]);
  await assert.rejects(pinterest.publish({ post: post(), session: SESSION, delivery: delivery("555") }), (error) => error.retry);
});

test("a link that can't be a web address goes without", () => {
  assert.equal(linkOf({ link: "https://a.example/x" }), "https://a.example/x");
  assert.equal(linkOf({ link: "a.example" }), "https://a.example/");
  assert.equal(linkOf({ link: "javascript:alert(1)" }), null);
  assert.equal(linkOf({ link: "not a link" }), null);
  assert.equal(linkOf({ link: "" }), null);
  assert.equal(linkOf({}), null);
});

test("signing in swaps the code with the app's secret and keeps both tokens, asking the sandbox when set", async (t) => {
  const { asked } = fakePinterest(t, [
    ["POST /oauth/token", { body: { access_token: "pina-1", refresh_token: "pinr-1", expires_in: 2592000, scope: "pins:write" } }],
    ["GET /user_account", { body: { id: "77", username: "maker", profile_image: "https://i.pinimg.test/a.jpg" } }],
  ]);
  const found = await exchangeCode(sandbox, { code: "c", redirectUri: "https://plan.video/pinterest/callback", now: 1000 });
  assert.equal(found.accountId, "77");
  assert.equal(found.handle, "maker");
  assert.deepEqual(found.session, { accountId: "77", accessToken: "pina-1", refreshToken: "pinr-1", expiresAt: 1000 + 2592000_000, renewedAt: 1000, scope: "pins:write" });
  assert.match(asked[0].href, /^https:\/\/api-sandbox\.pinterest\.com\/v5\/oauth\/token$/);
  assert.equal(asked[0].headers.Authorization, `Basic ${Buffer.from("app:secret").toString("base64")}`);
  assert.equal(asked[0].body.get("grant_type"), "authorization_code");
  const url = new URL(authorizeUrl(app, { redirectUri: "https://plan.video/pinterest/callback", state: "state1234" }));
  assert.equal(url.origin, "https://www.pinterest.com");
  assert.ok(url.searchParams.get("scope").split(",").includes("pins:write"));
});

test("a login is left alone until a week old, then renewed with the new refresh token kept", async (t) => {
  const now = Date.now();
  const session = { ...SESSION, renewedAt: now - RENEW_AFTER_MS + 60_000, expiresAt: now + 86_400_000 * 20 };
  assert.equal(await renewed(session, app, now), null);
  fakePinterest(t, [["POST /oauth/token", { body: { access_token: "pina-2", refresh_token: "pinr-2", expires_in: 2592000 } }]]);
  const next = await renewed({ ...session, renewedAt: now - RENEW_AFTER_MS - 1 }, app, now);
  assert.equal(next.accessToken, "pina-2");
  assert.equal(next.refreshToken, "pinr-2");
  assert.equal(next.renewedAt, now);
});

test("a renewal that fails leaves a login still running, tries again when Pinterest is down, and asks for a reconnect when refused", async (t) => {
  const now = Date.now();
  const old = now - RENEW_AFTER_MS - 1;
  fakePinterest(t, [["POST /oauth/token", { status: 400, body: { message: "invalid_grant" } }]]);
  assert.equal(await renewed({ ...SESSION, renewedAt: old, expiresAt: now + 86_400_000 }, app, now), null);
  await assert.rejects(renewed({ ...SESSION, renewedAt: old, expiresAt: now + 1000 }, app, now), (error) => error.expired && !error.retry);
  t.mock.restoreAll();
  fakePinterest(t, [["POST /oauth/token", null]]);
  await assert.rejects(renewed({ ...SESSION, renewedAt: old, expiresAt: now + 1000 }, app, now), (error) => error.retry && !error.expired);
  await assert.rejects(renewed({ ...SESSION, refreshToken: "", renewedAt: old, expiresAt: now - 1000 }, app, now), (error) => error.expired);
});

test("boards that can't be read say so and try again", async (t) => {
  fakePinterest(t, [["GET /boards", { status: 500 }]]);
  await assert.rejects(boardsOf(app, SESSION), (error) => error.retry);
});
