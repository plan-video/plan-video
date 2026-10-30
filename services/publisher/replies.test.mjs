import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { threadOf } from "./replies.mjs";
import { createWorker } from "./worker.mjs";

const T0 = Date.parse("2026-10-25T12:00:00Z");
const MINUTE = 60_000;

function setup({ thread, platforms = ["x"], reply, notices, stored = new Map() } = {}) {
  let clock = T0;
  const item = {
    user_id: "u1",
    workspace_id: "w1",
    time_zone: "UTC",
    connections: [
      { id: "x1", platform: "x" },
      { id: "tt1", platform: "tiktok" },
    ],
    post: { id: "p1", day: "2026-10-25", start: "12:00", timeZone: "UTC", status: "scheduled", platforms, title: "Hi", description: "The post", thread },
  };
  const db = fakeDb({ posts: [item] });
  const sent = [];
  const replied = [];
  const network = (name, { replies = true } = {}) => ({
    needsFile: false,
    async send(ctx) {
      sent.push(name);
      return { state: "sent", publishId: `${name}-post` };
    },
    ...(replies
      ? {
          replyMedia: true,
          async reply(ctx) {
            replied.push({ name, text: ctx.text, root: ctx.root, parent: ctx.parent, at: clock, files: ctx.files.map((file) => file.id), pending: ctx.pending });
            if (reply) return reply(ctx, replied.length);
            return { state: "sent", publishId: `${name}-reply-${replied.length}`, url: `https://example.com/${replied.length}` };
          },
        }
      : {}),
  });
  const worker = createWorker({
    db,
    vault: { fresh: async () => ({ session: { accessToken: "a" } }) },
    media: { postFile: async (_userId, id) => (stored.has(id) ? { id, key: `posts/u1/${id}`, size: 10, type: "image/jpeg", kind: stored.get(id) } : null) },
    networks: { x: network("x"), tiktok: network("tiktok", { replies: false }) },
    notices,
    now: () => clock,
    log: { error() {}, warn() {} },
  });
  return { db, worker, item, sent, replied, stored, advance: (ms) => (clock += ms) };
}

test("a post's follow-ups go out under it, each its delay after the one before", async () => {
  const { db, worker, replied, advance } = setup({
    thread: [
      { id: "a", text: "First reply", delay: 0 },
      { id: "b", text: "  Second reply  ", delay: 5 },
    ],
  });
  await worker.tick();
  assert.deepEqual(replied.map((call) => call.text), ["First reply"]);
  assert.equal(replied[0].root, "x-post");
  assert.equal(replied[0].parent, "x-post");

  // Not before its five minutes.
  advance(4 * MINUTE);
  await worker.tick();
  assert.equal(replied.length, 1);

  advance(MINUTE);
  await worker.tick();
  assert.deepEqual(replied.map((call) => call.text), ["First reply", "Second reply"]);
  assert.equal(replied[1].root, "x-post");
  assert.equal(replied[1].parent, "x-reply-1");

  await worker.tick();
  assert.equal(replied.length, 2);
  assert.deepEqual(db.tables.post_replies.map((row) => [row.step, row.state, row.publish_id]), [
    [0, "sent", "x-reply-1"],
    [1, "sent", "x-reply-2"],
  ]);
});

test("networks without replies get the post alone, and a post without a thread has no follow-ups", async () => {
  const withThread = setup({ thread: [{ id: "a", text: "Reply", delay: 0 }], platforms: ["x", "tiktok"] });
  await withThread.worker.tick();
  assert.deepEqual(withThread.sent.sort(), ["tiktok", "x"]);
  assert.deepEqual(withThread.replied.map((call) => call.name), ["x"]);

  const without = setup({ thread: undefined });
  await without.worker.tick();
  assert.equal(without.db.tables.post_replies.length, 0);
});

test("a follow-up goes with its words as they are when it goes, and one taken off the thread meanwhile doesn't", async () => {
  const { worker, item, replied, advance, db } = setup({
    thread: [
      { id: "a", text: "First", delay: 10 },
      { id: "b", text: "Second", delay: 10 },
    ],
  });
  await worker.tick();
  assert.equal(replied.length, 0);
  item.post.thread[0].text = "First, edited";
  advance(10 * MINUTE);
  await worker.tick();
  assert.deepEqual(replied.map((call) => call.text), ["First, edited"]);

  item.post.thread.pop();
  advance(10 * MINUTE);
  await worker.tick();
  assert.equal(replied.length, 1);
  assert.equal(db.tables.post_replies.length, 1);
});

test("a follow-up the network turns down fails, is emailed about, and stops the ones after it", async () => {
  const failures = [];
  const { db, worker, replied, advance } = setup({
    thread: [
      { id: "a", text: "First", delay: 0 },
      { id: "b", text: "Second", delay: 0 },
    ],
    reply: () => {
      throw new PublishError("X refused the request.");
    },
    notices: { failed: async (row, about) => failures.push({ row, about }) },
  });
  await worker.tick();
  advance(MINUTE);
  await worker.tick();
  assert.equal(replied.length, 1);
  assert.deepEqual(db.tables.post_replies.map((row) => [row.step, row.state, row.error]), [[0, "failed", "X refused the request."]]);
  assert.equal(failures.length, 1);
  assert.match(failures[0].about.message, /Follow-up 1 of the thread didn't go out on X\. X refused the request\./);
});

test("a follow-up that may work later is tried again, up to four times", async () => {
  const { db, worker, replied, advance } = setup({
    thread: [{ id: "a", text: "First", delay: 0 }],
    reply: (_ctx, count) => {
      if (count < 3) throw new PublishError("Couldn't reach X. Trying again soon.", { retry: true });
      return { state: "sent", publishId: "x-reply" };
    },
  });
  await worker.tick();
  assert.equal(db.tables.post_replies[0].state, "queued");
  advance(2 * MINUTE);
  await worker.tick();
  advance(10 * MINUTE);
  await worker.tick();
  assert.equal(replied.length, 3);
  assert.equal(db.tables.post_replies[0].state, "sent");
});

test("a follow-up cut off while it was going isn't sent again", async () => {
  const { db, worker, replied, advance } = setup({ thread: [{ id: "a", text: "First", delay: 5 }] });
  await worker.tick();
  // A restart caught it halfway.
  Object.assign(db.tables.post_replies[0], { state: "sending", updated_at: new Date(T0).toISOString() });
  advance(31 * MINUTE);
  await worker.tick();
  assert.equal(replied.length, 0);
  assert.equal(db.tables.post_replies[0].state, "failed");
});

test("without post_replies in the database, posts still go out alone", async () => {
  const { db, worker, sent } = setup({ thread: [{ id: "a", text: "First", delay: 0 }] });
  const missing = () => {
    throw new Error('The database refused POST post_replies: {"code":"PGRST205"}');
  };
  const insertNew = db.insertNew.bind(db);
  db.insertNew = async (table, rows, conflict) => (table === "post_replies" ? missing() : insertNew(table, rows, conflict));
  db.repliesDue = missing;
  db.abandonStaleReplies = missing;
  await worker.tick();
  assert.deepEqual(sent, ["x"]);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("threadOf keeps the follow-ups with words, at most ten, with their waits held to a week", () => {
  const thread = threadOf({
    thread: [
      { text: "  ", delay: 5 },
      { text: "One", delay: 5 },
      { text: "Two", delay: 60 * 24 * 30 },
      { text: "Three", delay: -1 },
      ...Array.from({ length: 12 }, (_, index) => ({ text: `More ${index}`, delay: 0 })),
    ],
  });
  assert.equal(thread.length, 10);
  assert.deepEqual(thread.slice(0, 3), [
    { text: "One", delay: 5 * MINUTE, files: [] },
    { text: "Two", delay: 7 * 24 * 60 * MINUTE, files: [] },
    { text: "Three", delay: 0, files: [] },
  ]);
  assert.deepEqual(threadOf({}), []);
  assert.deepEqual(threadOf({ thread: "nope" }), []);
});

test("a follow-up goes with its own pictures, and never with another post's files", async () => {
  const stored = new Map([
    ["p1_a", "image"],
    ["p1_b", "image"],
    ["p2_x", "image"],
  ]);
  const { replied } = await (async () => {
    const context = setup({ thread: [{ id: "a", text: "Look", delay: 0, files: ["p1_a", "p2_x", "p1_b"] }], stored });
    await context.worker.tick();
    return context;
  })();
  assert.deepEqual(replied[0].files, ["p1_a", "p1_b"]);
});

test("a follow-up waits for its files to reach storage, then goes with them", async () => {
  const { worker, replied, stored, advance, db } = setup({ thread: [{ id: "a", text: "", delay: 0, files: ["p1_a"] }] });
  await worker.tick();
  assert.equal(replied.length, 0);
  assert.equal(db.tables.post_replies[0].state, "queued");
  assert.equal(db.tables.post_replies[0].attempts, 0);
  stored.set("p1_a", "video");
  advance(MINUTE);
  await worker.tick();
  assert.deepEqual(replied.map((call) => call.files), [["p1_a"]]);
});

test("a follow-up whose files never arrive fails after half an hour", async () => {
  const { worker, replied, advance, db } = setup({ thread: [{ id: "a", text: "Hi", delay: 0, files: ["p1_a"] }] });
  await worker.tick();
  advance(31 * MINUTE);
  await worker.tick();
  assert.equal(replied.length, 0);
  assert.equal(db.tables.post_replies[0].state, "failed");
  assert.match(db.tables.post_replies[0].error, /never reached/);
});

test("a follow-up the network is still processing is looked at again, and posted once, when ready", async () => {
  const stored = new Map([["p1_a", "video"]]);
  const { worker, replied, advance, db } = setup({
    thread: [{ id: "a", text: "Clip", delay: 0, files: ["p1_a"] }],
    stored,
    reply: (ctx, count) => (count < 3 ? { state: "processing", publishId: ctx.pending ?? "media:1:9" } : { state: "sent", publishId: "x-reply" }),
  });
  await worker.tick();
  assert.equal(db.tables.post_replies[0].state, "queued");
  assert.equal(db.tables.post_replies[0].publish_id, "media:1:9");
  advance(MINUTE);
  await worker.tick();
  advance(MINUTE);
  await worker.tick();
  assert.equal(replied.length, 3);
  // Uploaded once: the later looks bring the upload back instead of the files.
  assert.deepEqual(replied.map((call) => [call.files.length, call.pending ?? null]), [
    [1, null],
    [0, "media:1:9"],
    [0, "media:1:9"],
  ]);
  assert.equal(db.tables.post_replies[0].state, "sent");
  assert.equal(db.tables.post_replies[0].attempts, 1);
});
