import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import * as gateway from "../gateway/relay.mjs";

import { SECRET_HEADER, SENDER_PORT, onlyFromGateway } from "./gateway-link.mjs";
import { createPhotos } from "./photos.mjs";

const SECRET = "the-shared-secret";
const quiet = { error() {} };

function serve(t, handler) {
  const server = createServer(handler);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("the publisher and the gateway agree on where and how they meet", () => {
  assert.deepEqual([SENDER_PORT, SECRET_HEADER], [gateway.SENDER_PORT, gateway.SECRET_HEADER]);
});

test("the publisher answers only someone with the secret", async (t) => {
  const reached = [];
  const answer = (req, res) => {
    reached.push(req.url);
    res.end("ok");
  };
  const port = await serve(t, onlyFromGateway(SECRET, answer));
  const ask = (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
  assert.equal((await ask("/api/publisher/logins")).status, 403);
  assert.equal((await ask("/api/publisher/logins", { [SECRET_HEADER]: "wrong" })).status, 403);
  assert.equal((await ask("/api/publisher/logins", { [SECRET_HEADER]: `${SECRET}x` })).status, 403);
  assert.deepEqual(reached, []);
  assert.equal((await ask("/api/publisher/logins", { [SECRET_HEADER]: SECRET })).status, 200);
  assert.equal((await ask("/api/publisher/health")).status, 200);
  assert.equal((await ask("/api/publisher/health/more")).status, 403);
});

test("a publisher with no secret lets nobody in, not even with an empty one", async (t) => {
  const port = await serve(t, onlyFromGateway("", (_req, res) => res.end("ok")));
  const ask = (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
  assert.equal((await ask("/api/publisher/logins")).status, 403);
  assert.equal((await ask("/api/publisher/logins", { [SECRET_HEADER]: "" })).status, 403);
  assert.equal((await ask("/api/publisher/health")).status, 200);
});

test("a network's signed link works through the real gateway and the publisher, and a forged one doesn't", async (t) => {
  const stored = Buffer.from("stored picture");
  const photos = createPhotos({
    key: "k".repeat(64),
    publicUrl: "https://plan.video",
    media: {
      postFile: async (_user, id) => ({ id, key: `posts/u1/${id}`, size: stored.length, type: "image/png", kind: "image" }),
      bytes: async () => stored,
    },
    maker: { make: async (shape, load) => Buffer.from(`${shape} made from ${await load()}`) },
  });
  const senderPort = await serve(t, onlyFromGateway(SECRET, (req, res) => photos.serve(req, res, req.url)));
  const port = await serve(t, gateway.createRelay({ secret: SECRET, port: senderPort, log: quiet }));
  const path = new URL(photos.link("u1", "p1")).pathname;
  const made = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(made.status, 200);
  assert.equal(await made.text(), "tiktok made from stored picture");
  assert.equal((await fetch(`http://127.0.0.1:${port}${path.replace("/p1/", "/p2/")}`)).status, 404);
});

test("a gateway with another secret gets nothing from the publisher", async (t) => {
  const senderPort = await serve(t, onlyFromGateway(SECRET, (_req, res) => res.end("{}")));
  const port = await serve(t, gateway.createRelay({ secret: "stale", port: senderPort, log: quiet }));
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/publisher/logins`, { method: "POST", body: "{}" })).status, 403);
});
