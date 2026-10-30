import { keepNodeFetch } from "./node-fetch.mjs";

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

// Loads undici 8, as server.mjs does.
import "./bluesky-oauth.mjs";

test("uploads that set Content-Length still go out once the Bluesky client has loaded", async () => {
  keepNodeFetch();
  const server = createServer((req, res) => {
    let size = 0;
    req.on("data", (chunk) => (size += chunk.length));
    req.on("end", () => res.end(JSON.stringify({ length: req.headers["content-length"], size })));
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const bytes = Buffer.alloc(1234, 1);
    const response = await fetch(url, { method: "PUT", headers: { "Content-Length": String(bytes.length) }, body: bytes });
    assert.deepEqual(await response.json(), { length: "1234", size: 1234 });
    const empty = await fetch(url, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": "bytes */1234" } });
    assert.equal(empty.status, 200);
  } finally {
    server.close();
  }
});
