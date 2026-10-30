// The publisher looks at a post only when it changed or its next run has come
// (post_schedule), instead of reading every post every pass: its next look,
// its runs missed while it was down, the Free plan's waiting posts counted a
// post at a time, the hourly look that puts a wrong next look right, and a
// one-off post marked posted once every network has it.

import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { OVER_SCHEDULED, createPlanLimits } from "./plans.mjs";
import { GRACE_MS, LATE, createWorker } from "./worker.mjs";

const T0 = Date.parse("2026-10-12T16:00:00Z");
const HOUR = 60 * 60_000;

/** A post on X account x1, `hours` from T0. */
const post = (id, hours, extra = {}) => {
  const at = new Date(T0 + hours * HOUR);
  return {
    user_id: "u1",
    workspace_id: "w1",
    time_zone: "UTC",
    connections: [{ id: "x1", platform: "x" }, { id: "bs1", platform: "bluesky" }],
    post: { id, day: at.toISOString().slice(0, 10), start: at.toISOString().slice(11, 16), timeZone: "UTC", status: "scheduled", platforms: ["x"], ...extra },
  };
};

function setup({ posts = [], level = 1, send } = {}) {
  let clock = T0;
  const db = fakeDb({ posts, users: [{ id: "u1", access_level: level }] });
  const sent = [];
  const network = (name) => ({
    needsFile: false,
    async send(ctx) {
      sent.push(`${name}:${ctx.post.id}`);
      return send ? send(name, ctx) : { state: "sent", publishId: `${name}-${ctx.post.id}` };
    },
  });
  const read = [];
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => {
    const rows = await rpc(name, args);
    if (name === "publisher_due") read.push(...rows.map((row) => row.post_id));
    return rows;
  };
  const errors = [];
  const start = () => {
    const planLimits = createPlanLimits({ db, now: () => clock, log: { error: (...args) => errors.push(args) } });
    return createWorker({
      db,
      vault: { fresh: async () => ({ session: {} }) },
      media: { postFile: async () => null },
      networks: { x: network("x"), bluesky: network("bluesky") },
      planLimits,
      now: () => clock,
      log: { error: (...args) => errors.push(args) },
    });
  };
  return { db, worker: start(), restart: start, sent, read, errors, posts, advance: (ms) => (clock += ms), setClock: (time) => (clock = time), now: () => clock };
}

test("a post is read when it's new, then not again until its run comes", async () => {
  const context = setup({ posts: [post("later", 3), post("draft", 1, { status: "draft" })] });
  await context.worker.tick();
  assert.deepEqual(context.read.sort(), ["draft", "later"]);
  assert.equal(context.db.look("u1", "later").next_run_at, new Date(T0 + 3 * HOUR).toISOString());
  assert.equal(context.db.look("u1", "draft").next_run_at, null, "a draft has no run to look at");
  context.read.length = 0;
  for (let step = 0; step < 10; step++) {
    context.advance(10 * 60_000);
    await context.worker.tick();
  }
  assert.deepEqual(context.read, [], "nothing read while nothing changed or came due");
  context.setClock(T0 + 3 * HOUR);
  await context.worker.tick();
  assert.deepEqual(context.read, ["later"]);
  assert.deepEqual(context.sent, ["x:later"]);
  // Marked posted, which is a change: looked at once more, and then it has nothing left.
  assert.equal(context.posts[0].post.status, "posted");
  await context.worker.tick();
  assert.equal(context.db.look("u1", "later").next_run_at, null);
  context.read.length = 0;
  context.advance(HOUR);
  await context.worker.tick();
  assert.deepEqual(context.read, []);
});

test("the next look is the post's next run, so a pass can be woken for it", async () => {
  const context = setup({ posts: [post("soon", 1 / 60), post("hour", 1)] });
  await context.worker.tick();
  assert.equal(context.worker.nextRun(), T0 + 60_000);
  context.setClock(T0 + 60_000);
  await context.worker.tick();
  assert.deepEqual(context.sent, ["x:soon"]);
  assert.equal(context.worker.nextRun(), null, "the next one is past the two minutes a pass looks ahead");
});

test("a repeating post's next look moves to its next run each time", async () => {
  const context = setup({ posts: [post("daily", 1, { recurrence: "every:1:day" })] });
  await context.worker.tick();
  for (let day = 0; day < 3; day++) {
    const due = T0 + HOUR + day * 24 * HOUR;
    assert.equal(context.db.look("u1", "daily").next_run_at, new Date(due).toISOString());
    context.setClock(due);
    await context.worker.tick();
  }
  assert.deepEqual(context.sent, ["x:daily", "x:daily", "x:daily"]);
  assert.equal(context.db.look("u1", "daily").next_run_at, new Date(T0 + HOUR + 3 * 24 * HOUR).toISOString());
});

test("an edited post is looked at again at once, and its next look follows the edit", async () => {
  const context = setup({ posts: [post("moved", 5)] });
  await context.worker.tick();
  context.read.length = 0;
  Object.assign(context.posts[0].post, { start: "18:30" });
  await context.worker.tick();
  assert.deepEqual(context.read, ["moved"]);
  assert.equal(context.db.look("u1", "moved").next_run_at, "2026-10-12T18:30:00.000Z");
  // Moved to now: it goes in the same pass.
  Object.assign(context.posts[0].post, { start: "16:00", sendFrom: new Date(T0).toISOString() });
  await context.worker.tick();
  assert.deepEqual(context.sent, ["x:moved"]);
});

test("a post changed while the publisher looked at it keeps its next look at once", async () => {
  const context = setup({ posts: [post("busy", 2)] });
  const rpc = context.db.rpc.bind(context.db);
  context.db.rpc = async (name, args) => {
    // The browser saves an edit after the publisher read the post, before it keeps its next look.
    if (name === "publisher_schedule") Object.assign(context.posts[0].post, { title: "Edited meanwhile" });
    return rpc(name, args);
  };
  let reads = 0;
  const read = context.db.rpc.bind(context.db);
  context.db.rpc = async (name, args) => {
    if (name === "publisher_due") reads++;
    return read(name, args);
  };
  await context.worker.plan();
  assert.equal(context.db.look("u1", "busy").next_run_at, new Date(0).toISOString(), "still due at once");
  assert.equal(reads, 1);
  // The next pass isn't woken straight away for it.
  assert.ok(context.worker.nextRun() >= context.now() + 1000);
});

test("a full page of posts all changed while the publisher looked at them doesn't keep the pass going round", async () => {
  const context = setup({ posts: Array.from({ length: 200 }, (_, index) => post(`p${index}`, 2)) });
  let reads = 0;
  const rpc = context.db.rpc.bind(context.db);
  context.db.rpc = async (name, args) => {
    if (name === "publisher_due") reads++;
    // Every one of them is saved again after the publisher read it.
    if (name === "publisher_schedule") for (const item of context.posts) item.post.title = `${item.post.title}!`;
    return rpc(name, args);
  };
  await context.worker.plan();
  // The second page is the same posts again: the pass leaves them for the next one.
  assert.equal(reads, 2);
});

test("a post saved on a device with a fast clock still goes out when the publisher looks late", async () => {
  // Saved at 16:00 on a device an hour fast, due at 16:30; the publisher sees it at once, then misses 16:30 by ten minutes.
  const context = setup({ posts: [post("fast", 0.5, { sendFrom: new Date(T0 + HOUR).toISOString() })] });
  await context.worker.tick();
  context.setClock(T0 + 40 * 60_000);
  await context.db.rpc("publisher_look_again", { owner: "u1" });
  await context.worker.tick();
  assert.deepEqual(context.sent, ["x:fast"]);
});

test("a deleted post is looked at once more, and leaves nothing waiting", async () => {
  const context = setup({ posts: [post("gone", 2)] });
  await context.worker.tick();
  assert.equal(context.db.tables.publisher_waiting.length, 1);
  context.posts.length = 0;
  await context.worker.tick();
  assert.equal(context.db.tables.publisher_waiting.length, 0);
  assert.equal(context.db.look("u1", "gone").next_run_at, null);
  assert.deepEqual(context.sent, []);
});

test("runs missed while the publisher was down fail with a reason once, from where each post was last looked through", async () => {
  const context = setup({ posts: [post("daily", 1, { recurrence: "every:1:day" })] });
  await context.worker.tick();
  // Down for three days: the first two runs are past the grace, the third is within it.
  context.setClock(T0 + HOUR + 2 * 24 * HOUR + 30 * 60_000);
  await context.worker.tick();
  const rows = context.db.tables.post_deliveries.map((row) => [row.occurrence, row.state, row.error === LATE]);
  assert.deepEqual(rows.sort(), [
    ["2026-10-12", "failed", true],
    ["2026-10-13", "failed", true],
    ["2026-10-14", "sent", false],
  ]);
  // A later look doesn't say so again.
  context.advance(GRACE_MS);
  await context.worker.tick();
  assert.equal(context.db.tables.post_deliveries.filter((row) => row.error === LATE).length, 2);
});

test("the Free plan's 10 waiting posts are counted though only the new one is read", async () => {
  const context = setup({ posts: Array.from({ length: 10 }, (_, index) => post(`p${index}`, 5 + index)) });
  await context.worker.tick();
  context.read.length = 0;
  context.posts.push(post("eleventh", 30));
  await context.worker.tick();
  assert.deepEqual(context.read, ["eleventh"]);
  context.setClock(T0 + 30 * HOUR);
  // Its turn comes after the others went out, but it came in over the limit.
  for (let hour = 5; hour <= 30; hour++) {
    context.setClock(T0 + hour * HOUR);
    await context.worker.tick();
  }
  const eleventh = context.db.tables.post_deliveries.find((row) => row.post_id === "eleventh");
  assert.equal(eleventh.state, "failed");
  assert.equal(eleventh.error, OVER_SCHEDULED);
});

test("a series that ended frees its place for the next, though nothing read it again", async () => {
  // p0 runs daily through 12 October only; the other nine wait for days.
  const posts = [post("p0", 1, { recurrence: "every:1:day", recurrenceEnd: "2026-10-12" }), ...Array.from({ length: 9 }, (_, index) => post(`p${index + 1}`, 48 + index))];
  const context = setup({ posts });
  await context.worker.tick();
  context.setClock(T0 + HOUR);
  await context.worker.tick();
  // 13 October: p0 has stopped waiting, and nothing has read it since its last run.
  context.setClock(Date.parse("2026-10-13T09:00:00Z"));
  await context.worker.tick();
  context.read.length = 0;
  context.posts.push(post("next", 30));
  await context.worker.tick();
  assert.deepEqual(context.read, ["next"]);
  context.setClock(T0 + 30 * HOUR);
  await context.worker.tick();
  assert.equal(context.db.tables.post_deliveries.find((row) => row.post_id === "next").state, "sent");
});

test("after a restart, the count goes on from what was kept", async () => {
  const context = setup({ posts: Array.from({ length: 10 }, (_, index) => post(`p${index}`, 5 + index)) });
  await context.worker.tick();
  const worker = context.restart();
  context.posts.push(post("eleventh", 30));
  await worker.tick();
  for (let hour = 5; hour <= 30; hour++) {
    context.setClock(T0 + hour * HOUR);
    await worker.tick();
  }
  assert.equal(context.db.tables.post_deliveries.find((row) => row.post_id === "eleventh").error, OVER_SCHEDULED);
});

test("a one-off post is marked posted once every network has it; not while one hasn't, and never a series", async () => {
  let failX = true;
  const context = setup({
    posts: [post("both", 0, { platforms: ["x", "bluesky"] }), post("daily", 0, { recurrence: "every:1:day" })],
    send: (name, ctx) => {
      if (name === "x" && ctx.post.id === "both" && failX) throw new PublishError("X said no.");
      return { state: "sent", publishId: `${name}-${ctx.post.id}` };
    },
  });
  await context.worker.tick();
  assert.equal(context.posts[0].post.status, "scheduled", "X didn't take it");
  failX = false;
  await context.worker.request("u1", "both");
  await context.worker.tick();
  assert.equal(context.posts[0].post.status, "posted");
  assert.equal(context.posts[1].post.status, "scheduled");
});

test("the hourly look puts right a post whose next look would come after its next run", async () => {
  const context = setup({ posts: [post("lost", 2), post("fine", 3)] });
  await context.worker.tick();
  // A lost write left it looked at too late.
  await context.db.rpc("publisher_schedule", { items: [{ user_id: "u1", post_id: "lost", version: context.db.look("u1", "lost").version, next_run_at: new Date(T0 + 9 * HOUR).toISOString(), planned_through: null }] });
  assert.equal(await context.worker.sweep(), 1);
  assert.ok(context.errors.some(([message]) => /next look came after/.test(message)));
  assert.equal(context.db.look("u1", "lost").next_run_at, new Date(T0).toISOString());
  await context.worker.tick();
  assert.equal(context.db.look("u1", "lost").next_run_at, new Date(T0 + 2 * HOUR).toISOString());
  assert.equal(await context.worker.sweep(), 0);
  context.setClock(T0 + 2 * HOUR);
  await context.worker.tick();
  assert.deepEqual(context.sent, ["x:lost"]);
});

test("a post that can't be looked at is tried again in a minute, and holds up nobody else", async () => {
  // Its workspace's accounts saved as something that isn't a list.
  const odd = { ...post("odd", 0), connections: { x1: "x" } };
  const context = setup({ posts: [odd, post("fine", 0)] });
  await context.worker.tick();
  assert.deepEqual(context.sent, ["x:fine"]);
  assert.equal(context.db.look("u1", "odd").next_run_at, new Date(T0 + 60_000).toISOString());
  assert.ok(context.errors.some(([message]) => /skipped posts that can't be read/.test(message)));
  // Put right, it goes out at its next look.
  odd.connections = [{ id: "x1", platform: "x" }];
  context.advance(60_000);
  await context.worker.tick();
  assert.deepEqual(context.sent.sort(), ["x:fine", "x:odd"]);
});

test("the hourly look runs beside a pass without undoing it, so a post over the limit stays over", async () => {
  const context = setup({ posts: Array.from({ length: 10 }, (_, index) => post(`p${index}`, 5 + index)) });
  await context.worker.tick();
  // The hourly look reads every post before the eleventh arrives, and is slow to finish.
  const rpc = context.db.rpc.bind(context.db);
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  context.db.rpc = async (name, args) => {
    const rows = await rpc(name, args);
    if (name === "publisher_posts_after") await slow;
    return rows;
  };
  const sweeping = context.worker.sweep();
  await new Promise((resolve) => setImmediate(resolve));
  context.posts.push(post("eleventh", 30));
  const planning = context.worker.pass();
  // The pass gets its chance to run before the hourly look finishes from what it read earlier.
  await new Promise((resolve) => setTimeout(resolve, 50));
  release();
  await Promise.all([sweeping, planning]);
  await context.worker.tick();
  for (let hour = 5; hour <= 30; hour++) {
    context.setClock(T0 + hour * HOUR);
    await context.worker.tick();
  }
  const eleventh = context.db.tables.post_deliveries.find((row) => row.post_id === "eleventh");
  assert.equal(eleventh.state, "failed");
  assert.equal(eleventh.error, OVER_SCHEDULED);
});

test("a waiting post moved later keeps its place for as long as it now waits", async () => {
  // p0 at 5 hours; the other nine wait for a day or more.
  const context = setup({ posts: [post("p0", 5), ...Array.from({ length: 9 }, (_, index) => post(`p${index + 1}`, 24 + index))] });
  await context.worker.tick();
  // p0 moves from 5 hours on to 40: it waits past the time it said before.
  Object.assign(context.posts[0].post, { start: new Date(T0 + 40 * HOUR).toISOString().slice(11, 16), day: new Date(T0 + 40 * HOUR).toISOString().slice(0, 10) });
  await context.worker.tick();
  // At 8 hours, past p0's old time, an eleventh arrives: p0 still waits, so there's no room.
  context.setClock(T0 + 8 * HOUR);
  await context.worker.tick();
  context.posts.push(post("eleventh", 30));
  await context.worker.tick();
  for (let hour = 9; hour <= 30; hour++) {
    context.setClock(T0 + hour * HOUR);
    await context.worker.tick();
  }
  assert.equal(context.db.tables.post_deliveries.find((row) => row.post_id === "eleventh").error, OVER_SCHEDULED);
});
