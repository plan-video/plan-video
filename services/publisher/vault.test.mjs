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
  assert.deepEqual(cleanSession("linkedin", { organizationId: "42", personId: "p", accessToken: "a", refreshToken: "r", expiresAt: 5, scope: "s" }), {
    organizationId: "42",
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 5,
    scope: "s",
  });
  assert.equal(cleanSession("linkedin", { organizationId: "urn:li:person:x", accessToken: "a" }), null);
  assert.equal(cleanSession("linkedin", { organizationId: "", personId: "p", accessToken: "a" }), null);
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

test("a Page's login renews with the Pages app, and a person's with the first", async (t) => {
  const clients = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    clients.push(new URLSearchParams(init.body).get("client_id"));
    return Response.json({ access_token: "new", expires_in: 86400 });
  });
  const db = fakeDb();
  const vault = createVault({ key: KEY, db, env: { linkedin: { clientId: "first", clientSecret: "s" }, linkedinPages: { clientId: "pages", clientSecret: "s" } } });
  await vault.put("u1", "person", "linkedin", { personId: "p", accessToken: "old", refreshToken: "r", expiresAt: Date.now() });
  await vault.put("u1", "page", "linkedin", { organizationId: "42", accessToken: "old", refreshToken: "r", expiresAt: Date.now() });
  assert.equal((await vault.fresh("u1", "person")).session.accessToken, "new");
  assert.equal((await vault.fresh("u1", "page")).session.accessToken, "new");
  assert.deepEqual(clients, ["first", "pages"]);
});

const ENV = { tiktok: { clientKey: "k", clientSecret: "s" }, linkedin: { clientId: "i", clientSecret: "s" }, youtube: { clientId: "i", clientSecret: "s" } };
const LOGINS = {
  tiktok: { openId: "o", accessToken: "old", refreshToken: "r", expiresAt: 0, scope: "" },
  linkedin: { personId: "p", accessToken: "old", refreshToken: "r", expiresAt: 0, scope: "" },
  youtube: { channelId: "c", accessToken: "old", refreshToken: "r", expiresAt: 0, scope: "" },
};

async function renewing(t, platform, answer) {
  const vault = createVault({ db: fakeDb(), key: KEY, env: ENV });
  await vault.put("u1", "c1", platform, LOGINS[platform]);
  t.mock.method(globalThis, "fetch", answer);
  return vault.fresh("u1", "c1").then(
    () => assert.fail("it should not renew"),
    (error) => error,
  );
}

for (const platform of ["tiktok", "linkedin", "youtube"]) {
  test(`${platform}: a busy login server or a lost connection is tried again, and never says to reconnect`, async (t) => {
    const answers = [
      async () => new Response("busy", { status: 503 }),
      async () => Response.json({ error: "server_error" }, { status: 500 }),
      async () => Response.json({ message: "Slow down" }, { status: 429 }),
      async () => new Response("<html>", { status: 200 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const answer of answers) {
      await t.test(String(answer), async (each) => {
        const error = await renewing(each, platform, answer);
        assert.equal(error.retry, true);
        assert.equal(error.expired, false);
        assert.doesNotMatch(error.message, /[Cc]onnect/);
      });
    }
  });

  test(`${platform}: a refresh token the network turned down means connecting again`, async (t) => {
    const error = await renewing(t, platform, async () => Response.json({ error: "invalid_grant", error_description: "The token is no good" }, { status: 400 }));
    assert.equal(error.expired, true);
    assert.equal(error.retry, false);
    assert.match(error.message, /again/);
  });
}

test("tiktok: a refusal in an answer of 200 means connecting again, and its busy words don't", async (t) => {
  const refused = await renewing(t, "tiktok", async () => Response.json({ error: "invalid_grant" }));
  assert.equal(refused.expired, true);
  await t.test("busy", async (each) => {
    const busy = await renewing(each, "tiktok", async () => Response.json({ error: "rate_limit_exceeded" }));
    assert.equal(busy.retry, true);
    assert.equal(busy.expired, false);
  });
});
