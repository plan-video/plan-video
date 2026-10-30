import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { connectWithin, createAccountLimits } from "./accounts.mjs";
import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { OVER_SCHEDULED, createPlanLimits, isWaiting, startOf, uploadsPerDay } from "./plans.mjs";
import { youtube as realYouTube } from "./networks/youtube.mjs";
import { createWorker } from "./worker.mjs";

const T0 = Date.parse("2026-10-12T16:00:00Z");
const HOUR = 60 * 60_000;
const VIDEO = { key: "posts/u1/v", size: 10, type: "video/mp4", kind: "video" };

const post = (id, hours, extra = {}) => {
  const at = new Date(T0 + hours * HOUR);
  return {
    user_id: "u1",
    workspace_id: "w1",
    time_zone: "UTC",
    connections: [
      { id: "tt1", platform: "tiktok" },
      { id: "yt1", platform: "youtube" },
    ],
    post: { id, day: at.toISOString().slice(0, 10), start: at.toISOString().slice(11, 16), timeZone: "UTC", status: "scheduled", platforms: ["tiktok"], ...extra },
  };
};

function setup({ posts = [], level = 1, youtube, networks, media, session = {} } = {}) {
  let clock = T0;
  const users = [{ id: "u1", access_level: level }];
  const db = fakeDb({ posts, users });
  const calls = [];
  const failing = new Map();
  const network = (name) => ({
    needsFile: true,
    async send(ctx) {
      calls.push({ name, post: ctx.post.id });
      if (failing.has(ctx.post.id)) throw failing.get(ctx.post.id)();
      // Like the real one, YouTube's upload address is kept as soon as it's given.
      if (name === "youtube" && !ctx.delivery.publish_id) await ctx.progress(`upload:https://www.googleapis.com/upload/youtube/v3/videos?upload_id=${ctx.post.id}`);
      return { state: "sent", publishId: `${name}-${ctx.post.id}` };
    },
  });
  const planLimits = createPlanLimits({ db, now: () => clock, log: { error() {} }, ...(youtube ? { youtube } : {}) });
  const worker = createWorker({
    db,
    vault: { fresh: async () => ({ session }) },
    media: media ?? { postFile: async (_user, id) => ({ ...VIDEO, id }) },
    networks: { tiktok: network("tiktok"), youtube: network("youtube"), ...networks },
    planLimits,
    now: () => clock,
    log: { error() {} },
  });
  return {
    db,
    worker,
    calls,
    failing,
    planLimits,
    setLevel: (next) => (users[0].access_level = next),
    advance: (ms) => (clock += ms),
    rowsOf: (id) => db.tables.post_deliveries.filter((row) => row.post_id === id),
  };
}

async function runUntil(context, hours) {
  await context.worker.tick();
  const steps = Math.ceil((hours * HOUR) / (5 * 60_000));
  for (let index = 0; index < steps; index++) {
    context.advance(5 * 60_000);
    await context.worker.tick();
  }
}

test("a Free account's 11th waiting post, written past the dashboard, doesn't go out", async () => {
  const posts = Array.from({ length: 11 }, (_, index) => post(`p${index}`, 1 + index * 0.1));
  const context = setup({ posts });
  await runUntil(context, 3);
  assert.equal(context.calls.length, 10);
  const [last] = context.rowsOf("p10");
  assert.equal(last.state, "failed");
  assert.equal(last.error, OVER_SCHEDULED);
  assert.equal(last.attempts, 0);
});

test("the posts that come first keep their place, whatever order they were written in", async () => {
  // The latest one is listed first, as if it was written first.
  const posts = [post("late", 2), ...Array.from({ length: 10 }, (_, index) => post(`p${index}`, 1 + index * 0.05))];
  const context = setup({ posts });
  await runUntil(context, 3);
  assert.equal(context.rowsOf("late")[0].state, "failed");
  assert.equal(context.calls.length, 10);
});

test("each account has its own 10, and a paid plan has no limit", async () => {
  const many = (prefix, extra) => Array.from({ length: 12 }, (_, index) => post(`${prefix}${index}`, 1 + index * 0.05, extra));
  const free = setup({ posts: [...many("t"), ...many("y", { platforms: ["youtube"] })], youtube: { 1: 100, 2: 100, 3: 100, 4: 100 } });
  await runUntil(free, 2);
  assert.equal(free.calls.filter((call) => call.name === "tiktok").length, 10);
  assert.equal(free.calls.filter((call) => call.name === "youtube").length, 10);

  const paid = setup({ posts: many("t"), level: 2 });
  await runUntil(paid, 2);
  assert.equal(paid.calls.length, 12);
});

test("a post due within minutes, or a repeating one, counts as the dashboard counts it", () => {
  const at = T0;
  assert.equal(isWaiting(post("soon", 0.05).post, "UTC", at), false);
  assert.equal(isWaiting(post("later", 1).post, "UTC", at), true);
  assert.equal(isWaiting(post("past", -1, { recurrence: "every:1:day" }).post, "UTC", at), true);
  assert.equal(isWaiting(post("ended", -48, { recurrence: "every:1:day", recurrenceEnd: "2026-10-11" }).post, "UTC", at), false);
  assert.equal(isWaiting(post("paused", 1, { paused: true }).post, "UTC", at), false);
  for (const recurrenceEnd of ["1", "0000", 20261011, ["2026-10-11"]]) assert.equal(isWaiting(post("odd end", -48, { recurrence: "every:1:day", recurrenceEnd }).post, "UTC", at), true);
});

test("posts already waiting stay allowed when the plan gets smaller", async () => {
  const posts = Array.from({ length: 12 }, (_, index) => post(`p${index}`, 1 + index * 0.05));
  const context = setup({ posts, level: 3 });
  await context.worker.tick();
  context.setLevel(1);
  await runUntil(context, 2);
  assert.equal(context.calls.length, 12);
});

test("a post over the limit goes out after its owner upgrades", async () => {
  const posts = Array.from({ length: 11 }, (_, index) => post(`p${index}`, 1 + index * 0.01));
  const context = setup({ posts });
  await runUntil(context, 1.2);
  assert.equal(context.rowsOf("p10")[0].state, "failed");
  context.setLevel(2);
  await runUntil(context, 0.2);
  assert.equal(context.rowsOf("p10")[0].state, "sent");
  assert.equal(context.calls.length, 11);
});

test("Post now sends a post that was over the limit", async () => {
  const posts = Array.from({ length: 11 }, (_, index) => post(`p${index}`, 1 + index));
  const context = setup({ posts });
  await context.worker.tick();
  assert.equal(context.planLimits.over("u1", "w1", "p10", "tt1"), true);
  await context.worker.request("u1", "p10");
  await context.worker.tick();
  assert.deepEqual(context.calls.map((call) => call.post), ["p10"]);
});

test("a slot freed by a post going out, moving to drafts or pausing takes a new post", async () => {
  const posts = Array.from({ length: 10 }, (_, index) => post(`p${index}`, 1 + index));
  const context = setup({ posts });
  await context.worker.tick();
  posts.push(post("new", 20));
  await context.worker.tick();
  assert.equal(context.planLimits.over("u1", "w1", "new", "tt1"), true);
  posts[0].post.status = "draft";
  posts.at(-1).post.status = "draft";
  await context.worker.tick();
  posts.at(-1).post.status = "scheduled";
  await context.worker.tick();
  assert.equal(context.planLimits.over("u1", "w1", "new", "tt1"), false);
  assert.equal(context.db.tables.publisher_waiting.length, 10);
});

test("a paused post comes back as new, so pausing doesn't make room for more than 10", async () => {
  const posts = Array.from({ length: 10 }, (_, index) => post(`p${index}`, 1 + index));
  const context = setup({ posts });
  await context.worker.tick();
  posts[0].post.paused = true;
  posts.push(post("new", 20));
  await context.worker.tick();
  assert.equal(context.planLimits.over("u1", "w1", "new", "tt1"), false);
  posts[0].post.paused = false;
  await context.worker.tick();
  assert.equal(context.planLimits.over("u1", "w1", "p0", "tt1"), true);
});

test("what the publisher saw survives a restart", async () => {
  const posts = Array.from({ length: 11 }, (_, index) => post(`p${index}`, 1 + index));
  const context = setup({ posts });
  await context.worker.tick();
  const again = createPlanLimits({ db: context.db, now: () => T0, log: { error() {} } });
  posts.reverse();
  await again.review(posts.map((item) => ({ ...item, post_id: item.post.id, connection_id: "tt1", waiting: true, start: 0 })));
  assert.equal(again.over("u1", "w1", "p10", "tt1"), true);
  assert.equal(again.over("u1", "w1", "p0", "tt1"), false);
});

test("a database without the plan tables leaves posts going out as before", async () => {
  const posts = Array.from({ length: 11 }, (_, index) => post(`p${index}`, 0.1 + index * 0.01));
  const context = setup({ posts });
  const select = context.db.select;
  context.db.select = async (table, ...rest) => {
    if (table === "publisher_waiting") throw new PublishError("The database refused GET publisher_waiting: relation does not exist");
    return select.call(context.db, table, ...rest);
  };
  await runUntil(context, 0.5);
  assert.equal(context.calls.length, 11);
});

test("a Free owner's YouTube uploads wait once the day's share is used, then go", async () => {
  const posts = Array.from({ length: 4 }, (_, index) => post(`v${index}`, 0.1 + index * 0.01, { platforms: ["youtube"] }));
  const context = setup({ posts });
  await runUntil(context, 0.5);
  assert.equal(context.calls.length, 3);
  const [waiting] = context.rowsOf("v3");
  assert.equal(waiting.state, "queued");
  assert.equal(waiting.attempts, 0);
  assert.match(waiting.error, /up to 3 YouTube videos a day/);
  await runUntil(context, 24);
  assert.equal(context.rowsOf("v3")[0].state, "sent");
  assert.equal(context.calls.length, 4);
  assert.equal(context.db.tables.publisher_uploads.length, 4);
});

test("a YouTube upload waiting for the day's share, then moved later, drops the reason it waited", async () => {
  const posts = Array.from({ length: 4 }, (_, index) => post(`v${index}`, 0.1 + index * 0.01, { platforms: ["youtube"] }));
  const context = setup({ posts });
  await runUntil(context, 0.5);
  assert.match(context.rowsOf("v3")[0].error, /up to 3 YouTube videos a day/);
  const later = new Date(T0 + 48 * HOUR);
  Object.assign(posts[3].post, { day: later.toISOString().slice(0, 10), start: later.toISOString().slice(11, 16) });
  await runUntil(context, 25);
  const [moved] = context.rowsOf("v3");
  assert.equal(moved.state, "queued");
  assert.equal(moved.error, null);
  assert.equal(moved.due_at, later.toISOString());
  assert.equal(context.calls.length, 3);
});

test("a YouTube upload an earlier try started carries on without taking another", async () => {
  const context = setup({ posts: [post("v", 0.1, { platforms: ["youtube"] })] });
  const planLimits = { over: () => false, review: async () => undefined, uploadWait: async () => assert.fail("checked again"), countUpload: async () => assert.fail("counted again") };
  const worker = createWorker({
    db: context.db,
    vault: { fresh: async () => ({ session: {} }) },
    media: { postFile: async (_user, id) => ({ ...VIDEO, id }) },
    networks: { youtube: { needsFile: true, send: async () => ({ state: "sent", publishId: "done" }) } },
    planLimits,
    now: () => T0 + HOUR,
    log: { error() {} },
  });
  await worker.plan();
  context.db.tables.post_deliveries[0].publish_id = "upload:https://upload.test/1";
  await worker.tick();
  assert.equal(context.db.tables.post_deliveries[0].state, "sent");
});

test("a YouTube upload that fails before YouTube starts it doesn't use up the day's uploads", async () => {
  const posts = [post("bad", 0.1, { platforms: ["youtube"] }), ...Array.from({ length: 3 }, (_, index) => post(`v${index}`, 2 + index * 0.01, { platforms: ["youtube"] }))];
  const context = setup({ posts });
  context.failing.set("bad", () => new PublishError("Couldn't reach YouTube. Trying again soon.", { retry: true }));
  await runUntil(context, 3);
  const [bad] = context.rowsOf("bad");
  assert.equal(bad.state, "failed");
  assert.equal(bad.attempts, 4);
  assert.equal(context.calls.filter((call) => call.post === "bad").length, 4);
  for (const id of ["v0", "v1", "v2"]) assert.equal(context.rowsOf(id)[0].state, "sent");
  assert.equal(context.db.tables.publisher_uploads.length, 3);
});

function realYouTubeSetup(t, posts, answer) {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    asked.push({ url: String(url), method: init.method ?? "GET", range: init.headers?.["Content-Range"] });
    return answer(asked.at(-1), asked.length);
  });
  const context = setup({
    posts,
    networks: { youtube: realYouTube },
    media: { postFile: async (_user, id) => ({ ...VIDEO, id }), bytes: async (_key, start, end) => Buffer.alloc(end - start + 1) },
    session: { accessToken: "ya29.test" },
  });
  return { ...context, asked };
}

const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";
const started = () => new Response(null, { status: 200, headers: { location: UPLOAD } });

test("YouTube out of reach on every try uses none of the day's uploads", async (t) => {
  const context = realYouTubeSetup(t, [post("v", 0.1, { platforms: ["youtube"], title: "Clip" })], async () => {
    throw new TypeError("fetch failed");
  });
  await runUntil(context, 2);
  const [row] = context.rowsOf("v");
  assert.equal(row.state, "failed");
  assert.equal(row.attempts, 4);
  assert.equal(context.asked.length, 4);
  assert.equal(context.db.tables.publisher_uploads.length, 0);
});

test("YouTube refusing to start the upload uses none of the day's uploads", async (t) => {
  const context = realYouTubeSetup(t, [post("v", 0.1, { platforms: ["youtube"], title: "Clip" })], async () =>
    Response.json({ error: { message: "The request cannot be completed because you have exceeded your quota." } }, { status: 403 }),
  );
  await runUntil(context, 1);
  assert.equal(context.rowsOf("v")[0].state, "failed");
  assert.equal(context.db.tables.publisher_uploads.length, 0);
});

test("an upload YouTube started counts once, though it takes another try to finish", async (t) => {
  const context = realYouTubeSetup(t, [post("v", 0.1, { platforms: ["youtube"], title: "Clip" })], async (request, count) => {
    if (count === 1) return started();
    if (count === 2) throw new TypeError("socket hang up");
    if (request.range === "bytes */10") return new Response(null, { status: 308 });
    return Response.json({ id: "vid1" }, { status: 200 });
  });
  await runUntil(context, 1);
  const [row] = context.rowsOf("v");
  assert.equal(row.state, "sent");
  assert.equal(row.attempts, 2);
  assert.equal(row.url, "https://www.youtube.com/watch?v=vid1");
  assert.equal(context.db.tables.publisher_uploads.length, 1);
});

test("a Free owner with the day's uploads used doesn't ask YouTube at all", async (t) => {
  const context = realYouTubeSetup(t, [post("v", 0.1, { platforms: ["youtube"], title: "Clip" })], async () => assert.fail("asked YouTube"));
  for (let index = 0; index < 3; index++) context.db.tables.publisher_uploads.push({ user_id: "u1", platform: "youtube", at: new Date(T0 - HOUR).toISOString() });
  await runUntil(context, 1);
  const [row] = context.rowsOf("v");
  assert.equal(row.state, "queued");
  assert.equal(row.attempts, 0);
  assert.equal(context.db.tables.publisher_uploads.length, 3);
});

test("uploads a day can be set per plan, with defaults for anything left out", () => {
  assert.deepEqual(uploadsPerDay("5,20"), { 1: 5, 2: 20, 3: 100, 4: 200 });
  assert.deepEqual(uploadsPerDay(undefined), { 1: 3, 2: 50, 3: 100, 4: 200 });
  assert.deepEqual(uploadsPerDay("x,,0"), { 1: 3, 2: 50, 3: 0, 4: 200 });
});

test("old uploads are pruned once they no longer count", async () => {
  const context = setup();
  context.db.tables.publisher_uploads.push({ user_id: "u1", platform: "youtube", at: new Date(T0 - 3 * 24 * HOUR).toISOString() });
  context.db.tables.publisher_uploads.push({ user_id: "u1", platform: "youtube", at: new Date(T0 - HOUR).toISOString() });
  await context.planLimits.prune();
  assert.equal(context.db.tables.publisher_uploads.length, 1);
});

const legacy = (connectionId) => ({ user_id: "u1", connection_id: connectionId, platform: "tiktok", session: { openId: "o", accessToken: "a", refreshToken: "r", expiresAt: 1 } });

function adopter(limit, found, kept = []) {
  const db = fakeDb();
  db.rpc = async () => found;
  const vault = {
    list: async () => kept.map((connectionId) => ({ connectionId, platform: "tiktok" })),
    put: async (_user, connectionId) => {
      if (!kept.includes(connectionId)) kept.push(connectionId);
    },
  };
  const worker = createWorker({ db, vault, media: {}, networks: {}, accountLimits: { limitFor: async () => limit } });
  return { worker, kept };
}

test("logins found in account state are kept only while the plan has room", async () => {
  const { worker, kept } = adopter(3, ["a", "b", "c", "d", "e"].map(legacy));
  assert.equal(await worker.adopt(), 3);
  assert.deepEqual(kept, ["a", "b", "c"]);
});

test("a login found for an account already connected is still kept when the plan is full", async () => {
  const { worker, kept } = adopter(1, [legacy("a")], ["a", "b"]);
  assert.equal(await worker.adopt(), 1);
  assert.deepEqual(kept, ["a", "b"]);
});

test("logins found in account state wait when the plan can't be read", async () => {
  const { worker, kept } = adopter(undefined, [legacy("a")]);
  assert.equal(await worker.adopt(), 0);
  assert.deepEqual(kept, []);
});

test("two connects at once can't both take the last place", async () => {
  const kept = [];
  const vault = {
    list: async () => kept.map((connectionId) => ({ connectionId })),
    put: async (connectionId) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      kept.push(connectionId);
    },
  };
  const limits = createAccountLimits({ selectOne: async () => ({ access_level: 1 }) });
  kept.push("a", "b");
  const connect = (id) => connectWithin({ vault, limits, userId: "u1", connectionId: id }, () => vault.put(id));
  const answers = await Promise.all([connect("c"), connect("d")]);
  assert.deepEqual(answers.sort(), [3, null].sort());
  assert.equal(kept.length, 3);
  const broken = connectWithin({ vault, limits: undefined, userId: "u1", connectionId: "e" }, async () => {
    throw new Error("down");
  });
  await assert.rejects(broken);
  assert.equal(await connectWithin({ vault, limits: undefined, userId: "u1", connectionId: "e" }, async () => undefined), null);
});

// The dashboard knows a run held back by the plan by these words, to show them translated and offer Upgrade.
const DASHBOARD = new URL("../../apps/web/src/components/publish/publisher.ts", import.meta.url);
test("the dashboard has the over-the-limit message word for word", { skip: !existsSync(DASHBOARD) && "no web app here" }, () => {
  const [, text] = readFileSync(DASHBOARD, "utf8").match(/export const OVER_PLAN = msg\(\s*("(?:[^"\\]|\\.)*")/) ?? [];
  assert.equal(text && JSON.parse(text), OVER_SCHEDULED);
});

test("a post whose day or time isn't text has no start, rather than throwing", () => {
  for (const odd of [{ day: ["2026-10-27"], start: "10:00" }, { day: "2026-10-27", start: ["10:00"] }, { day: 20261027, start: "10:00" }, { day: { y: 1 }, start: "10:00" }]) {
    assert.equal(startOf(odd, "UTC"), null, JSON.stringify(odd));
    assert.equal(isWaiting({ status: "scheduled", ...odd }, "UTC", Date.parse("2026-10-12T00:00:00Z")), false);
  }
  assert.equal(startOf({ day: "2026-10-27", start: "10:00" }, "UTC"), Date.parse("2026-10-27T10:00:00Z"));
});
