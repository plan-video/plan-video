import assert from "node:assert/strict";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { cleanSession, createVault, sealer } from "./vault.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");

test("a sealed login opens only for its own account and connection", () => {
  const box = sealer(KEY);
  const sealed = box.seal({ accessToken: "secret" }, "u1:c1");
  assert.ok(!sealed.includes("secret"));
  assert.deepEqual(box.open(sealed, "u1:c1"), { accessToken: "secret" });
  assert.throws(() => box.open(sealed, "u2:c1"));
  assert.throws(() => sealer(Buffer.alloc(32, 8).toString("base64")).open(sealed, "u1:c1"));
});

test("only the fields a login needs are kept", () => {
  assert.deepEqual(cleanSession("tiktok", { openId: "o", accessToken: "a", refreshToken: "r", expiresAt: 5, scope: "s", extra: "x" }), {
    openId: "o",
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 5,
    scope: "s",
  });
  assert.equal(cleanSession("bluesky", { did: "did:plc:x", pds: "http://insecure", refreshJwt: "r" }), null);
  assert.equal(cleanSession("myspace", { accessToken: "a" }), null);
});

test("a login about to run out is refreshed once, and the new refresh token kept", async (t) => {
  const db = fakeDb();
  const vault = createVault({ db, key: KEY, env: { tiktok: { clientKey: "k", clientSecret: "s" } } });
  await vault.put("u1", "c1", "tiktok", { openId: "o", accessToken: "old", refreshToken: "r1", expiresAt: Date.now() + 1000, scope: "video.publish" });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 86400, scope: "video.publish" }), { status: 200 });
  });
  const [a, b] = await Promise.all([vault.fresh("u1", "c1"), vault.fresh("u1", "c1")]);
  assert.equal(calls, 1);
  assert.equal(a.session.accessToken, "new");
  assert.equal(b.session.accessToken, "new");
  const kept = await vault.read("u1", "c1");
  assert.equal(kept.session.refreshToken, "r2");
  await vault.fresh("u1", "c1");
  assert.equal(calls, 1);
});

test("a login that can't be refreshed asks to connect again", async (t) => {
  const db = fakeDb();
  const vault = createVault({ db, key: KEY, env: { youtube: { clientId: "i", clientSecret: "s" } } });
  await vault.put("u1", "c1", "youtube", { channelId: "ch", accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
  await assert.rejects(vault.fresh("u1", "c1"), (error) => error.expired && /Connect the channel again/.test(error.message));
  await assert.rejects(vault.fresh("u1", "nope"), /isn't on plan.video/);
});

test("a refresh doesn't write over a login saved meanwhile, nor bring back a removed one", async (t) => {
  const db = fakeDb();
  const vault = createVault({ db, key: KEY, env: { tiktok: { clientKey: "k", clientSecret: "s" } } });
  await vault.put("u1", "c1", "tiktok", { openId: "o", accessToken: "old", refreshToken: "r1", expiresAt: 0, scope: "" });
  t.mock.method(globalThis, "fetch", async () => {
    // A reconnect lands while the refresh is out.
    await vault.put("u1", "c1", "tiktok", { openId: "o", accessToken: "reconnected", refreshToken: "r9", expiresAt: Date.now() + 86_400_000, scope: "" });
    return new Response(JSON.stringify({ access_token: "refreshed", refresh_token: "r2", expires_in: 86400 }), { status: 200 });
  });
  const login = await vault.fresh("u1", "c1");
  assert.equal(login.session.accessToken, "reconnected");
  assert.equal((await vault.read("u1", "c1")).session.refreshToken, "r9");
});

test("an account-name-only Bluesky login needs its ticket checked first", async () => {
  const vault = createVault({ db: fakeDb(), key: KEY, env: {} });
  await assert.rejects(vault.put("u1", "c1", "bluesky", { oauth: true, did: "did:plc:x" }), /isn't a login/);
  await vault.put("u1", "c1", "bluesky", { oauth: true, did: "did:plc:x", owner: "u2" }, { allowOAuth: true });
  assert.deepEqual((await vault.read("u1", "c1")).session, { did: "did:plc:x", oauth: true, owner: "u1" });
});
