import assert from "node:assert/strict";
import test from "node:test";

import { without } from "./db.mjs";
import { createMemoryGate, createPool, laneOf } from "./pool.mjs";

/** One turn of the event loop, so the promises already settled run first. */
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function gate() {
  let open;
  const promise = new Promise((resolve) => (open = resolve));
  return { promise, open };
}

const row = (id, user, platform, connection = `${platform}1`) => ({ id, user_id: user, platform, connection_id: connection });

test("a lane runs one thing at a time, and another lane runs beside it", async () => {
  const pool = createPool({ size: 8, perUser: 8 });
  const first = gate();
  assert.equal(pool.take("t", row("a", "u1", "x"), () => first.promise), true);
  assert.equal(pool.take("t", row("b", "u1", "x"), () => null), false);
  assert.equal(pool.take("t", row("c", "u1", "x", "x2"), () => null), true);
  assert.equal(pool.take("t", row("d", "u2", "x"), () => null), true);
  first.open();
  await pool.idle();
  assert.equal(pool.take("t", row("b", "u1", "x"), () => null), true);
  await pool.idle();
});

test("every YouTube account of a person is one lane, so their daily share is never counted twice at once", async () => {
  const pool = createPool({ size: 8, perUser: 8 });
  const upload = gate();
  assert.deepEqual(laneOf(row("a", "u1", "youtube", "yt1")), { user_id: "u1", platform: "youtube" });
  assert.equal(pool.take("t", row("a", "u1", "youtube", "yt1"), () => upload.promise), true);
  assert.equal(pool.take("t", row("b", "u1", "youtube", "yt2"), () => null), false);
  assert.deepEqual(pool.busy().lanes, [{ user_id: "u1", platform: "youtube" }]);
  assert.equal(pool.take("t", row("c", "u2", "youtube", "yt1"), () => null), true);
  upload.open();
  await pool.idle();
});

test("a person has at most their share of the lanes, and the pool at most its size", async () => {
  const pool = createPool({ size: 3, perUser: 2 });
  const hold = gate();
  assert.equal(pool.take("t", row("a", "u1", "x"), () => hold.promise), true);
  assert.equal(pool.take("t", row("b", "u1", "bluesky"), () => hold.promise), true);
  assert.equal(pool.take("t", row("c", "u1", "linkedin"), () => null), false);
  assert.deepEqual(pool.busy().users, ["u1"]);
  assert.equal(pool.take("t", row("d", "u2", "x"), () => hold.promise), true);
  assert.equal(pool.free, 0);
  assert.equal(pool.take("t", row("e", "u3", "x"), () => null), false);
  hold.open();
  await pool.idle();
  assert.equal(pool.free, 3);
  assert.deepEqual(pool.busy(), { users: [], lanes: [] });
});

test("a row already going isn't taken again, even in a free lane", async () => {
  const pool = createPool({ size: 8, perUser: 8 });
  const hold = gate();
  pool.take("post_deliveries", row("a", "u1", "x"), () => hold.promise);
  assert.deepEqual(pool.goingIn("post_deliveries"), ["a"]);
  assert.equal(pool.canTake("post_deliveries", { ...row("a", "u1", "x"), connection_id: "moved" }), false);
  assert.equal(pool.canTake("post_replies", { ...row("a", "u2", "x") }), true);
  hold.open();
  await pool.idle();
  assert.deepEqual(pool.goingIn("post_deliveries"), []);
});

test("a send that throws still lets its lane go, and says so", async () => {
  let freed = 0;
  const pool = createPool({ size: 1, perUser: 1, onFree: () => freed++ });
  pool.take("t", row("a", "u1", "x"), () => {
    throw new Error("boom");
  });
  await pool.idle();
  assert.equal(freed, 1);
  assert.equal(pool.free, 1);
  pool.take("t", row("b", "u1", "x"), async () => {
    throw new Error("later boom");
  });
  await pool.idle();
  assert.equal(freed, 2);
  assert.equal(pool.going, false);
});

test("a lane is let go before it's said to be free, so whatever's told can take it", async () => {
  const taken = [];
  const pool = createPool({ size: 1, perUser: 1, onFree: () => taken.length || taken.push(pool.take("t", row("b", "u1", "x"), () => null)) });
  pool.take("t", row("a", "u1", "x"), () => null);
  await pool.idle();
  assert.equal(taken[0], true);
});

test("idle waits for what the sends going set off, too", async () => {
  const pool = createPool({ size: 2, perUser: 2 });
  const order = [];
  let more = null;
  pool.take("t", row("a", "u1", "x"), async () => {
    order.push("a");
    more = nextTurn().then(() => {
      pool.take("t", row("b", "u1", "x"), () => order.push("b"));
      more = null;
    });
  });
  await pool.idle(() => more);
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(pool.going, false);
});

test("the memory gate holds at most its budget, first come first served", async () => {
  const memory = createMemoryGate(100);
  const first = await memory.hold(60);
  assert.equal(memory.held, 60);
  const order = [];
  const second = memory.hold(60).then((release) => (order.push("second"), release));
  const third = memory.hold(10).then((release) => (order.push("third"), release));
  await nextTurn();
  assert.deepEqual(order, []);
  first();
  const releaseSecond = await second;
  const releaseThird = await third;
  assert.deepEqual(order, ["second", "third"]);
  assert.equal(memory.held, 70);
  releaseSecond();
  releaseSecond();
  assert.equal(memory.held, 10);
  releaseThird();
  assert.equal(memory.held, 0);
});

test("one over the memory budget goes alone, once nothing else is held", async () => {
  const memory = createMemoryGate(100);
  const small = await memory.hold(10);
  let big = null;
  const waiting = memory.hold(500).then((release) => (big = release));
  await nextTurn();
  assert.equal(big, null);
  small();
  await waiting;
  assert.equal(memory.held, 100);
  let after = null;
  const next = memory.hold(1).then((release) => (after = release));
  await nextTurn();
  assert.equal(after, null);
  big();
  await next;
  after();
  assert.equal(memory.held, 0);
});

test("nothing to hold goes at once", async () => {
  const memory = createMemoryGate(10);
  const full = await memory.hold(10);
  for (const bytes of [0, -1, undefined, Number.NaN]) {
    const release = await memory.hold(bytes);
    release();
  }
  assert.equal(memory.held, 10);
  full();
});

test("a look for due rows leaves out the people at their share and the lanes going", () => {
  assert.equal(without(undefined), "");
  assert.equal(without({ users: [], lanes: [] }), "");
  const u1 = "67d01045-7197-4061-986e-f5685d8206a4";
  const u2 = "c2c257a9-8299-497e-9ad7-5b4f5b33ef79";
  assert.equal(
    without({ users: [u1], lanes: [{ user_id: u2, platform: "youtube" }, { user_id: u2, platform: "x", connection_id: "x_1-a" }] }),
    `&user_id=not.in.(${u1})&and=(not.and(user_id.eq.${u2},platform.eq.youtube),not.and(user_id.eq.${u2},platform.eq.x,connection_id.eq.x_1-a))`,
  );
  assert.equal(without({ users: ["a,b", "c)"], lanes: [{ user_id: u1, platform: "x", connection_id: "a,b" }, { user_id: "x)", platform: "x" }] }), "");
});
