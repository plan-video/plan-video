import assert from "node:assert/strict";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { startLoops } from "./loops.mjs";
import { createWorker } from "./worker.mjs";

const DUE = Date.parse("2026-10-12T16:00:00Z");
/** Lets the work the timers set off run to its end: nothing in it waits on a timer. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** On Node's fake timers, `lead` ms before the post is due. */
function setup(t, { lead, platforms = ["x"] }) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: DUE - lead });
  const now = () => Date.now();
  const due = DUE;
  const at = new Date(due).toISOString();
  const posts = [
    {
      user_id: "u1",
      workspace_id: "w1",
      time_zone: "UTC",
      connections: platforms.map((platform) => ({ id: `${platform}1`, platform })),
      post: { id: "p1", day: at.slice(0, 10), start: at.slice(11, 16), timeZone: "UTC", status: "scheduled", platforms, title: "Hi", files: [] },
    },
  ];
  const db = fakeDb({ posts });
  const sends = [];
  const waiting = [];
  const sent = (count) => new Promise((resolve) => waiting.push({ count, resolve }));
  const network = (name) => ({
    needsFile: false,
    async send() {
      sends.push({ name, at: now() });
      for (const wait of waiting) if (sends.length >= wait.count) wait.resolve();
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  const worker = createWorker({
    db,
    vault: { fresh: async () => ({ session: {} }) },
    media: { postFile: async () => null },
    networks: Object.fromEntries(platforms.map((name) => [name, network(name)])),
    now,
    log: { error() {}, warn() {} },
  });
  return { db, worker, sends, sent, due, now, clock: t.mock.timers };
}

test("a run is planned and sent the moment it's due, not at the next pass", async (t) => {
  const { worker, sends, sent, due, now, clock } = setup(t, { lead: 1_200, platforms: ["x", "bluesky"] });
  // Passes and looks far apart, so only the wake for the run can send it in time.
  const loops = startLoops({ worker, passMs: 60_000, dispatchMs: 60_000, wakeAfterMs: 50, now });
  await loops.pass();
  assert.equal(worker.nextRun(), due);
  assert.equal(sends.length, 0);
  const both = sent(2);
  clock.tick(1_250);
  await both;
  await loops.stop(1_000);
  assert.equal(sends.length, 2);
  for (const send of sends) {
    assert.ok(send.at >= due, `sent ${due - send.at} ms early`);
    assert.ok(send.at - due < 500, `sent ${send.at - due} ms late`);
  }
});

test("a Post now goes in a moment, without waiting for a look", async (t) => {
  const { worker, sends, sent, now, clock } = setup(t, { lead: 30_000 });
  const loops = startLoops({ worker, passMs: 60_000, dispatchMs: 60_000, wakeAfterMs: 50, now });
  await loops.pass();
  const asked = now();
  await worker.request("u1", "p1");
  loops.kick();
  const one = sent(1);
  clock.tick(200);
  await one;
  await loops.stop(1_000);
  assert.equal(sends.length, 1);
  assert.ok(sends[0].at - asked < 600, `${sends[0].at - asked} ms after the ask`);
});

test("sending looks every few seconds on its own, for what came due between passes", async (t) => {
  const { db, worker, sends, sent, now, clock } = setup(t, { lead: 30_000 });
  const loops = startLoops({ worker, passMs: 60_000, dispatchMs: 100, wakeAfterMs: 50, now });
  await loops.pass();
  // A Post now saved by another way in, with no kick.
  await worker.request("u1", "p1");
  const one = sent(1);
  clock.tick(100);
  await one;
  await loops.stop(1_000);
  assert.equal(sends.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("while paused, as with a wrong key, nothing is planned or sent", async (t) => {
  const { db, worker, sends, now, clock } = setup(t, { lead: 300 });
  const loops = startLoops({ worker, paused: () => true, passMs: 50, dispatchMs: 50, wakeAfterMs: 10, now });
  await loops.pass();
  await worker.request("u1", "p1");
  clock.tick(800);
  await settle();
  await loops.stop(1_000);
  assert.equal(sends.length, 0);
  assert.deepEqual(db.tables.post_deliveries.map((row) => row.requested), [true], "only the Post now's run, and it waits");
});

test("after a stop, no pass or look runs again", async (t) => {
  const { db, worker, sends, now, clock } = setup(t, { lead: 300 });
  const reads = [];
  const rpc = db.rpc.bind(db);
  db.rpc = (name, args) => (reads.push(name), rpc(name, args));
  const loops = startLoops({ worker, passMs: 40, dispatchMs: 40, wakeAfterMs: 10, now });
  await loops.pass();
  assert.equal(await loops.stop(1_000), true);
  const before = reads.length;
  clock.tick(700);
  await settle();
  assert.equal(reads.length, before);
  assert.equal(sends.length, 0);
});

test("each pass says how it went, and what follows a pass runs after it", async (t) => {
  const { worker, now } = setup(t, { lead: 30_000 });
  const said = [];
  const loops = startLoops({ worker, passed: (planned) => said.push(planned), afterPass: async () => said.push("after"), passMs: 60_000, dispatchMs: 60_000, wakeAfterMs: 10, now });
  await loops.pass();
  await loops.stop(1_000);
  assert.deepEqual(said, [true, "after"]);
});
