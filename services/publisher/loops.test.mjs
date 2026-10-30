// The service's timers, on the real clock: a run is planned the moment it's
// due rather than at the next half minute, and a "Post now" goes in a moment.

import assert from "node:assert/strict";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { startLoops } from "./loops.mjs";
import { createWorker } from "./worker.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A worker whose clock runs with the real one, but set so the next whole
 * minute, when its post is due, is `lead` ms away.
 */
function setup({ lead, platforms = ["x"] }) {
  const real = Date.now();
  const minute = Math.ceil(real / 60_000) * 60_000 + 60_000;
  const offset = minute - lead - real;
  const now = () => Date.now() + offset;
  const due = minute;
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
  const network = (name) => ({
    needsFile: false,
    async send() {
      sends.push({ name, at: now() });
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
  return { db, worker, sends, due, now };
}

test("a run is planned and sent the moment it's due, not at the next pass", async () => {
  const { worker, sends, due, now } = setup({ lead: 1_200, platforms: ["x", "bluesky"] });
  // Passes and looks far apart, so only the wake for the run can send it in time.
  const loops = startLoops({ worker, passMs: 60_000, dispatchMs: 60_000, wakeAfterMs: 50, now });
  await loops.pass();
  assert.equal(worker.nextRun(), due);
  assert.equal(sends.length, 0);
  for (let waited = 0; sends.length < 2 && waited < 5_000; waited += 10) await sleep(10);
  await loops.stop(1_000);
  assert.equal(sends.length, 2);
  for (const send of sends) {
    assert.ok(send.at >= due, `sent ${due - send.at} ms early`);
    assert.ok(send.at - due < 500, `sent ${send.at - due} ms late`);
  }
});

test("a Post now goes in a moment, without waiting for a look", async () => {
  const { worker, sends, now } = setup({ lead: 30_000 });
  const loops = startLoops({ worker, passMs: 60_000, dispatchMs: 60_000, wakeAfterMs: 50, now });
  await loops.pass();
  const asked = now();
  await worker.request("u1", "p1");
  loops.kick();
  for (let waited = 0; !sends.length && waited < 3_000; waited += 10) await sleep(10);
  await loops.stop(1_000);
  assert.equal(sends.length, 1);
  assert.ok(sends[0].at - asked < 600, `${sends[0].at - asked} ms after the ask`);
});

test("sending looks every few seconds on its own, for what came due between passes", async () => {
  const { db, worker, sends, now } = setup({ lead: 30_000 });
  const loops = startLoops({ worker, passMs: 60_000, dispatchMs: 100, wakeAfterMs: 50, now });
  await loops.pass();
  // A Post now saved by another way in, with no kick.
  await worker.request("u1", "p1");
  for (let waited = 0; !sends.length && waited < 2_000; waited += 10) await sleep(10);
  await loops.stop(1_000);
  assert.equal(sends.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("while paused, as with a wrong key, nothing is planned or sent", async () => {
  const { db, worker, sends, now } = setup({ lead: 300 });
  const loops = startLoops({ worker, paused: () => true, passMs: 50, dispatchMs: 50, wakeAfterMs: 10, now });
  await loops.pass();
  await sleep(800);
  await loops.stop(1_000);
  assert.equal(sends.length, 0);
  assert.equal(db.tables.post_deliveries.length, 0);
});

test("after a stop, no pass or look runs again", async () => {
  const { db, worker, sends, now } = setup({ lead: 300 });
  const reads = [];
  const rpc = db.rpc.bind(db);
  db.rpc = (name, args) => (reads.push(name), rpc(name, args));
  const loops = startLoops({ worker, passMs: 40, dispatchMs: 40, wakeAfterMs: 10, now });
  await loops.pass();
  assert.equal(await loops.stop(1_000), true);
  const before = reads.length;
  await sleep(700);
  assert.equal(reads.length, before);
  assert.equal(sends.length, 0);
});

test("each pass says how it went, and what follows a pass runs after it", async () => {
  const { worker, now } = setup({ lead: 30_000 });
  const said = [];
  const loops = startLoops({ worker, passed: (planned) => said.push(planned), afterPass: async () => said.push("after"), passMs: 60_000, dispatchMs: 60_000, wakeAfterMs: 10, now });
  await loops.pass();
  await loops.stop(1_000);
  assert.deepEqual(said, [true, "after"]);
});
