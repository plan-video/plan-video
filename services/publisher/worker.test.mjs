import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createPlanLimits } from "./plans.mjs";
import { GRACE_MS, LATE, accountsFor, createWorker, nextUuid } from "./worker.mjs";

const T0 = Date.parse("2026-10-12T16:00:00Z");
const VIDEO = { key: "posts/u1/p1", size: 10, type: "video/mp4", kind: "video" };
const picture = (id) => ({ key: `posts/u1/${id}`, size: 10, type: "image/jpeg", kind: "image" });

function setup({ posts, send, check, publish, file = VIDEO, sendFrom = 0 } = {}) {
  let clock = T0;
  /** What cloud storage has, by file id. A post saved before posts listed their files keeps its one under its own id. */
  const stored = new Map([["p1", file]]);
  /** The file ids looked for in storage. */
  const looked = [];
  const db = fakeDb({ posts });
  const calls = [];
  const published = [];
  const network = (name) => ({
    needsFile: name !== "bluesky",
    async send(ctx) {
      const keys = ctx.files.map((item) => item.key);
      calls.push({ name, post: ctx.post.id, title: ctx.post.title, connection: ctx.delivery.connection_id, file: keys[0] ?? null, files: keys });
      return send ? send(name, ctx) : { state: "sent", publishId: `${name}-id` };
    },
    async check(ctx) {
      return check ? check(name, ctx) : { state: "sent", publishId: ctx.delivery.publish_id };
    },
  });
  // Like LinkedIn and X, which make the post only once check finds the file ready.
  const linkedin = {
    ...network("linkedin"),
    needsFile: false,
    async publish(ctx) {
      published.push(ctx.delivery.id);
      return publish ? publish(ctx) : { state: "sent", publishId: "linkedin-id" };
    },
  };
  const vault = { fresh: async () => ({ platform: "x", session: { accessToken: "a" } }) };
  const media = {
    async postFile(_userId, id) {
      looked.push(id);
      const found = stored.get(id);
      return found ? { ...found, id } : null;
    },
  };
  // The service as it starts; starting another on the same database is a restart.
  const start = () =>
    createWorker({
      db,
      vault,
      media,
      networks: { tiktok: network("tiktok"), youtube: network("youtube"), bluesky: network("bluesky"), linkedin },
      sendFrom,
      now: () => clock,
      log: { error() {} },
    });
  return {
    db,
    worker: start(),
    restart: start,
    calls,
    published,
    looked,
    advance: (ms) => (clock += ms),
    setClock: (time) => (clock = time),
    setFile: (next, id = "p1") => stored.set(id, next),
  };
}

const scheduled = (post = {}) => ({
  user_id: "u1",
  workspace_id: "w1",
  time_zone: "UTC",
  connections: [
    { id: "tt1", platform: "tiktok" },
    { id: "yt1", platform: "youtube" },
  ],
  post: { id: "p1", day: "2026-10-12", start: "16:00", timeZone: "UTC", status: "scheduled", platforms: ["tiktok", "youtube"], title: "Hi", ...post },
});

test("a due post goes out once to each network, however many ticks run", async () => {
  const { db, worker, calls, advance } = setup({ posts: [scheduled()] });
  await worker.tick();
  advance(30_000);
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name).sort(), ["tiktok", "youtube"]);
  assert.deepEqual(db.tables.post_deliveries.map((row) => row.state), ["sent", "sent"]);
});

test("each workspace's posts go out from its own accounts", async () => {
  // One id is one post now (the database's key), so another workspace's post has its own id.
  const theirs = { ...scheduled({ id: "p0", title: "Theirs", platforms: ["bluesky"] }), workspace_id: "w0", connections: [{ id: "bs0", platform: "bluesky" }] };
  const { worker, calls } = setup({ posts: [theirs, scheduled()] });
  await worker.tick();
  const byNetwork = Object.fromEntries(calls.map((call) => [call.name, call]));
  assert.equal(byNetwork.tiktok.title, "Hi");
  assert.equal(byNetwork.youtube.title, "Hi");
  assert.equal(byNetwork.bluesky.title, "Theirs");
  assert.equal(byNetwork.bluesky.connection, "bs0");
});

test("Post now in a workspace sends only a post of that workspace", async () => {
  const { worker, calls } = setup({ posts: [scheduled({ start: "18:00" })] });
  await assert.rejects(worker.request("u1", "p1", "w0"), /isn't saved yet/);
  await worker.tick();
  assert.equal(calls.length, 0);
});

test("a post that isn't due yet waits", async () => {
  const { db, worker, calls } = setup({ posts: [scheduled({ start: "16:30" })] });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries.length, 0);
});

test("runs due before the publisher started aren't sent", async () => {
  const { worker, calls } = setup({ posts: [scheduled()], sendFrom: T0 + 1 });
  await worker.tick();
  assert.equal(calls.length, 0);
});

test("a run that came due over a day ago, while the publisher was down, fails with a reason instead of being dropped", async () => {
  const { db, worker, calls, setClock } = setup({ posts: [scheduled()], sendFrom: T0 - 60_000 });
  setClock(T0 + 3 * GRACE_MS);
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.deepEqual(
    db.tables.post_deliveries.map((row) => [row.platform, row.state, row.error, row.due_at]),
    [
      ["tiktok", "failed", LATE, new Date(T0).toISOString()],
      ["youtube", "failed", LATE, new Date(T0).toISOString()],
    ],
  );
  // Post now still sends it.
  await worker.request("u1", "p1");
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name).sort(), ["tiktok", "youtube"]);
  assert.deepEqual(db.tables.post_deliveries.map((row) => row.state), ["sent", "sent"]);
});

test("a series' runs missed while the publisher was down fail, and the ones still in time go out", async () => {
  const series = scheduled({ day: "2026-10-12", start: "16:00", recurrence: "every:1:day", platforms: ["tiktok"] });
  const { db, worker, calls, setClock } = setup({ posts: [series], sendFrom: T0 - 60_000 });
  // Down from just before the first run until an hour after the fourth: only that one is less than a day old.
  setClock(T0 + 3 * GRACE_MS + 60 * 60_000);
  await worker.tick();
  const byDay = Object.fromEntries(db.tables.post_deliveries.map((row) => [row.occurrence, [row.state, row.error]]));
  assert.deepEqual(byDay, {
    "2026-10-12": ["failed", LATE],
    "2026-10-13": ["failed", LATE],
    "2026-10-14": ["failed", LATE],
    "2026-10-15": ["sent", null],
  });
  assert.equal(calls.length, 1);
});

test("a run that went out stays sent once it's over a day old", async () => {
  const { db, worker, restart, calls, advance } = setup({ posts: [scheduled()], sendFrom: T0 - 60_000 });
  await worker.tick();
  advance(2 * GRACE_MS);
  await worker.tick();
  // A restart looks through every run again, and still leaves it.
  await restart().tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(db.tables.post_deliveries.map((row) => [row.state, row.error]), [["sent", null], ["sent", null]]);
});

test("runs due before the publisher started stay without a row, however old", async () => {
  const { db, worker, setClock } = setup({ posts: [scheduled()], sendFrom: T0 + 1 });
  setClock(T0 + 3 * GRACE_MS);
  await worker.tick();
  assert.equal(db.tables.post_deliveries.length, 0);
});

test("a network with no account connected fails with a reason, without sending", async () => {
  const post = scheduled({ platforms: ["tiktok", "bluesky"] });
  const { db, worker, calls } = setup({ posts: [post] });
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name), ["tiktok"]);
  const bluesky = db.tables.post_deliveries.find((row) => row.platform === "bluesky");
  assert.equal(bluesky.state, "failed");
  assert.match(bluesky.error, /Connect Bluesky/);
});

test("several accounts and none picked asks which", () => {
  const post = { platforms: ["tiktok"], accounts: {} };
  assert.deepEqual(accountsFor(post, "tiktok", [{ id: "a", platform: "tiktok" }, { id: "b", platform: "tiktok" }]), []);
  assert.deepEqual(accountsFor({ ...post, accounts: { tiktok: ["b"] } }, "tiktok", [{ id: "a", platform: "tiktok" }, { id: "b", platform: "tiktok" }]), ["b"]);
  assert.deepEqual(accountsFor({ ...post, accounts: { tiktok: "a" } }, "tiktok", [{ id: "a", platform: "tiktok" }]), ["a"]);
});

test("only a post that names no account goes out from the only one connected", () => {
  const left = [{ id: "b", platform: "tiktok" }];
  assert.deepEqual(accountsFor({ accounts: {} }, "tiktok", left), ["b"]);
  assert.deepEqual(accountsFor({ accounts: { tiktok: ["gone"] } }, "tiktok", left), []);
  assert.deepEqual(accountsFor({ accounts: { tiktok: "gone" } }, "tiktok", left), []);
  assert.deepEqual(accountsFor({ accounts: { tiktok: ["gone", "b"] } }, "tiktok", left), ["b"]);
});

test("a post whose account was removed fails instead of going out from the one left, until another is picked", async () => {
  const entry = scheduled({ accounts: { tiktok: ["gone"], youtube: ["yt1"] } });
  const { db, worker, calls, advance } = setup({ posts: [entry] });
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.connection), ["yt1"]);
  const tiktok = db.tables.post_deliveries.find((row) => row.platform === "tiktok");
  assert.equal(tiktok.state, "failed");
  assert.match(tiktok.error, /^Its TikTok account was removed\./);

  entry.post.accounts = { tiktok: ["tt1"], youtube: ["yt1"] };
  advance(30_000);
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.connection), ["yt1", "tt1"]);
});

test("a send that may work later is tried again with a wait, then fails for good", async () => {
  const { db, worker, calls, advance } = setup({
    posts: [scheduled({ platforms: ["youtube"] })],
    send: () => {
      throw new PublishError("YouTube is down.", { retry: true });
    },
  });
  await worker.tick();
  let row = db.tables.post_deliveries[0];
  assert.equal(row.state, "queued");
  assert.equal(row.attempts, 1);
  assert.equal(row.next_at, new Date(T0 + 2 * 60_000).toISOString());
  for (const wait of [2, 10, 30]) {
    advance(wait * 60_000);
    await worker.tick();
  }
  row = db.tables.post_deliveries[0];
  assert.equal(calls.length, 4);
  assert.equal(row.state, "failed");
  assert.equal(row.error, "YouTube is down.");
});

test("a send that can't work fails at once", async () => {
  const { db, worker, calls } = setup({
    posts: [scheduled({ platforms: ["youtube"] })],
    send: () => {
      throw new PublishError("Add a YouTube title to the post.");
    },
  });
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "failed");
});

test("a failed post moved later goes again at its new time", async () => {
  let fail = true;
  const entry = scheduled({ platforms: ["youtube"] });
  const { db, worker, calls, setClock } = setup({
    posts: [entry],
    send: () => {
      if (fail) throw new PublishError("Nope.");
      return { state: "sent", publishId: "v1" };
    },
  });
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  fail = false;
  entry.post.start = "18:00";
  setClock(Date.parse("2026-10-12T18:00:00Z"));
  await worker.tick();
  assert.equal(calls.length, 2);
  assert.equal(db.tables.post_deliveries.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post deleted, paused or taken off a network before its turn isn't sent", async () => {
  const entry = scheduled({ platforms: ["youtube"] });
  const { db, worker, calls } = setup({ posts: [entry] });
  await worker.plan();
  entry.post.paused = true;
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.match(db.tables.post_deliveries[0].error, /paused/);
});

test("an upload the network is still processing is checked until it's up", async () => {
  let ready = false;
  const { db, worker, advance } = setup({
    posts: [scheduled({ platforms: ["tiktok"] })],
    send: () => ({ state: "processing", publishId: "pub1" }),
    check: () => (ready ? { state: "sent", publishId: "pub1" } : { state: "processing", publishId: "pub1" }),
  });
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "processing");
  advance(60_000);
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "processing");
  ready = true;
  advance(60_000);
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "sent");
  assert.equal(db.tables.post_deliveries[0].publish_id, "pub1");
});

test("a video still uploading to storage is waited for", async () => {
  const { db, worker } = setup({ posts: [scheduled({ platforms: ["youtube"] })], file: null });
  await worker.tick();
  const row = db.tables.post_deliveries[0];
  assert.equal(row.state, "queued");
  assert.match(row.error, /still uploading/);
});

/** A post to Bluesky, which also takes the words alone, from its one connected account. */
const toBluesky = (post = {}) => ({ ...scheduled({ platforms: ["bluesky"], ...post }), connections: [{ id: "bs1", platform: "bluesky" }] });

test("a post saved with a file waits for it, rather than going out as words alone", async () => {
  const { db, worker, calls, advance, setFile } = setup({ posts: [toBluesky({ files: ["p1"] })], file: null });
  // Post now saves the post as due now, so it's found while its video is still uploading.
  await worker.tick();
  advance(60_000);
  await worker.tick();
  assert.equal(calls.length, 0);
  const row = db.tables.post_deliveries[0];
  assert.equal(row.state, "queued");
  assert.equal(row.attempts, 0);
  assert.match(row.error, /media is still uploading/);
  // The upload lands, and the browser hands the post over.
  setFile(VIDEO);
  await worker.request("u1", "p1");
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.file), [VIDEO.key]);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post whose file never reaches storage fails, rather than going out as words alone", async () => {
  const { db, worker, calls, advance } = setup({ posts: [toBluesky({ files: ["p1"] })], file: null });
  await worker.tick();
  advance(30 * 60_000);
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  assert.match(db.tables.post_deliveries[0].error, /media never reached/);
});

test("a post with no file goes out as words alone where the network takes them", async () => {
  const { db, worker, calls } = setup({ posts: [toBluesky()], file: null });
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.file), [null]);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post saved with no files goes out as words alone, without looking in storage", async () => {
  const { db, worker, calls, looked } = setup({ posts: [toBluesky({ files: [] })] });
  await worker.tick();
  assert.deepEqual(looked, []);
  assert.deepEqual(calls.map((call) => call.files), [[]]);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post made from a project fails without the project's video, rather than going out as words alone", async () => {
  const { db, worker, calls, looked } = setup({ posts: [toBluesky({ projectId: "proj1", files: [] })] });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.deepEqual(looked, []);
  const row = db.tables.post_deliveries[0];
  assert.equal(row.state, "failed");
  assert.match(row.error, /project's video didn't export/);
});

test("a post made from a project from before posts listed their files fails when none is under its id", async () => {
  const { db, worker, calls } = setup({ posts: [toBluesky({ projectId: "proj1" })], file: null });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  assert.match(db.tables.post_deliveries[0].error, /project's video didn't export/);
});

test("a post made from a project waits for its video while it uploads, then goes with it", async () => {
  const { db, worker, calls, setFile } = setup({ posts: [toBluesky({ projectId: "proj1", files: ["p1"] })], file: null });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries[0].state, "queued");
  setFile(VIDEO);
  await worker.request("u1", "p1");
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.files), [[VIDEO.key]]);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post from before posts listed their files goes out with the one under its id", async () => {
  const { worker, calls, looked } = setup({ posts: [toBluesky()] });
  await worker.tick();
  assert.deepEqual(looked, ["p1"]);
  assert.deepEqual(calls.map((call) => call.files), [[VIDEO.key]]);
});

test("a post with several pictures goes out with every one, in order", async () => {
  const { db, worker, calls, setFile } = setup({ posts: [toBluesky({ files: ["p1_3", "p1", "p1_2"] })], file: picture("p1") });
  setFile(picture("p1_2"), "p1_2");
  setFile(picture("p1_3"), "p1_3");
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.files), [["posts/u1/p1_3", "posts/u1/p1", "posts/u1/p1_2"]]);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post with several pictures waits for the last one to reach storage", async () => {
  const { db, worker, calls, advance, setFile } = setup({ posts: [toBluesky({ files: ["p1", "p1_2"] })], file: picture("p1") });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.match(db.tables.post_deliveries[0].error, /media is still uploading/);
  setFile(picture("p1_2"), "p1_2");
  advance(60_000);
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.files), [["posts/u1/p1", "posts/u1/p1_2"]]);
});

test("a network with files of its own goes out with those, and the rest with the post's", async () => {
  const entry = {
    ...scheduled({ platforms: ["tiktok", "bluesky"], files: ["p1"], ownFiles: { bluesky: ["p1_2"] } }),
    connections: [
      { id: "tt1", platform: "tiktok" },
      { id: "bs1", platform: "bluesky" },
    ],
  };
  const { worker, calls, setFile } = setup({ posts: [entry] });
  setFile(picture("p1_2"), "p1_2");
  await worker.tick();
  const sent = Object.fromEntries(calls.map((call) => [call.name, call.files]));
  assert.deepEqual(sent, { tiktok: [VIDEO.key], bluesky: ["posts/u1/p1_2"] });
});

test("Post now sends at once, and the scheduled time later doesn't send it again", async () => {
  const entry = scheduled({ start: "20:00", platforms: ["youtube"] });
  const { db, worker, calls, setClock } = setup({ posts: [entry] });
  await worker.request("u1", "p1");
  await worker.tick();
  assert.equal(calls.length, 1);
  setClock(Date.parse("2026-10-12T20:00:00Z"));
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(db.tables.post_deliveries.length, 1);
});

test("Post now sends a failed network again, and leaves a sent one", async () => {
  let fail = true;
  const { db, worker, calls } = setup({
    posts: [scheduled()],
    send: (name) => {
      if (name === "tiktok" && fail) throw new PublishError("TikTok said no.");
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await worker.tick();
  fail = false;
  await worker.request("u1", "p1");
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name).sort(), ["tiktok", "tiktok", "youtube"]);
  assert.ok(db.tables.post_deliveries.every((row) => row.state === "sent"));
});

test("a repeating post goes out on each run", async () => {
  const entry = scheduled({ day: "2026-10-12", recurrence: "every:1:day", platforms: ["youtube"] });
  const { db, worker, calls, setClock } = setup({ posts: [entry] });
  await worker.tick();
  setClock(T0 + 24 * 60 * 60_000);
  await worker.tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(db.tables.post_deliveries.map((row) => row.occurrence), ["2026-10-12", "2026-10-13"]);
});

test("Retry on a repeating post sends the run that failed, and today's still goes out at its time", async () => {
  let fail = true;
  const entry = scheduled({ recurrence: "every:1:day" });
  const { db, worker, calls, setClock } = setup({
    posts: [entry],
    send: (name) => {
      if (name === "tiktok" && fail) throw new PublishError("TikTok said no.");
      return { state: "sent", publishId: `${name}-id` };
    },
  });
  await worker.tick();
  fail = false;
  setClock(Date.parse("2026-10-13T10:00:00Z"));
  await worker.request("u1", "p1");
  await worker.tick();
  const runs = () => db.tables.post_deliveries.map((row) => [row.occurrence, row.platform, row.state]);
  assert.deepEqual(runs(), [
    ["2026-10-12", "tiktok", "sent"],
    ["2026-10-12", "youtube", "sent"],
  ]);
  setClock(Date.parse("2026-10-13T16:00:00Z"));
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name), ["tiktok", "youtube", "tiktok", "tiktok", "youtube"]);
  assert.ok(db.tables.post_deliveries.filter((row) => row.occurrence === "2026-10-13").every((row) => !row.requested && row.state === "sent"));
});

test("Post now on a repeating post whose last run went out sends today's run", async () => {
  const entry = scheduled({ recurrence: "every:1:day", platforms: ["youtube"] });
  const { db, worker, setClock } = setup({ posts: [entry] });
  await worker.tick();
  setClock(Date.parse("2026-10-13T10:00:00Z"));
  await worker.request("u1", "p1");
  await worker.tick();
  assert.deepEqual(db.tables.post_deliveries.map((row) => [row.occurrence, row.state]), [
    ["2026-10-12", "sent"],
    ["2026-10-13", "sent"],
  ]);
});

test("a send the network took, whose keeping failed, is never sent again", async () => {
  const { db, worker, calls, advance } = setup({ posts: [scheduled({ platforms: ["youtube"] })] });
  await worker.plan();
  // The claim works; recording the sent post doesn't.
  const update = db.update.bind(db);
  let updates = 0;
  db.update = async (...args) => {
    if (++updates === 2) throw new Error("connection lost");
    return update(...args);
  };
  await worker.tick();
  db.update = update;
  assert.equal(calls.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "sending");
  advance(31 * 60_000);
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  assert.match(db.tables.post_deliveries[0].error, /may have gone out/);
});

// LinkedIn with a file: uploaded on send, made into a post once LinkedIn has it ready.
const onLinkedIn = (post = {}) => ({ ...scheduled({ platforms: ["linkedin"], ...post }), connections: [{ id: "li1", platform: "linkedin" }] });
const uploaded = { send: () => ({ state: "processing", publishId: "video:asset1" }), check: () => ({ state: "ready" }) };

test("a post made once the network has the file, whose keeping failed, is never made again", async () => {
  const { db, worker, published, advance } = setup({ posts: [onLinkedIn()], ...uploaded });
  await worker.tick();
  // The network makes the post; keeping it as sent doesn't work.
  const update = db.update.bind(db);
  db.update = async (table, filter, values) => {
    if (values.state === "sent") throw new Error("connection lost");
    return update(table, filter, values);
  };
  advance(60_000);
  await worker.tick();
  db.update = update;
  assert.equal(db.tables.post_deliveries[0].state, "sending");
  for (const wait of [1, 31]) {
    advance(wait * 60_000);
    await worker.tick();
  }
  assert.equal(published.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  assert.match(db.tables.post_deliveries[0].error, /may have gone out/);
});

test("a restart while the network makes the post doesn't make it again", async () => {
  let reached;
  const making = new Promise((resolve) => (reached = resolve));
  let first = true;
  const { db, worker, restart, published, advance } = setup({
    posts: [onLinkedIn()],
    ...uploaded,
    // The service stops while the network makes the post the first time, so that answer never comes.
    publish: () => {
      if (!first) return { state: "sent", publishId: "again" };
      first = false;
      reached();
      return new Promise(() => {});
    },
  });
  await worker.tick();
  advance(60_000);
  void worker.tick();
  await making;
  const after = restart();
  for (const wait of [1, 31]) {
    advance(wait * 60_000);
    await after.tick();
  }
  assert.equal(published.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  assert.match(db.tables.post_deliveries[0].error, /may have gone out/);
});

test("a post the network turns down for now is made at a later look", async () => {
  let limited = true;
  const { db, worker, published, advance } = setup({
    posts: [onLinkedIn()],
    ...uploaded,
    publish: () => {
      if (limited) throw new PublishError("Limiting posts for now.", { retry: true });
      return { state: "sent", publishId: "post1" };
    },
  });
  await worker.tick();
  advance(60_000);
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "processing");
  limited = false;
  advance(60_000);
  await worker.tick();
  assert.equal(published.length, 2);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("a post paused while the network works on its file isn't made", async () => {
  const entry = onLinkedIn();
  const { db, worker, published, advance } = setup({ posts: [entry], ...uploaded });
  await worker.tick();
  entry.post.paused = true;
  advance(60_000);
  await worker.tick();
  assert.equal(published.length, 0);
  assert.match(db.tables.post_deliveries[0].error, /paused/);
});

test("one account's broken post doesn't stop anyone else's", async () => {
  const broken = scheduled({ id: "bad id with spaces" });
  const fine = { ...scheduled(), user_id: "u2" };
  const { db, worker, calls } = setup({ posts: [broken, fine] });
  await worker.tick();
  assert.equal(calls.length, 2);
  assert.ok(db.tables.post_deliveries.every((row) => row.user_id === "u2"));
});

test("a post paused before its turn goes out once it's unpaused", async () => {
  const entry = scheduled({ platforms: ["youtube"] });
  const { db, worker, calls, advance } = setup({ posts: [entry] });
  await worker.plan();
  entry.post.paused = true;
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  entry.post.paused = false;
  advance(60_000);
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.equal(db.tables.post_deliveries[0].state, "sent");
});

test("Post now after every try is used up gets its tries back", async () => {
  let fail = true;
  const { db, worker, calls, advance } = setup({
    posts: [scheduled({ platforms: ["youtube"] })],
    send: () => {
      if (fail) throw new PublishError("Down.", { retry: true });
      return { state: "sent", publishId: "v" };
    },
  });
  await worker.tick();
  for (const wait of [2, 10, 30]) {
    advance(wait * 60_000);
    await worker.tick();
  }
  assert.equal(db.tables.post_deliveries[0].state, "failed");
  await worker.request("u1", "p1");
  assert.equal(db.tables.post_deliveries[0].attempts, 0);
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "queued");
  fail = false;
  advance(2 * 60_000);
  await worker.tick();
  assert.equal(db.tables.post_deliveries[0].state, "sent");
  assert.equal(calls.length, 6);
});

test("a repeating post moved later the same day waits for its new time", async () => {
  const entry = scheduled({ recurrence: "every:1:day", platforms: ["youtube"] });
  const { db, worker, calls, setClock } = setup({ posts: [entry] });
  await worker.plan();
  entry.post.start = "18:00";
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries[0].next_at, "2026-10-12T18:00:00.000Z");
  setClock(Date.parse("2026-10-12T18:00:00Z"));
  await worker.tick();
  assert.equal(calls.length, 1);
});

/** Every day at 23:00 in New York, which is 05:00 the next day in Amsterdam. Its first run is due at NIGHT. */
const nightly = () => scheduled({ day: "2026-10-12", start: "23:00", timeZone: "America/New_York", recurrence: "every:1:day", platforms: ["youtube"] });
const NIGHT = Date.parse("2026-10-13T03:00:00Z");
/** The same post saved by a browser in Amsterdam: the run due at NIGHT becomes the 13th's. */
const savedInAmsterdam = { day: "2026-10-13", start: "05:00", timeZone: "Europe/Amsterdam" };

test("a repeating post saved in another zone after a run doesn't send that run again", async () => {
  const entry = nightly();
  const { db, worker, calls, setClock, advance } = setup({ posts: [entry] });
  setClock(NIGHT);
  await worker.tick();
  Object.assign(entry.post, savedInAmsterdam);
  advance(30_000);
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(db.tables.post_deliveries.map((row) => [row.occurrence, row.state, row.publish_id]), [
    ["2026-10-12", "sent", "youtube-id"],
    ["2026-10-13", "sent", "youtube-id"],
  ]);
});

test("a run still processing when its post is saved in another zone is waited for, not sent again", async () => {
  let ready = false;
  const entry = nightly();
  const { db, worker, calls, setClock, advance } = setup({
    posts: [entry],
    send: () => ({ state: "processing", publishId: "pub1" }),
    check: () => (ready ? { state: "sent", publishId: "pub1" } : { state: "processing", publishId: "pub1" }),
  });
  setClock(NIGHT);
  await worker.tick();
  Object.assign(entry.post, savedInAmsterdam);
  advance(30_000);
  await worker.tick();
  assert.equal(db.tables.post_deliveries[1].state, "queued");
  ready = true;
  advance(60_000);
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(db.tables.post_deliveries.map((row) => row.state), ["sent", "sent"]);
});

test("a run stopped before its try still goes out after its post is saved in another zone", async () => {
  const entry = nightly();
  const { db, worker, calls, setClock, advance } = setup({ posts: [entry] });
  setClock(NIGHT);
  await worker.plan();
  entry.post.paused = true;
  await worker.tick();
  Object.assign(entry.post, savedInAmsterdam, { paused: false });
  advance(30_000);
  await worker.tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(db.tables.post_deliveries.map((row) => row.state), ["failed", "sent"]);
});

test("a Bluesky sign-in found in account state is never taken as a login", async () => {
  const db = fakeDb();
  const kept = [];
  db.rpc = async () => [
    { user_id: "u1", connection_id: "evil", platform: "bluesky", session: { oauth: true, did: "did:plc:victim", refreshJwt: "x" } },
    { user_id: "u1", connection_id: "c2", platform: "tiktok", session: { openId: "o", accessToken: "a", refreshToken: "r", expiresAt: 1 } },
  ];
  const worker = createWorker({ db, vault: { put: async (...args) => kept.push(args) }, media: {}, networks: {} });
  assert.equal(await worker.adopt(), 1);
  assert.deepEqual(kept.map((args) => args[1]), ["c2"]);
});

test("a post moved to a time that had already passed isn't sent on its own", async () => {
  const { db, worker, calls } = setup({ posts: [scheduled({ start: "10:00", sendFrom: new Date(T0 - 60_000).toISOString() })] });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries.length, 0);
});

test("a post saved as due now goes out, though it was saved a little after the minute it names", async () => {
  const { worker, calls, advance } = setup({ posts: [scheduled({ sendFrom: new Date(T0 + 30_000).toISOString() })] });
  advance(40_000);
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name).sort(), ["tiktok", "youtube"]);
});

test("a series resumed after a run came due skips that run and sends the next", async () => {
  const series = scheduled({ day: "2026-10-11", start: "10:00", recurrence: "every:1:day", sendFrom: "2026-10-12T15:00:00Z" });
  const { worker, calls, setClock } = setup({ posts: [series] });
  await worker.tick();
  assert.equal(calls.length, 0);
  setClock(Date.parse("2026-10-13T10:00:30Z"));
  await worker.tick();
  assert.deepEqual([...new Set(calls.map((call) => call.name))].sort(), ["tiktok", "youtube"]);
});

test("a post saved before it kept when it was timed still goes out late, within a day", async () => {
  const { worker, calls } = setup({ posts: [scheduled({ start: "10:00" })] });
  await worker.tick();
  assert.deepEqual(calls.map((call) => call.name).sort(), ["tiktok", "youtube"]);
});

test("every post due a look is planned in one pass, a page at a time, however many there are", async () => {
  const posts = Array.from({ length: 1201 }, (_, index) => ({ ...scheduled({ id: `p${index}`, platforms: ["bluesky"] }), connections: [{ id: "bs1", platform: "bluesky" }] }));
  const { db, worker } = setup({ posts });
  const asked = [];
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => {
    const rows = await rpc(name, args);
    if (name === "publisher_due") asked.push(rows.length);
    return rows;
  };
  await worker.plan();
  assert.deepEqual(asked, [200, 200, 200, 200, 200, 200, 1]);
  assert.equal(new Set(db.tables.post_deliveries.map((row) => row.post_id)).size, 1201);
});

test("the hourly look reads every scheduled post, past the database's 1000 rows an answer", async () => {
  const posts = Array.from({ length: 1201 }, (_, index) => ({ ...scheduled({ id: `p${index}`, platforms: ["bluesky"] }), connections: [{ id: "bs1", platform: "bluesky" }] }));
  const { db, worker } = setup({ posts });
  const asked = [];
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => {
    const rows = await rpc(name, args);
    if (name === "publisher_posts_after") asked.push(rows.length);
    // Like PostgREST, which answers at most 1000 rows.
    return name === "publisher_posts" ? rows.slice(0, 1000) : rows;
  };
  await worker.sweep();
  assert.deepEqual(asked, [500, 500, 201]);
});

test("the hourly look reads a database from before the paged functions in one call", async () => {
  const { db, worker } = setup({ posts: [scheduled()] });
  db.withoutPages = true;
  const asked = [];
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => (asked.push(name), rpc(name, args));
  await worker.sweep();
  assert.ok(asked.includes("publisher_posts"));
});

test("logins in account state are read a page at a time", async () => {
  const db = fakeDb();
  const asked = [];
  const logins = Array.from({ length: 600 }, (_, index) => ({ user_id: "u1", workspace_id: "w1", connection_id: `c${String(index).padStart(3, "0")}`, platform: "tiktok", session: { accessToken: "a" } }));
  db.rpc = async (name, args) => {
    asked.push({ name, after: args?.after_connection ?? null });
    return logins.filter((row) => row.connection_id > (args.after_connection ?? "")).slice(0, args.size);
  };
  const kept = [];
  const worker = createWorker({ db, vault: { put: async (...args) => kept.push(args[1]) }, media: {}, networks: {} });
  assert.equal(await worker.adopt(), 600);
  assert.deepEqual(asked, [
    { name: "publisher_legacy_logins_after", after: null },
    { name: "publisher_legacy_logins_after", after: "c499" },
  ]);
});

test("a restart in the middle of a TikTok upload that kept its id asks TikTok again rather than failing", async () => {
  let reached;
  const uploading = new Promise((resolve) => (reached = resolve));
  let first = true;
  const { db, worker, restart, calls, advance } = setup({
    posts: [scheduled({ platforms: ["tiktok"] })],
    // The upload keeps its id, then the service stops before it finishes.
    send: async (_name, ctx) => {
      if (!first) return { state: "processing", publishId: ctx.delivery.publish_id };
      first = false;
      await ctx.progress("v_pub_1");
      reached();
      return new Promise(() => {});
    },
  });
  void worker.tick();
  await uploading;
  const after = restart();
  advance(31 * 60_000);
  await after.tick();
  const [row] = db.tables.post_deliveries;
  assert.equal(calls.length, 2);
  assert.equal(row.publish_id, "v_pub_1");
  assert.equal(row.state, "processing");
});

test("a post saved on a device whose clock runs an hour fast still goes out at its time", async () => {
  // Saved at 16:00 for 16:30, by a device that thought it was 17:00.
  const post = scheduled({ start: "16:30", sendFrom: new Date(T0 + 60 * 60_000).toISOString() });
  const { db, worker, calls, advance } = setup({ posts: [post] });
  await worker.tick();
  assert.equal(calls.length, 0);
  for (let minute = 0; minute < 30; minute++) {
    advance(60_000);
    await worker.tick();
  }
  assert.deepEqual(calls.map((call) => call.name).sort(), ["tiktok", "youtube"]);
  assert.ok(db.tables.post_deliveries.every((row) => row.state === "sent"));
});

test("a fast device clock doesn't let a post moved into the past go out on its own", async () => {
  // Moved at 16:00 to 15:00, by a device that thought it was 16:10.
  const { db, worker, calls } = setup({ posts: [scheduled({ start: "15:00", sendFrom: new Date(T0 + 10 * 60_000).toISOString() })] });
  await worker.tick();
  assert.equal(calls.length, 0);
  assert.equal(db.tables.post_deliveries.length, 0);
});

/** A worker that also holds Free's scheduled posts to the plan, as the publisher runs, with Bluesky posts that need no file. */
function planned(posts) {
  const db = fakeDb({ posts });
  const sent = [];
  const errors = [];
  const bluesky = { needsFile: false, async send(ctx) { sent.push(`${ctx.delivery.user_id}/${ctx.post.id}`); return { state: "sent", publishId: "at://x" }; } };
  const worker = createWorker({
    db,
    vault: { fresh: async () => ({ platform: "bluesky", session: {} }) },
    media: { postFile: async () => null },
    networks: { bluesky },
    planLimits: createPlanLimits({ db, now: () => T0, log: { error() {} } }),
    now: () => T0,
    log: { error: (...args) => errors.push(args) },
  });
  return { db, worker, sent, errors };
}

const onBluesky = (user, post) => ({
  user_id: user,
  workspace_id: "w1",
  time_zone: "UTC",
  connections: [{ id: "bs1", platform: "bluesky" }],
  post: { id: "p1", day: "2026-10-12", start: "16:00", timeZone: "UTC", status: "scheduled", platforms: ["bluesky"], ...post },
});

const SOMEONE = "11111111-1111-4111-8111-111111111111";
const EVERYONE_ELSE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

test("one account's post that can't be read holds up nobody else's", async () => {
  for (const odd of [{ day: ["2026-10-27"] }, { start: ["08:00"] }, { platforms: { bluesky: true } }, { id: 7 }, { recurrence: "every:1:day", day: { y: 2026 } }]) {
    const { worker, sent, errors } = planned([onBluesky(SOMEONE, { id: "odd", ...odd }), onBluesky(EVERYONE_ELSE, { id: "fine" })]);
    await worker.tick();
    assert.deepEqual(sent, [`${EVERYONE_ELSE}/fine`], JSON.stringify(odd));
    assert.ok(errors.every(([message]) => !String(message).includes("planning failed")), JSON.stringify(odd));
  }
});

test("a page that ends on a post id saved as a number moves past that account instead of reading it again", async () => {
  // 500 posts whose id was saved as the number 1.0: the database orders them by the text "1.0", but they arrive as 1.
  const odd = Array.from({ length: 500 }, () => onBluesky(SOMEONE, { id: 1 }));
  const fine = onBluesky(EVERYONE_ELSE, { id: "fine" });
  const { db, worker, sent } = planned([...odd, fine]);
  const keyOf = (item) => [item.user_id, item.workspace_id, typeof item.post.id === "number" ? "1.0" : item.post.id].join("\u0000");
  let asked = 0;
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => {
    if (name !== "publisher_posts_after") return rpc(name, args);
    if (++asked > 10) throw new Error("still paging");
    // Like Postgres: the number comes back as its text, "1", which sorts before "1.0".
    const after = [args.after_user ?? "", args.after_workspace ?? "", args.after_post == null ? "" : String(args.after_post)].join("\u0000");
    return [...odd, fine].filter((item) => keyOf(item) > after).sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1)).slice(0, args.size).map((item) => structuredClone(item));
  };
  await worker.sweep();
  assert.equal(asked, 2);
  asked = 0;
  await worker.tick();
  assert.ok(sent.includes(`${EVERYONE_ELSE}/fine`));
});

test("the uuid after one is the next in the order Postgres sorts them", () => {
  assert.equal(nextUuid("11111111-1111-4111-8111-111111111111"), "11111111-1111-4111-8111-111111111112");
  assert.equal(nextUuid("0000000f-ffff-ffff-ffff-ffffffffffff"), "00000010-0000-0000-0000-000000000000");
  assert.equal(nextUuid("ffffffff-ffff-ffff-ffff-ffffffffffff"), null);
  assert.equal(nextUuid("u1"), null);
});
