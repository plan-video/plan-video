import assert from "node:assert/strict";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { createX } from "./networks/x.mjs";
import { createPlanLimits } from "./plans.mjs";
import { createPlugs } from "./plugs.mjs";
import { createWorker } from "./worker.mjs";

const T0 = Date.parse("2026-11-24T12:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const BEFORE = new Date(T0 - DAY).toISOString();

const repostPlug = { accountId: "x1", kind: "auto-repost", likes: 10, activated: true, createdAt: BEFORE };
const replyPlug = { accountId: "x1", kind: "auto-plug", likes: 10, message: "My newsletter: plan.video/news", activated: true, createdAt: BEFORE };

/** The post goes out at T0 + 10 minutes; `answer` stands in for X past posting it. */
function setup(t, { plugs, likes = () => 0, answer = () => undefined, level = 2 }) {
  let clock = T0;
  const at = new Date(T0 + 10 * 60_000);
  const posts = [
    {
      user_id: "u1",
      workspace_id: "w1",
      time_zone: "UTC",
      connections: [{ id: "x1", platform: "x" }],
      plugs,
      post: { id: "p", day: at.toISOString().slice(0, 10), start: at.toISOString().slice(11, 16), timeZone: "UTC", status: "scheduled", platforms: ["x"], description: "Hi" },
    },
  ];
  const db = fakeDb({ posts, users: [{ id: "u1", access_level: level }] });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const answered = await answer(call);
    if (answered) return answered;
    if (call.method === "GET") return Response.json({ data: { id: "1001", public_metrics: { like_count: likes() } } });
    if (call.url.endsWith("/retweets")) return Response.json({ data: { retweeted: true } });
    return Response.json({ data: { id: call.body.reply ? "2002" : "1001" } });
  });
  const log = { error() {}, warn() {} };
  const limits = createPlanLimits({ db, now: () => clock, log });
  const x = createX({ limits, log });
  const publisher = () =>
    createWorker({
      db,
      vault: { fresh: async () => ({ session: { accessToken: "a", xUserId: "42" } }) },
      media: { postFile: async () => null },
      networks: { x },
      plugs: createPlugs({ x }),
      planLimits: limits,
      now: () => clock,
      log,
    });
  const worker = publisher();
  const row = () => db.tables.post_deliveries.find((item) => item.post_id === "p");
  return {
    db,
    worker,
    publisher,
    row,
    reads: () => calls.filter((call) => call.method === "GET"),
    reposts: () => calls.filter((call) => call.url.endsWith("/retweets")),
    replies: () => calls.filter((call) => call.body?.reply),
    counted: () => db.tables.publisher_uploads.map((item) => item.platform),
    async send() {
      await worker.tick();
      clock += 15 * 60_000;
      await worker.tick();
      assert.equal(row().state, "sent");
    },
    /** Runs each check as it comes due, sending the post first if it hasn't gone. */
    async checks(count) {
      if (row()?.state !== "sent") await this.send();
      for (let index = 0; index < count; index++) {
        this.toNextCheck();
        await worker.tick();
      }
    },
    toNextCheck: () => (clock = Math.max(clock, Date.parse(row().next_at))),
    advance: (ms) => (clock += ms),
  };
}

test("X takes plugs only once its network is set up", () => {
  assert.deepEqual(createPlugs().platforms, ["bluesky"]);
  assert.deepEqual(createPlugs({ x: createX({ limits: {} }) }).platforms, ["bluesky", "x"]);
});

test("on X, a post that reaches the likes is reposted and replied to once, and both count as X posts", async (t) => {
  let likes = 4;
  const w = setup(t, { plugs: [repostPlug, replyPlug], likes: () => likes });
  await w.checks(1);
  assert.equal(w.reposts().length + w.replies().length, 0);
  likes = 12;
  await w.checks(2);
  assert.equal(w.reposts().length, 1);
  assert.equal(w.reposts()[0].url, "https://api.x.com/2/users/42/retweets");
  assert.deepEqual(w.reposts()[0].body, { tweet_id: "1001" });
  assert.equal(w.replies().length, 1);
  assert.deepEqual(w.replies()[0].body, { text: "My newsletter: plan.video/news", reply: { in_reply_to_tweet_id: "1001" } });
  assert.deepEqual(w.row().plugs_done, ["auto-repost", "auto-plug"]);
  // The post itself, then the repost, then the reply with its link.
  assert.deepEqual(w.counted(), ["x", "x", "x", "xlink"]);
  // Nothing was left to wait for, so the last check didn't read X.
  assert.equal(w.reads().length, 2);
  assert.equal(w.row().plug_checks, 3);
});

test("a plug done before another fails isn't done again at the next check", async (t) => {
  let refuse = true;
  const w = setup(t, {
    plugs: [repostPlug, replyPlug],
    likes: () => 50,
    answer: (call) => (call.body?.reply && refuse ? Response.json({ detail: "You can't reply to this post." }, { status: 403 }) : undefined),
  });
  await w.checks(1);
  assert.deepEqual(w.row().plugs_done, ["auto-repost"]);
  assert.equal(w.row().plug_checks, 1);
  refuse = false;
  await w.checks(1);
  assert.equal(w.reposts().length, 1);
  assert.equal(w.replies().length, 2);
  assert.deepEqual(w.row().plugs_done, ["auto-repost", "auto-plug"]);
});

test("a plug's reply X may have made is never sent again, and still counts", async (t) => {
  const w = setup(t, {
    plugs: [replyPlug],
    likes: () => 50,
    answer: (call) => {
      if (call.body?.reply) throw new TypeError("fetch failed");
    },
  });
  await w.checks(3);
  assert.equal(w.replies().length, 1);
  assert.deepEqual(w.row().plugs_done, ["auto-plug"]);
  assert.deepEqual(w.counted(), ["x", "x", "xlink"]);
});

test("a plug's reply X refuses as a duplicate isn't kept as done", async (t) => {
  const w = setup(t, {
    plugs: [replyPlug],
    likes: () => 50,
    answer: (call) => (call.body?.reply ? Response.json({ detail: "You are not allowed to create a Tweet with duplicate content." }, { status: 403 }) : undefined),
  });
  await w.checks(1);
  assert.equal(w.replies().length, 1);
  assert.deepEqual(w.row().plugs_done, []);
});

test("two publishers checking a post at once repost and reply once", async (t) => {
  const w = setup(t, { plugs: [repostPlug, replyPlug], likes: () => 50 });
  await w.send();
  const other = w.publisher();
  w.toNextCheck();
  await Promise.all([w.worker.tick(), other.tick()]);
  assert.equal(w.reposts().length, 1);
  assert.equal(w.replies().length, 1);
  assert.deepEqual(w.row().plugs_done, ["auto-repost", "auto-plug"]);
});

test("a plug's reply X made is never sent again when keeping it fails", async (t) => {
  const w = setup(t, { plugs: [replyPlug], likes: () => 50 });
  await w.send();
  const update = w.db.update.bind(w.db);
  t.mock.method(w.db, "update", async (table, filter, values) => {
    if (values.plugs_done && w.replies().length) throw new Error("database unreachable");
    return update(table, filter, values);
  });
  await w.checks(3);
  assert.equal(w.replies().length, 1);
});

test("plugs stop once the owner moves to Free, without reading X", async (t) => {
  const w = setup(t, { plugs: [repostPlug, replyPlug], likes: () => 50 });
  await w.send();
  w.db.tables.user_data[0].access_level = 1;
  await w.checks(1);
  assert.equal(w.reads().length, 0);
  assert.equal(w.reposts().length + w.replies().length, 0);
  assert.equal(w.row().plug_checks, 3);
});

test("a plug past the plan's X posts never reaches X", async (t) => {
  const w = setup(t, { plugs: [repostPlug], likes: () => 50 });
  await w.send();
  const at = new Date(T0).toISOString();
  for (let index = 0; index < 149; index++) w.db.tables.publisher_uploads.push({ user_id: "u1", platform: "x", at });
  await w.checks(3);
  assert.equal(w.reposts().length, 0);
  assert.deepEqual(w.row().plugs_done, []);
  assert.equal(w.row().plug_checks, 3);
});

test("a look at X that fails for now is tried again until the next check, then waits for it", async (t) => {
  const w = setup(t, { plugs: [repostPlug], answer: (call) => (call.method === "GET" ? Response.json({ title: "Too Many Requests" }, { status: 429 }) : undefined) });
  await w.send();
  const sentAt = Date.parse(w.row().updated_at);
  w.advance(6 * HOUR);
  for (let index = 0; index < 40 && w.row().plug_checks === 0; index++) {
    await w.worker.tick();
    w.advance(15 * 60_000);
  }
  assert.equal(w.row().plug_checks, 1);
  assert.ok(w.reads().length <= 24, `${w.reads().length} looks in one check`);
  assert.equal(Date.parse(w.row().next_at), sentAt + 12 * HOUR);
});

test("a plug's reply X would count as over 280 never reaches X", async (t) => {
  const w = setup(t, { plugs: [{ ...replyPlug, message: "あ".repeat(141) }], likes: () => 50 });
  await w.checks(3);
  assert.equal(w.replies().length, 0);
  assert.deepEqual(w.row().plugs_done, []);
});

test("a post deleted on X ends its plugs, without being read again", async (t) => {
  const w = setup(t, { plugs: [repostPlug, replyPlug], answer: (call) => (call.method === "GET" ? Response.json({ title: "Not Found Error" }, { status: 404 }) : undefined) });
  await w.checks(3);
  assert.equal(w.reads().length, 1);
  assert.equal(w.reposts().length + w.replies().length, 0);
  assert.equal(w.row().plug_checks, 3);
});
