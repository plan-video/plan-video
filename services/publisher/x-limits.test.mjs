import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createX, hasLink } from "./networks/x.mjs";
import { X_LINK_POSTS_BY_LEVEL, X_POSTS_BY_LEVEL, byLevel, createPlanLimits } from "./plans.mjs";
import { createWorker } from "./worker.mjs";

const T0 = Date.parse("2026-10-16T12:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function setup(level = 2) {
  let clock = T0;
  const users = [{ id: "u1", access_level: level }];
  const db = fakeDb({ users });
  const limits = createPlanLimits({ db, now: () => clock, log: { error() {} } });
  const made = (count, ago, link = false) => {
    const at = new Date(clock - ago).toISOString();
    for (let index = 0; index < count; index++) {
      db.tables.publisher_uploads.push({ user_id: "u1", platform: "x", at });
      if (link) db.tables.publisher_uploads.push({ user_id: "u1", platform: "xlink", at });
    }
  };
  return { db, limits, made, users, advance: (ms) => (clock += ms) };
}

const refusal = async (promise) => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof PublishError);
    return error;
  }
  assert.fail("it was allowed");
};

test("links are found with or without https://, and file names aren't links", () => {
  for (const text of ["See https://plan.video", "www.example.com", "out now on plan.video!", "shop at example.co.uk/sale", "(example.com)", "Visit Plan.Video."]) {
    assert.equal(hasLink(text), true, text);
  }
  for (const text of ["Just words.", "Built with Next.js and Node.js", "read notes.md", "e.g. this", "U.S. news", "v1.2.3 is out", "3.14 is pi", "@someone.else", "#tag.here", "end.", "clip.mp4"]) {
    assert.equal(hasLink(text), false, text);
  }
});

test("Free can't post to X at all", async () => {
  const { limits } = setup(1);
  const error = await refusal(limits.xAllowed("u1", false));
  assert.equal(error.retry, false);
  assert.match(error.message, /paid plan/);
});

test("an owner without a plan row is on Free", async () => {
  const { limits, users } = setup();
  users.length = 0;
  await refusal(limits.xAllowed("u1", false));
});

test("Creator posts up to 150 times in 30 days, and the post fails past that", async () => {
  const { limits, made, advance } = setup(2);
  made(149, 20 * DAY);
  await limits.xAllowed("u1", false);
  made(1, 10 * DAY);
  const error = await refusal(limits.xAllowed("u1", false));
  assert.equal(error.retry, false);
  assert.equal(error.until, null);
  assert.match(error.message, /150 times in 30 days.*in 10 days/);
  advance(10 * DAY + HOUR);
  await limits.xAllowed("u1", false);
});

test("links have their own, much smaller limit", async () => {
  const { limits, made } = setup(2);
  made(9, 2 * DAY, true);
  await limits.xAllowed("u1", true);
  made(1, DAY, true);
  const error = await refusal(limits.xAllowed("u1", true));
  assert.equal(error.retry, false);
  assert.match(error.message, /10 X posts with a link in 30 days.*Take the link out.*in 28 days/);
  await limits.xAllowed("u1", false);
});

test("each plan gets more, and the numbers can be set in publisher.env", async () => {
  assert.deepEqual(X_POSTS_BY_LEVEL, { 1: 0, 2: 150, 3: 400, 4: 800 });
  assert.deepEqual(X_LINK_POSTS_BY_LEVEL, { 1: 0, 2: 10, 3: 25, 4: 40 });
  assert.deepEqual(byLevel("0,100", X_POSTS_BY_LEVEL), { 1: 0, 2: 100, 3: 400, 4: 800 });
  assert.deepEqual(byLevel(",,,5000", X_POSTS_BY_LEVEL), { 1: 0, 2: 150, 3: 400, 4: 1000 });

  const { db, made } = setup(3);
  const limits = createPlanLimits({ db, now: () => T0, log: { error() {} }, x: { posts: byLevel("0,150,2", X_POSTS_BY_LEVEL), links: X_LINK_POSTS_BY_LEVEL } });
  made(2, HOUR);
  await refusal(limits.xAllowed("u1", false));
});

test("a plan set to no links refuses any post with one", async () => {
  const { db } = setup(2);
  const limits = createPlanLimits({ db, now: () => T0, log: { error() {} }, x: { posts: X_POSTS_BY_LEVEL, links: { 1: 0, 2: 0, 3: 0, 4: 0 } } });
  assert.match((await refusal(limits.xAllowed("u1", true))).message, /doesn't post links/);
  await limits.xAllowed("u1", false);
});

test("past 50 today the post waits for one to free up, instead of failing", async () => {
  const { limits, made } = setup(4);
  made(49, 5 * HOUR);
  await limits.xAllowed("u1", false);
  made(1, HOUR);
  const error = await refusal(limits.xAllowed("u1", false));
  assert.equal(error.retry, true);
  assert.equal(error.until, T0 - 5 * HOUR + DAY);
});

test("a count that can't be read stops the post", async () => {
  const { db, limits } = setup(2);
  db.uploadsSince = async () => {
    throw new PublishError("The database didn't answer.", { retry: true });
  };
  assert.equal((await refusal(limits.xAllowed("u1", false))).retry, true);
});

test("X's counts are kept 31 days, YouTube's two", async () => {
  const { db, limits, made } = setup(2);
  made(1, 30 * DAY, true);
  made(1, 32 * DAY);
  db.tables.publisher_uploads.push({ user_id: "u1", platform: "youtube", at: new Date(T0 - 3 * DAY).toISOString() });
  await limits.prune();
  assert.deepEqual(db.tables.publisher_uploads.map((row) => row.platform).sort(), ["x", "xlink"]);
});

function realX(t, context) {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    asked.push({ url: String(url), body: init.body });
    return Response.json({ data: { id: "1001" } });
  });
  return { x: createX({ limits: context.limits, log: { error() {} } }), asked };
}

const send = (x, description) => x.send({ post: { description }, session: { accessToken: "a" }, files: [], media: {}, delivery: { user_id: "u1" } });

test("each post X makes is counted, and once more when it has a link", async (t) => {
  const context = setup(2);
  const { x, asked } = realX(t, context);
  assert.equal((await send(x, "Plain words")).state, "sent");
  assert.equal((await send(x, "New video at plan.video")).state, "sent");
  assert.equal(asked.length, 2);
  assert.deepEqual(context.db.tables.publisher_uploads.map((row) => row.platform), ["x", "x", "xlink"]);
});

test("a post over the limit never reaches X", async (t) => {
  const context = setup(2);
  context.made(10, DAY, true);
  const { x, asked } = realX(t, context);
  await refusal(send(x, "https://example.com"));
  assert.equal(asked.length, 0);
});

test("two posts at once can't both take the last one left", async (t) => {
  const context = setup(2);
  context.made(149, 2 * DAY);
  const { x, asked } = realX(t, context);
  const results = await Promise.allSettled([send(x, "One"), send(x, "Two")]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(asked.length, 1);
});

test("a post X may have made without saying so still counts", async (t) => {
  const context = setup(2);
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  const x = createX({ limits: context.limits, log: { error() {} } });
  await refusal(send(x, "Words"));
  assert.equal(context.db.tables.publisher_uploads.length, 1);
});

test("the worker holds a post past today's limit until one frees up, without using a try", async () => {
  const at = new Date(T0 + 10 * 60_000);
  const posts = [
    {
      user_id: "u1",
      workspace_id: "w1",
      time_zone: "UTC",
      connections: [{ id: "x1", platform: "x" }],
      post: { id: "p", day: at.toISOString().slice(0, 10), start: at.toISOString().slice(11, 16), timeZone: "UTC", status: "scheduled", platforms: ["x"], description: "Hi" },
    },
  ];
  let clock = T0;
  const db = fakeDb({ posts, users: [{ id: "u1", access_level: 2 }] });
  const until = T0 + 5 * HOUR;
  const worker = createWorker({
    db,
    vault: { fresh: async () => ({ session: {} }) },
    media: { postFile: async () => null },
    networks: {
      x: {
        needsFile: false,
        async send() {
          throw new PublishError("Today's are used.", { retry: true, until });
        },
      },
    },
    now: () => clock,
    log: { error() {} },
  });
  await worker.tick();
  clock += 15 * 60_000;
  await worker.tick();
  const [row] = db.tables.post_deliveries.filter((item) => item.post_id === "p");
  assert.equal(row.state, "queued");
  assert.equal(row.attempts, 0);
  assert.equal(row.error, "Today's are used.");
  assert.equal(Date.parse(row.next_at), until);
});
