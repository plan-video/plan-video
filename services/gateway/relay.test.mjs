import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { SECRET_HEADER, createRelay } from "./relay.mjs";

const SECRET = "the-shared-secret";
const quiet = { error() {} };

const listening = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

/** A stand-in for the publisher, and the gateway in front of it. */
async function setup(t, answer) {
  const seen = [];
  const sender = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      answer(req, res);
    });
  });
  const senderPort = await listening(sender);
  const gateway = createServer(createRelay({ secret: SECRET, port: senderPort, log: quiet }));
  const port = await listening(gateway);
  t.after(() => {
    sender.closeAllConnections();
    gateway.closeAllConnections();
    sender.close();
    gateway.close();
  });
  return { seen, url: `http://127.0.0.1:${port}`, port, sender };
}

const jsonAnswer = (status, body) => (_req, res) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
};

test("a request reaches the publisher whole, with the secret, and its answer comes back", async (t) => {
  const { seen, url } = await setup(t, jsonAnswer(409, { error: "Expired.", expired: true }));
  const answer = await fetch(`${url}/api/publisher/send?x=1`, {
    method: "POST",
    headers: { Authorization: "Bearer session", "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9", Cookie: "a=b" },
    body: JSON.stringify({ postId: "p1" }),
  });
  assert.equal(answer.status, 409);
  assert.equal(answer.headers.get("cache-control"), "no-store");
  assert.deepEqual(await answer.json(), { error: "Expired.", expired: true });
  const [got] = seen;
  assert.equal(got.method, "POST");
  assert.equal(got.url, "/api/publisher/send?x=1");
  assert.equal(got.body, '{"postId":"p1"}');
  assert.equal(got.headers.authorization, "Bearer session");
  assert.equal(got.headers["content-type"], "application/json");
  assert.equal(got.headers["x-forwarded-for"], "203.0.113.9");
  assert.equal(got.headers[SECRET_HEADER], SECRET);
  assert.equal(got.headers.cookie, undefined);
});

test("nobody can bring their own secret, or learn the real one", async (t) => {
  const { seen, url } = await setup(t, jsonAnswer(200, { ok: true }));
  const answer = await fetch(`${url}/api/publisher/logins`, { method: "POST", headers: { [SECRET_HEADER]: "guessed" }, body: "{}" });
  assert.equal(seen[0].headers[SECRET_HEADER], SECRET);
  assert.equal(answer.headers.get(SECRET_HEADER), null);
  assert.ok(!(await answer.text()).includes(SECRET));
});

test("someone with no forwarded address is known by their connection", async (t) => {
  const { seen, url } = await setup(t, jsonAnswer(200, {}));
  await fetch(`${url}/api/publisher/support`, { method: "POST", body: "{}" });
  assert.match(seen[0].headers["x-forwarded-for"], /127\.0\.0\.1/);
});

test("a request over the publisher's limit stops at the gateway", async (t) => {
  const { seen, url } = await setup(t, jsonAnswer(200, {}));
  const answer = await fetch(`${url}/api/publisher/send`, { method: "POST", body: "x".repeat(64 * 1024 + 1) });
  assert.equal(answer.status, 413);
  assert.equal(seen.length, 0);
  assert.equal((await fetch(`${url}/api/publisher/send`, { method: "POST", body: "x".repeat(64 * 1024) })).status, 200);
});

test("only the publisher's own paths go through", async (t) => {
  const { seen, url } = await setup(t, jsonAnswer(200, {}));
  assert.equal((await fetch(`${url}/`)).status, 404);
  assert.equal((await fetch(`${url}/api/publisherx/health`)).status, 404);
  assert.equal(seen.length, 0);
});

test("with the publisher down, people get a clear answer and health goes red", async (t) => {
  const { url, sender } = await setup(t, jsonAnswer(200, {}));
  await new Promise((resolve) => sender.close(resolve));
  const api = await fetch(`${url}/api/publisher/send`, { method: "POST", body: "{}" });
  assert.equal(api.status, 503);
  assert.deepEqual(await api.json(), { error: "Publishing isn't available right now." });
  const health = await fetch(`${url}/api/publisher/health`);
  assert.equal(health.status, 503);
  const body = await health.json();
  assert.equal(body.ok, false);
});

test("a video goes through as the publisher serves it, in part and by HEAD", async (t) => {
  const { seen, url } = await setup(t, (req, res) => {
    const partial = req.headers.range === "bytes=4-7";
    res.writeHead(partial ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": partial ? 4 : 16, ...(partial ? { "Content-Range": "bytes 4-7/16" } : {}) });
    res.end(req.method === "HEAD" ? undefined : partial ? "4567" : "0123456789abcdef");
  });
  const path = `${url}/api/publisher/video/u1/clip/9/sig.mp4`;
  const whole = await fetch(path);
  assert.equal(await whole.text(), "0123456789abcdef");
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  const part = await fetch(path, { headers: { Range: "bytes=4-7" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 4-7/16");
  assert.equal(await part.text(), "4567");
  const head = await fetch(path, { method: "HEAD" });
  assert.equal(head.headers.get("content-length"), "16");
  assert.equal(seen.at(-1).method, "HEAD");
});

test("someone leaving mid-video stops the publisher's side too", async (t) => {
  let gone;
  const senderSaw = new Promise((resolve) => (gone = resolve));
  const started = Promise.withResolvers();
  const { url } = await setup(t, (_req, res) => {
    res.on("close", gone);
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": 1_000_000 });
    res.write("first", () => started.resolve());
  });
  const stop = new AbortController();
  const answer = await fetch(`${url}/api/publisher/video/u1/clip/9/sig.mp4`, { signal: stop.signal });
  const reader = answer.body.getReader();
  await reader.read();
  await started.promise;
  stop.abort();
  await senderSaw;
});

test("someone leaving before the publisher answers stops its side too", async (t) => {
  const arrived = Promise.withResolvers();
  const gone = Promise.withResolvers();
  const { url } = await setup(t, (_req, res) => {
    res.on("close", gone.resolve);
    arrived.resolve();
  });
  const stop = new AbortController();
  const asked = fetch(`${url}/api/publisher/account/delete`, { method: "POST", body: "{}", signal: stop.signal }).catch(() => null);
  await arrived.promise;
  stop.abort();
  await gone.promise;
  await asked;
});

test("a picture goes through as the publisher made it, and a forged link isn't found", async (t) => {
  const { seen, url } = await setup(t, (req, res) => {
    if (req.url.includes("forged")) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return;
    }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": 4, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : "jpeg");
  });
  const made = await fetch(`${url}/api/publisher/photo/feed/u1/p1/9/sig.jpg`);
  assert.equal(await made.text(), "jpeg");
  assert.equal(made.headers.get("cache-control"), "private, max-age=3600");
  assert.equal(made.headers.get("x-content-type-options"), "nosniff");
  assert.equal(seen[0].url, "/api/publisher/photo/feed/u1/p1/9/sig.jpg");
  assert.equal((await fetch(`${url}/api/publisher/photo/u1/p1/9/sig.jpg`, { method: "HEAD" })).headers.get("content-length"), "4");
  assert.equal((await fetch(`${url}/api/publisher/photo/u1/forged/9/sig.jpg`)).status, 404);
});
