import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { createMedia } from "./media.mjs";

const turn = () => new Promise((resolve) => setImmediate(resolve));

/** A stand-in for R2: `answer` gets each request. */
async function store(t, answer, timeouts) {
  const server = createServer(answer);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  return createMedia({ R2_ENDPOINT: `http://127.0.0.1:${port}`, R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" }, timeouts);
}

const startsThenStalls = (_req, res) => {
  res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "10" });
  res.write("12345");
};

const retryable = (error) => error instanceof PublishError && error.retry === true;

/** Moves the clock on until `work` settles, past each timer as it comes up. */
async function settled(t, work, ms) {
  let done = false;
  const watched = work.finally(() => {
    done = true;
  });
  watched.catch(() => {});
  for (let index = 0; !done && index < 10_000; index++) {
    await turn();
    if (!done) t.mock.timers.tick(ms);
  }
  return watched;
}

test("a download that stops halfway fails, to be tried again, instead of holding the send for ever", async (t) => {
  const media = await store(t, startsThenStalls, { idleMs: 60_000 });
  const reader = (await media.stream("posts/u1/p1")).getReader();
  assert.equal(Buffer.from((await reader.read()).value).toString(), "12345");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await assert.rejects(settled(t, reader.read(), 60_001), retryable);
  await assert.rejects(settled(t, media.bytes("posts/u1/p1", 0, 9), 60_001), retryable);
});

test("a store that takes the request and never answers fails too", async (t) => {
  const asked = [];
  let heard;
  const media = await store(t, (req) => {
    asked.push(req.url);
    heard?.();
  }, { requestMs: 60_000 });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const start of [() => media.postFile("u1", "p1"), () => media.bytes("posts/u1/p1", 0, 9)]) {
    const reached = new Promise((resolve) => (heard = resolve));
    const work = start();
    work.catch(() => {});
    await reached;
    await assert.rejects(settled(t, work, 60_001), retryable);
  }
  assert.ok(asked.length >= 2);
});

test("a big file that keeps coming, however slowly, isn't cut off", async (t) => {
  let client;
  const media = await store(t, (_req, res) => {
    client = res;
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "10" });
    res.write("12345");
  }, { idleMs: 60_000 });
  const reader = (await media.stream("posts/u1/p1")).getReader();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(Buffer.from((await reader.read()).value).toString(), "12345");
  let next = reader.read();
  await turn();
  t.mock.timers.tick(59_000);
  client.write("678");
  assert.equal(Buffer.from((await next).value).toString(), "678");
  next = reader.read();
  await turn();
  t.mock.timers.tick(59_000);
  client.end("90");
  assert.equal(Buffer.from((await next).value).toString(), "90");
  assert.equal((await reader.read()).done, true);
});

test("a download waiting on a slow network it's going to isn't taken for a stalled one", async (t) => {
  let client;
  const media = await store(t, (_req, res) => {
    client = res;
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": "10" });
    res.write("12345");
  }, { idleMs: 60_000 });
  const reader = (await media.stream("posts/u1/p1")).getReader();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await reader.read();
  await turn();
  t.mock.timers.tick(10 * 60_000);
  client.end("67890");
  assert.equal(Buffer.from((await reader.read()).value).toString(), "67890");
});

test("a download comes through whole, and only the part asked for", async (t) => {
  let range;
  const media = await store(t, (req, res) => {
    range = req.headers.range;
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Length": "4" });
    res.end("3456");
  });
  assert.equal((await media.bytes("posts/u1/p1", 2, 5)).toString(), "3456");
  assert.equal(range, "bytes=2-5");
  const chunks = [];
  for await (const chunk of await media.stream("posts/u1/p1", [2, 5])) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "3456");
});
