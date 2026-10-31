import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createPlanLimits } from "./plans.mjs";
import { createReplies } from "./replies.mjs";
import { createWorker, lookAgainIn } from "./worker.mjs";

const T0 = Date.parse("2026-10-12T16:00:00Z");
const VIDEO = { key: "posts/u1/p1", size: 80, type: "video/mp4", kind: "video" };

/** One turn of the event loop, so the promises already settled run first. */
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function until(done, tries = 500) {
  for (let i = 0; i < tries; i++) {
    if (done()) return true;
    await nextTurn();
  }
  return done();
}

function gate() {
  let open;
  const promise = new Promise((resolve) => (open = resolve));
  return { promise, open };
}

const post = (user, id, accounts, extra = {}) => ({
  user_id: user,
  workspace_id: "w1",
  time_zone: "UTC",
  connections: accounts.map(([platform, connection]) => ({ id: connection, platform })),
  post: {
    id,
    day: "2026-10-12",
    start: "16:00",
    timeZone: "UTC",
    status: "scheduled",
    platforms: [...new Set(accounts.map(([platform]) => platform))],
    accounts: Object.fromEntries(accounts.map(([platform, connection]) => [platform, [connection]])),
    title: id,
    ...extra,
  },
});

function world({ posts, behave, sendsAtOnce = 8, perUser = 4, memoryBudget, plugs, planLimits, file = VIDEO, holds } = {}) {
  let clock = T0;
  const db = fakeDb({ posts });
  const going = { all: 0, users: new Map(), lanes: new Map() };
  const most = { all: 0, users: new Map(), lanes: new Map() };
  const events = [];
  const laneKey = (ctx, name) => (name === "youtube" ? `${ctx.delivery.user_id}|youtube` : `${ctx.delivery.user_id}|${name}|${ctx.delivery.connection_id}`);
  const bump = (map, key, by) => {
    const next = (map.get(key) ?? 0) + by;
    map.set(key, next);
    return next;
  };
  async function track(name, kind, ctx, work) {
    const lane = laneKey(ctx, name);
    const user = ctx.delivery.user_id;
    going.all++;
    most.all = Math.max(most.all, going.all);
    most.users.set(user, Math.max(most.users.get(user) ?? 0, bump(going.users, user, 1)));
    most.lanes.set(lane, Math.max(most.lanes.get(lane) ?? 0, bump(going.lanes, lane, 1)));
    events.push({ kind, name, row: ctx.delivery.id, user, post: ctx.post?.id, connection: ctx.delivery.connection_id, at: clock });
    try {
      return await work();
    } finally {
      going.all--;
      bump(going.users, user, -1);
      bump(going.lanes, lane, -1);
    }
  }
  const network = (name) => ({
    needsFile: false,
    ...(holds ? { holds: (files) => holds(name, files) } : {}),
    send: (ctx) => track(name, "send", ctx, async () => (behave ? behave(name, "send", ctx) : { state: "sent", publishId: `${name}-${ctx.post.id}` })),
    check: (ctx) => track(name, "check", ctx, async () => (behave ? behave(name, "check", ctx) : { state: "sent", publishId: ctx.delivery.publish_id })),
    publish: (ctx) => track(name, "publish", ctx, async () => (behave ? behave(name, "publish", ctx) : { state: "sent", publishId: `${name}-made` })),
  });
  const networks = Object.fromEntries(["tiktok", "youtube", "bluesky", "linkedin", "x", "instagram"].map((name) => [name, network(name)]));
  const vault = { fresh: async () => ({ session: { accessToken: "a" } }) };
  const media = { postFile: async (_user, id) => (file ? { ...file, id } : null) };
  const errors = [];
  const worker = createWorker({
    db,
    vault,
    media,
    networks,
    plugs,
    planLimits,
    sendsAtOnce,
    perUser,
    ...(memoryBudget ? { memoryBudget } : {}),
    now: () => clock,
    log: { error: (...args) => errors.push(args), warn() {} },
  });
  return {
    db,
    worker,
    going,
    most,
    events,
    errors,
    sent: (filter = () => true) => events.filter((event) => event.kind === "send" && filter(event)),
    rows: () => db.tables.post_deliveries,
    advance: (ms) => (clock += ms),
    setClock: (time) => (clock = time),
    now: () => clock,
  };
}

test("one person's long upload holds up nobody else's post", async () => {
  const upload = gate();
  const w = world({
    posts: [post("u1", "big", [["youtube", "yt1"]]), post("u2", "words", [["x", "x2"]])],
    behave: async (name, kind, ctx) => {
      if (name === "youtube") await upload.promise;
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await w.worker.pass();
  assert.ok(await until(() => w.rows().find((row) => row.platform === "x")?.state === "sent"), "the X post went out during the upload");
  assert.equal(w.rows().find((row) => row.platform === "youtube").state, "sending");
  upload.open();
  assert.ok(await until(() => w.rows().every((row) => row.state === "sent")));
});

test("a post's networks go out at once, rather than each waiting for the one before", async () => {
  const upload = gate();
  const w = world({
    posts: [post("u1", "p1", [["youtube", "yt1"], ["x", "x1"], ["bluesky", "bs1"], ["linkedin", "li1"]])],
    behave: async (name) => {
      if (name === "youtube") await upload.promise;
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await w.worker.pass();
  assert.ok(await until(() => w.rows().filter((row) => row.state === "sent").length === 3));
  assert.equal(w.most.users.get("u1"), 4);
  upload.open();
  await w.worker.tick();
  assert.deepEqual(w.rows().map((row) => row.state), ["sent", "sent", "sent", "sent"]);
});

test("two posts to one account go one after the other, never at once", async () => {
  const w = world({
    posts: [post("u1", "a", [["tiktok", "tt1"]]), post("u1", "b", [["tiktok", "tt1"]]), post("u1", "c", [["tiktok", "tt1"]])],
    behave: async (name) => {
      await nextTurn();
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await w.worker.tick();
  assert.equal(w.sent().length, 3);
  assert.equal(w.most.lanes.get("u1|tiktok|tt1"), 1);
  assert.ok(w.rows().every((row) => row.state === "sent"));
});

test("a person's YouTube channels upload one at a time, so their daily share is never overrun", async () => {
  const db = fakeDb();
  let clock = T0;
  const planLimits = createPlanLimits({ db, now: () => clock, log: { error() {} }, youtube: { 1: 1, 2: 1, 3: 1, 4: 1 } });
  planLimits.review = async () => undefined;
  planLimits.over = () => false;
  const w = world({
    posts: [post("u1", "a", [["youtube", "yt1"]]), post("u1", "b", [["youtube", "yt2"]])],
    planLimits,
    behave: async (name, kind, ctx) => {
      await ctx.progress?.("upload:1");
      await nextTurn();
      return { state: "sent", publishId: "v" };
    },
  });
  planLimits.countUpload = (user, platform) => db.insert("publisher_uploads", [{ user_id: user, platform, at: new Date(w.now()).toISOString() }]);
  await w.worker.tick();
  assert.equal(w.sent().length, 1, "only one upload went");
  assert.equal(w.most.lanes.get("u1|youtube"), 1);
  const waiting = w.rows().find((row) => row.state === "queued");
  assert.match(waiting.error, /YouTube videos a day/);
});

test("a person has at most their share of the sends going, and others go beside them", async () => {
  const hold = gate();
  const w = world({
    sendsAtOnce: 3,
    perUser: 2,
    posts: [post("u1", "p1", [["x", "x1"], ["bluesky", "bs1"], ["linkedin", "li1"], ["tiktok", "tt1"]]), post("u2", "p2", [["x", "x2"]])],
    behave: async (name) => {
      await hold.promise;
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await w.worker.pass();
  assert.ok(await until(() => w.going.all === 3));
  assert.equal(w.going.users.get("u1"), 2);
  assert.equal(w.going.users.get("u2"), 1);
  hold.open();
  await w.worker.tick();
  assert.equal(w.most.users.get("u1"), 2);
  assert.equal(w.most.all, 3);
  assert.ok(w.rows().every((row) => row.state === "sent"));
});

test("never more sends going than the pool has lanes, however many are due", async () => {
  const posts = Array.from({ length: 30 }, (_, index) => post(`u${index}`, `p${index}`, [["x", `x${index}`], ["bluesky", `bs${index}`]]));
  let random = 1;
  const next = () => ((random = (random * 16807) % 2147483647) / 2147483647);
  const w = world({
    sendsAtOnce: 5,
    perUser: 2,
    posts,
    behave: async (name) => {
      for (let hops = Math.floor(next() * 4); hops > 0; hops--) await nextTurn();
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await w.worker.tick();
  assert.equal(w.sent().length, 60);
  assert.equal(w.most.all, 5);
  assert.ok(w.rows().every((row) => row.state === "sent"));
});

test("a pass during a long upload doesn't fail it as cut off by a restart", async () => {
  const upload = gate();
  const w = world({
    posts: [post("u1", "big", [["youtube", "yt1"]])],
    behave: async () => {
      await upload.promise;
      return { state: "sent", publishId: "v" };
    },
  });
  w.db.tables.post_deliveries.push({
    id: "old",
    user_id: "u9",
    workspace_id: "w1",
    post_id: "gone",
    occurrence: "once",
    platform: "x",
    connection_id: "x9",
    state: "sending",
    attempts: 1,
    requested: false,
    error: null,
    publish_id: null,
    url: null,
    due_at: new Date(T0 - 3_600_000).toISOString(),
    next_at: new Date(T0 - 3_600_000).toISOString(),
    created_at: new Date(T0 - 3_600_000).toISOString(),
    updated_at: new Date(T0 - 3_600_000).toISOString(),
    plug_checks: 3,
    plugs_done: [],
  });
  await w.worker.pass();
  assert.ok(await until(() => w.going.all === 1));
  w.advance(45 * 60_000);
  await w.worker.pass();
  const big = w.rows().find((row) => row.post_id === "big");
  assert.equal(big.state, "sending", "the upload still going is left alone");
  assert.equal(w.rows().find((row) => row.id === "old").state, "failed", "the one cut off earlier fails");
  upload.open();
  assert.ok(await until(() => w.rows().find((row) => row.post_id === "big").state === "sent"));
  assert.equal(w.rows().find((row) => row.post_id === "big").error, null);
});

test("a pass during a long follow-up doesn't fail it as cut off by a restart", async () => {
  const db = fakeDb();
  const slow = gate();
  let clock = T0;
  const delivery = { id: "d1", user_id: "u1", post_id: "p1", platform: "x", connection_id: "x1", workspace_id: "w1", state: "sent", publish_id: "100" };
  db.tables.post_deliveries.push(delivery);
  const thread = { ...post("u1", "p1", [["x", "x1"]]), post: { ...post("u1", "p1", [["x", "x1"]]).post, thread: [{ text: "more", delay: 0 }] } };
  db.posts.push(thread);
  const replies = createReplies({
    db,
    vault: { fresh: async () => ({ session: {} }) },
    networks: {
      x: {
        reply: async () => {
          await slow.promise;
          return { state: "sent", publishId: "101" };
        },
      },
    },
    media: {},
    postIn: async (owner, id) => db.posts.filter((item) => item.user_id === owner && item.post.id === id),
    now: () => clock,
    log: { error() {}, warn() {} },
  });
  await replies.start(delivery, thread.post);
  const [row] = await replies.due(10);
  const going = replies.sendOne(row);
  assert.ok(await until(() => db.tables.post_replies[0].state === "sending"));
  clock += 45 * 60_000;
  await replies.housekeep([row.id]);
  assert.equal(db.tables.post_replies[0].state, "sending");
  await replies.housekeep([]);
  assert.equal(db.tables.post_replies[0].state, "failed", "without being said to be going, it's cut off");
  slow.open();
  await going;
});

test("an upload the network is still working on is looked at after 5 seconds, then less and less often", async () => {
  const w = world({
    posts: [post("u1", "p1", [["tiktok", "tt1"]])],
    behave: async (name, kind) => (kind === "send" ? { state: "processing", publishId: "pub" } : { state: "processing", publishId: "pub" }),
  });
  await w.worker.tick();
  const looks = [];
  for (let i = 0; i < 14; i++) {
    const row = w.rows()[0];
    w.setClock(Date.parse(row.next_at));
    looks.push((w.now() - T0) / 1000);
    await w.worker.tick();
  }
  assert.deepEqual(looks, [5, 10, 15, 25, 35, 45, 65, 85, 105, 125, 185, 245, 305, 365]);
  assert.equal(w.events.filter((event) => event.kind === "check").length, 14);
  assert.deepEqual([0, 14_999, 15_000, 44_999, 45_000, 119_999, 120_000, 3_600_000].map(lookAgainIn), [5_000, 5_000, 10_000, 10_000, 20_000, 20_000, 60_000, 60_000]);
});

test("a post found while its media is still uploading looks again in seconds, and goes once it lands", async () => {
  const w = world({ posts: [post("u1", "p1", [["tiktok", "tt1"]], { files: ["p1"] })], file: null });
  await w.worker.tick();
  const row = w.rows()[0];
  assert.match(row.error, /still uploading/);
  assert.equal(Date.parse(row.next_at) - w.now(), 5_000);
});

test("a pass says when the soonest run it saw coming is due, so it can be planned that moment", async () => {
  const soon = post("u1", "soon", [["x", "x1"]], { start: "16:01" });
  const later = post("u1", "later", [["x", "x1"]], { start: "16:05" });
  const daily = post("u2", "daily", [["x", "x2"]], { start: "16:00", recurrence: "every:1:day", day: "2026-10-11" });
  const w = world({ posts: [soon, later, daily] });
  w.setClock(T0 + 10_000);
  await w.worker.tick();
  assert.equal(w.worker.nextRun(), T0 + 60_000);
  w.setClock(T0 + 61_000);
  await w.worker.tick();
  assert.equal(w.worker.nextRun(), null);
  w.setClock(T0 + 4 * 60_000);
  await w.worker.tick();
  assert.equal(w.worker.nextRun(), T0 + 5 * 60_000);
  w.setClock(T0 + 24 * 3_600_000 - 30_000);
  await w.worker.tick();
  assert.equal(w.worker.nextRun(), T0 + 24 * 3_600_000);
  daily.post.paused = true;
  await w.worker.tick();
  assert.equal(w.worker.nextRun(), null);
});

test("a run planned the moment it's due goes out in the same pass", async () => {
  const w = world({ posts: [post("u1", "p1", [["x", "x1"]], { start: "16:01" })] });
  await w.worker.tick();
  assert.equal(w.sent().length, 0);
  w.setClock(w.worker.nextRun() + 250);
  await w.worker.tick();
  assert.equal(w.sent().length, 1);
  assert.equal(w.rows()[0].state, "sent");
});

test("a pass asked for while one runs runs again after it, rather than being dropped", async () => {
  const w = world({ posts: [post("u1", "p1", [["x", "x1"]], { start: "16:01" })] });
  const rpc = w.db.rpc.bind(w.db);
  let reads = 0;
  const slow = gate();
  w.db.rpc = async (name, args) => {
    if (name === "publisher_due") {
      reads++;
      if (reads === 1) await slow.promise;
    }
    return rpc(name, args);
  };
  const first = w.worker.pass();
  assert.ok(await until(() => reads === 1));
  w.setClock(T0 + 60_000);
  const second = w.worker.pass();
  assert.equal(first, second);
  slow.open();
  await first;
  assert.equal(reads, 2);
  assert.ok(await until(() => w.rows()[0]?.state === "sent"));
});

test("a lane freed just as a look ends is filled, not left until the next look", async () => {
  for (let seed = 1; seed <= 30; seed++) {
    let random = seed;
    const next = () => ((random = (random * 16807) % 2147483647) / 2147483647);
    const posts = Array.from({ length: 12 }, (_, index) => post(`u${index % 3}`, `p${index}`, [["x", `x${index % 3}`]]));
    const w = world({
      sendsAtOnce: 2,
      perUser: 1,
      posts,
      behave: async (name) => {
        for (let hops = Math.floor(next() * 6); hops > 0; hops--) await null;
        return { state: "sent", publishId: `${name}-id` };
      },
    });
    const due = w.db.due.bind(w.db);
    w.db.due = async (...args) => {
      for (let hops = Math.floor(next() * 6); hops > 0; hops--) await null;
      return due(...args);
    };
    await w.worker.pass();
    // No timer looks again here: only lanes freeing start the rest.
    assert.ok(await until(() => w.rows().every((row) => row.state === "sent"), 5_000), `seed ${seed}: ${w.rows().filter((row) => row.state !== "sent").length} left`);
  }
});

test("Post now goes at once, without waiting for a pass", async () => {
  const w = world({ posts: [post("u1", "p1", [["x", "x1"], ["bluesky", "bs1"]], { start: "18:00" })] });
  await w.worker.request("u1", "p1");
  await w.worker.dispatch();
  assert.ok(await until(() => w.rows().every((row) => row.state === "sent")));
  assert.equal(w.sent().length, 2);
});

test("a stop starts nothing more, and waits for the sends going", async () => {
  const upload = gate();
  const w = world({
    sendsAtOnce: 1,
    posts: [post("u1", "a", [["youtube", "yt1"]]), post("u2", "b", [["x", "x2"]])],
    behave: async (name) => {
      if (name === "youtube") await upload.promise;
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await w.worker.pass();
  assert.ok(await until(() => w.going.all === 1));
  const stopping = w.worker.stop(5_000);
  await nextTurn();
  upload.open();
  assert.equal(await stopping, true);
  await w.worker.dispatch();
  await w.worker.pass();
  assert.equal(w.sent().length, 1, "nothing started after the stop");
  assert.equal(w.rows().find((row) => row.platform === "x").state, "queued");
});

test("a stop gives up waiting after its time, and says the sends didn't finish", async (t) => {
  const never = gate();
  const w = world({ posts: [post("u1", "a", [["x", "x1"]])], behave: () => never.promise });
  await w.worker.pass();
  assert.ok(await until(() => w.going.all === 1));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stopping = w.worker.stop(30);
  t.mock.timers.tick(30);
  assert.equal(await stopping, false);
  never.open({ state: "sent", publishId: "late" });
});

test("sends that hold big files in memory wait for room; ones without files don't", async () => {
  const first = gate();
  const order = [];
  const w = world({
    memoryBudget: 100,
    holds: (name, files) => (name === "bluesky" ? files.reduce((sum, file) => sum + file.size, 0) : 0),
    posts: [
      post("u1", "v1", [["bluesky", "bs1"]], { files: ["v1"] }),
      post("u2", "v2", [["bluesky", "bs2"]], { files: ["v2"] }),
      post("u3", "words", [["bluesky", "bs3"]], { files: [] }),
    ],
    behave: async (name, kind, ctx) => {
      order.push(`start ${ctx.post.id}`);
      if (ctx.post.id === "v1") await first.promise;
      order.push(`end ${ctx.post.id}`);
      return { state: "sent", publishId: ctx.post.id };
    },
  });
  await w.worker.pass();
  assert.ok(await until(() => order.includes("end words") && order.includes("start v1")));
  assert.equal(w.going.all, 1);
  assert.ok(!order.includes("start v2"), "the second video waits for room");
  assert.equal(w.worker.memory.held, 80);
  first.open();
  await w.worker.tick();
  assert.ok(order.indexOf("start v2") > order.indexOf("end v1"));
  assert.equal(order.length, 6);
  assert.equal(w.worker.memory.held, 0);
});

test("the memory a send holds is let go when it fails", async () => {
  const w = world({
    memoryBudget: 100,
    holds: () => 90,
    posts: [post("u1", "a", [["bluesky", "bs1"]], { files: ["a"] }), post("u2", "b", [["bluesky", "bs2"]], { files: ["b"] })],
    behave: async (name, kind, ctx) => {
      if (ctx.post.id === "a") throw new PublishError("Bluesky said no.");
      return { state: "sent", publishId: "b" };
    },
  });
  await w.worker.tick();
  assert.equal(w.worker.memory.held, 0);
  assert.deepEqual(w.rows().map((row) => [row.post_id, row.state]).sort(), [["a", "failed"], ["b", "sent"]]);
});

test("a row that keeps coming straight back due doesn't spin", async () => {
  const w = world({ posts: [post("u1", "p1", [["x", "x1"]])] });
  const update = w.db.update.bind(w.db);
  let claims = 0;
  w.db.update = async (table, filter, values) => {
    if (table === "post_deliveries" && values.state === "sending") {
      claims++;
      return [];
    }
    return update(table, filter, values);
  };
  await w.worker.tick();
  assert.ok(claims >= 1 && claims <= 3, `${claims} claims in one second`);
  w.advance(1_000);
  await w.worker.tick();
  assert.ok(claims <= 6);
  assert.equal(w.sent().length, 0);
});

test("a look for due rows that fails holds up neither the follow-ups nor the next look", async () => {
  const w = world({ posts: [post("u1", "p1", [["x", "x1"]])] });
  const due = w.db.due.bind(w.db);
  let fails = 1;
  w.db.due = async (...args) => {
    if (fails-- > 0) throw new Error("connection lost");
    return due(...args);
  };
  await w.worker.tick();
  assert.match(String(w.errors[0]?.[0]), /couldn't look for due post_deliveries/);
  assert.equal(w.sent().length, 1);
  assert.equal(w.rows()[0].state, "sent");
});

test("a send that throws past its own handling still lets its lane go", async () => {
  const w = world({ posts: [post("u1", "a", [["x", "x1"]]), post("u1", "b", [["x", "x1"]], { start: "16:00" })] });
  const update = w.db.update.bind(w.db);
  let broke = false;
  w.db.update = async (table, filter, values) => {
    if (!broke && values.state === "sending") {
      broke = true;
      throw new Error("connection lost");
    }
    return update(table, filter, values);
  };
  await w.worker.tick();
  assert.ok(w.errors.some((args) => /sending failed/.test(String(args[0]))));
  assert.equal(w.worker.pool.free, 8);
  assert.equal(w.sent().length, 2);
});

test("plugs run in their account's lane too", async () => {
  let going = 0;
  let most = 0;
  const plugs = {
    platforms: ["x"],
    forAccount: () => [{ kind: "comment" }],
    run: async () => {
      most = Math.max(most, ++going);
      await nextTurn();
      going--;
      return ["comment"];
    },
  };
  const w = world({ plugs, posts: [post("u1", "a", [["x", "x1"]]), post("u1", "b", [["x", "x1"]]), post("u2", "c", [["x", "x2"]])] });
  await w.worker.tick();
  w.advance(6 * 3_600_000);
  await w.worker.tick();
  assert.ok(w.rows().every((row) => row.plugs_done.includes("comment")));
  assert.ok(most <= 2, "two accounts, two lanes");
});

test("under random load, nothing is made twice, no lane runs two at once, and everything ends", async () => {
  for (let seed = 1; seed <= 25; seed++) {
    let random = seed * 7919;
    const next = () => ((random = (random * 16807) % 2147483647) / 2147483647);
    const pick = (list) => list[Math.floor(next() * list.length)];
    const platforms = ["tiktok", "youtube", "bluesky", "linkedin", "x", "instagram"];
    const posts = [];
    for (let index = 0; index < 18; index++) {
      const user = `u${Math.floor(next() * 4)}`;
      const accounts = [...new Set(Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(platforms)))].map((platform) => [platform, `${platform}-${user}-${Math.floor(next() * 2)}`]);
      posts.push(post(user, `p${index}`, accounts, { start: pick(["16:00", "16:00", "16:01", "16:03"]) }));
    }
    const made = new Map();
    const sendsAtOnce = 1 + Math.floor(next() * 6);
    const perUser = 1 + Math.floor(next() * 3);
    const w = world({
      sendsAtOnce,
      perUser,
      posts,
      behave: async (name, kind, ctx) => {
        for (let hops = Math.floor(next() * 5); hops > 0; hops--) await new Promise((resolve) => setImmediate(resolve));
        const roll = next();
        if (kind === "check") return roll < 0.5 ? { state: "processing", publishId: ctx.delivery.publish_id } : { state: "ready" };
        if (kind === "send" && roll < 0.15) throw new PublishError("Down for now.", { retry: true });
        if (kind === "send" && roll < 0.2) throw new PublishError("Turned down.");
        if (kind === "send" && roll < 0.45) return { state: "processing", publishId: `pub-${ctx.delivery.id}` };
        made.set(ctx.delivery.id, (made.get(ctx.delivery.id) ?? 0) + 1);
        return { state: "sent", publishId: `${name}-${ctx.delivery.id}` };
      },
    });
    for (let step = 0; step < 400 && !(step > 20 && w.rows().every((row) => row.state === "sent" || row.state === "failed")); step++) {
      if (next() < 0.1) {
        const chosen = pick(posts);
        await w.worker.request(chosen.user_id, chosen.post.id).catch(() => null);
      }
      const runs = [w.worker.pass(), w.worker.dispatch()];
      if (next() < 0.5) runs.push(w.worker.dispatch());
      await Promise.all(runs);
      await w.worker.tick();
      const waiting = w.rows().filter((row) => row.state === "queued" || row.state === "processing").map((row) => Date.parse(row.next_at));
      const soonest = Math.min(...waiting);
      if (waiting.length && soonest > w.now() && next() < 0.5) w.setClock(soonest);
      else w.advance(Math.floor(next() * 3) * 5_000 + 1_000);
    }
    const rows = w.rows();
    assert.ok(rows.length > 0);
    assert.ok(
      rows.every((row) => row.state === "sent" || row.state === "failed"),
      `seed ${seed}: ${rows.filter((row) => row.state !== "sent" && row.state !== "failed").map((row) => `${row.platform}:${row.state}`)}`,
    );
    for (const [id, count] of made) assert.equal(count, 1, `seed ${seed}: row ${id} made ${count} times`);
    for (const [lane, count] of w.most.lanes) assert.equal(count, 1, `seed ${seed}: lane ${lane} ran ${count} at once`);
    for (const [user, count] of w.most.users) assert.ok(count <= perUser, `seed ${seed}: ${user} had ${count} of ${perUser}`);
    assert.ok(w.most.all <= sendsAtOnce, `seed ${seed}: ${w.most.all} at once of ${sendsAtOnce}`);
    for (const row of rows) if (made.has(row.id)) assert.equal(row.state, "sent");
  }
});
