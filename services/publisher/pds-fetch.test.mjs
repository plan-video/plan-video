import assert from "node:assert/strict";
import test from "node:test";

import { bluesky } from "./networks/bluesky.mjs";
import { isBlueskyServer, pdsFetch, pdsOrigin } from "./pds-fetch.mjs";

test("a login's server must be a plain https name", () => {
  assert.equal(pdsOrigin("https://bsky.social/"), "https://bsky.social");
  assert.equal(pdsOrigin("https://pds.example.org/some/path?x=1"), "https://pds.example.org");
  for (const pds of [
    "http://bsky.social",
    "https://127.0.0.1",
    "https://[::1]",
    "https://2130706433",
    "https://bsky.social:8799",
    "https://user:pass@bsky.social",
    "file:///etc/passwd",
    "not a url",
    "",
  ]) {
    assert.equal(pdsOrigin(pds), null, pds);
  }
});

test("only Bluesky's own servers count as Bluesky's", () => {
  assert.equal(isBlueskyServer("https://bsky.social"), true);
  assert.equal(isBlueskyServer("https://morel.us-east.host.bsky.network"), true);
  assert.equal(isBlueskyServer("https://bsky.network.evil.org"), false);
  assert.equal(isBlueskyServer("https://notbsky.social"), false);
});

test("a server that isn't a public name is refused before anything is sent", async (t) => {
  const calls = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  for (const pds of ["https://127.0.0.1", "https://bsky.social:2019", "http://bsky.social"]) {
    await assert.rejects(pdsFetch(pds, "com.atproto.server.refreshSession", { method: "POST" }), TypeError);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test("no request to a login's server follows a redirect", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    seen.push(new Request(url, init));
    return Response.json({ ok: true });
  });
  await pdsFetch("https://pds.someone.net/", "com.atproto.server.deleteSession", { method: "POST", redirect: "follow" });
  assert.equal(seen[0].url, "https://pds.someone.net/xrpc/com.atproto.server.deleteSession");
  assert.equal(seen[0].redirect, "error");
});

test("another server's own error words aren't shown, Bluesky's are", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Nope", message: "secret from inside" }, { status: 400 }));
  const send = (pds) =>
    bluesky.send({ post: { description: "Hi" }, session: { did: "did:plc:me", pds, accessJwt: "j" }, files: [], media: {} });
  await assert.rejects(send("https://pds.someone.net"), (error) => error.message === "Bluesky didn't take the post.");
  await assert.rejects(send("https://bsky.social"), /secret from inside/);
});
