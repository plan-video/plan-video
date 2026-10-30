import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createAccountDeletion } from "./account-deletion.mjs";
import { createApi, createUsers } from "./api.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createVault } from "./vault.mjs";

const ME = "0f0f0f0f-0000-4000-8000-000000000001";
const OTHER = "0f0f0f0f-0000-4000-8000-000000000002";
const session = { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000, openId: "o", scope: "video.publish" };

async function setup({ customer = "cus_1", answers = {} } = {}) {
  const db = fakeDb();
  db.tables.user_data = [{ id: ME, stripe_customer_id: customer }, { id: OTHER, stripe_customer_id: "cus_2" }];
  db.tables.account_state = [{
    user_id: ME,
    payload: { slices: { main: { connections: [
      { id: "c-tiktok", platform: "tiktok" },
      { id: "c-old", platform: "youtube", youtube: { channelId: "ch", accessToken: "old-a", refreshToken: "old-r" } },
    ] } } },
  }];
  db.tables.bluesky_sessions.push({ user_id: ME, did: "did:plc:me", sealed: "x" }, { user_id: OTHER, did: "did:plc:other", sealed: "x" });
  const vault = createVault({ db, key: Buffer.alloc(32, 7).toString("base64"), env: {} });
  await vault.put(ME, "c-tiktok", "tiktok", session);
  await vault.put(ME, "c-x", "x", { xUserId: "u", accessToken: "xa", refreshToken: "xr" });
  await vault.put(OTHER, "c-theirs", "tiktok", session);

  const steps = [];
  const revoked = [];
  const media = { eraseUser: async (userId) => void steps.push(`files ${userId}`) };
  const bluesky = { revoke: async (userId, did) => void revoked.push(`bluesky ${userId} ${did}`) };
  const revoke = async (platform, found) => {
    revoked.push(`${platform} ${found.refreshToken}`);
    return true;
  };
  const send = async (url, init) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    steps.push(`${init.method} ${path}`);
    const answer = answers[`${init.method} ${path}`];
    if (answer === "down") throw new TypeError("fetch failed");
    if (typeof answer === "number") return new Response("{}", { status: answer });
    if (path.startsWith("/api/billing/")) assert.equal(init.headers.Authorization, "Bearer token-of-me");
    if (path === "/storage/v1/object/list/avatars") return Response.json([{ name: "photo.png" }]);
    return Response.json({});
  };
  const deletion = createAccountDeletion({
    db, vault, media, bluesky, revoke, env: {}, supabaseUrl: "https://db.test", serviceKey: "service", billingUrl: "http://127.0.0.1:8799", fetch: send,
  });
  return { db, vault, deletion, steps, revoked };
}

test("ends the plan first, then erases files and photo, ends every login, and deletes the account last", async () => {
  const { db, deletion, steps, revoked } = await setup();
  await deletion.remove(ME, "token-of-me");

  assert.deepEqual(steps, [
    "POST /api/billing/end",
    `files ${ME}`,
    "POST /storage/v1/object/list/avatars",
    "DELETE /storage/v1/object/avatars",
    `DELETE /auth/v1/admin/users/${ME}`,
  ]);
  assert.deepEqual(revoked.sort(), ["bluesky " + ME + " did:plc:me", "tiktok r", "x xr", "youtube old-r"].sort());
  assert.deepEqual(db.tables.social_tokens.map((row) => row.user_id), [OTHER]);
});

test("someone who never paid isn't sent to billing", async () => {
  const { deletion, steps } = await setup({ customer: null });
  await deletion.remove(ME, "token-of-me");
  assert.ok(!steps.some((step) => step.includes("/api/billing/")));
  assert.equal(steps.at(-1), `DELETE /auth/v1/admin/users/${ME}`);
});

test("when the plan can't be ended, nothing else happens", async () => {
  for (const answer of [502, 503, "down"]) {
    const { db, deletion, steps, revoked } = await setup({ answers: { "POST /api/billing/end": answer } });
    await assert.rejects(deletion.remove(ME, "token-of-me"), { status: 503, message: /plan couldn't be ended/ });
    assert.deepEqual(steps, ["POST /api/billing/end"]);
    assert.deepEqual(revoked, []);
    assert.equal(db.tables.social_tokens.filter((row) => row.user_id === ME).length, 2);
  }
});

test("when the files can't be erased, the account stays and keeps its logins", async () => {
  const { db, steps } = await setup();
  const failing = createAccountDeletion({
    db,
    vault: createVault({ db, key: Buffer.alloc(32, 7).toString("base64"), env: {} }),
    media: { eraseUser: async () => { throw new Error("R2 down"); } },
    bluesky: null,
    revoke: async () => assert.fail("nothing is revoked"),
    env: {},
    supabaseUrl: "https://db.test",
    serviceKey: "service",
    billingUrl: "http://127.0.0.1:8799",
    fetch: async (url, init) => (steps.push(`${init.method} ${url}`), Response.json([])),
  });
  await assert.rejects(failing.remove(ME, "token-of-me"), { status: 503, message: /files couldn't be erased/ });
  assert.ok(!steps.some((step) => step.includes("/auth/v1/admin/")));
  assert.equal(db.tables.social_tokens.filter((row) => row.user_id === ME).length, 2);
});

test("when the photo can't be removed, the account stays", async () => {
  const { deletion, steps } = await setup({ answers: { "DELETE /storage/v1/object/avatars": 500 } });
  await assert.rejects(deletion.remove(ME, "token-of-me"), { status: 503, message: /profile photo/ });
  assert.ok(!steps.some((step) => step.includes("/auth/v1/admin/")));
});

test("a failed delete in Supabase is reported; one already gone counts as done", async () => {
  const failed = await setup({ answers: { [`DELETE /auth/v1/admin/users/${ME}`]: 500 } });
  await assert.rejects(failed.deletion.remove(ME, "token-of-me"), { status: 503 });
  const gone = await setup({ answers: { [`DELETE /auth/v1/admin/users/${ME}`]: 404 } });
  await gone.deletion.remove(ME, "token-of-me");
});

test("a network that doesn't answer doesn't stop the deletion", async () => {
  const { db, vault } = await setup();
  const steps = [];
  const deletion = createAccountDeletion({
    db, vault, media: { eraseUser: async () => undefined }, bluesky: null,
    revoke: async () => { throw new Error("network down"); },
    env: {}, supabaseUrl: "https://db.test", serviceKey: "service", billingUrl: "http://127.0.0.1:8799",
    fetch: async (url, init) => (steps.push(`${init.method} ${url}`), Response.json(url.includes("/list/") ? [] : {})),
  });
  await deletion.remove(ME, "token-of-me");
  assert.equal(steps.at(-1), `DELETE https://db.test/auth/v1/admin/users/${ME}`);
});

test("a second deletion while the first runs is turned away", async () => {
  const { deletion } = await setup();
  const first = deletion.remove(ME, "token-of-me");
  await assert.rejects(deletion.remove(ME, "token-of-me"), { status: 409 });
  await first;
});

test("account/delete deletes the account of whoever signed in, even before they're let in, and forgets the sign-in", async () => {
  const asked = [];
  const forgotten = [];
  const users = {
    from: async (req, options) => (asked.push(options), { id: req.headers.authorization.slice(7) }),
    token: (req) => req.headers.authorization.slice(7),
    forget: (req) => forgotten.push(req.headers.authorization.slice(7)),
  };
  const removed = [];
  const api = createApi({ env: {}, vault: {}, worker: {}, kick: () => undefined, users, db: {}, mailer: {}, deletion: { remove: async (id, token) => void removed.push([id, token]) } });
  const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: `Bearer ${ME}` } });
  req.push("{}");
  req.push(null);
  let status = 0;
  let answer = "";
  await api(req, { writeHead: (code) => (status = code), end: (text) => (answer = text) }, "/api/publisher/account/delete");
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(answer), { deleted: true });
  assert.deepEqual(asked, [{ waiting: true }]);
  assert.deepEqual(removed, [[ME, ME]]);
  assert.deepEqual(forgotten, [ME]);
});

test("someone not let in yet is known for deleting their account only, and isn't remembered as let in", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(new URL(url).pathname);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: ME });
    return Response.json(false);
  });
  const users = createUsers({ supabaseUrl: "https://db.test", anonKey: "anon", requireInvite: true });
  // A Supabase session token: its claims carry no OAuth client.
  const token = `x.${Buffer.from(JSON.stringify({ sub: ME })).toString("base64url")}.y`;
  const req = { headers: { authorization: `Bearer ${token}` } };

  assert.deepEqual(await users.from(req, { waiting: true }), { id: ME });
  assert.equal(users.token(req), token);
  await assert.rejects(users.from(req), { status: 403 });
  assert.deepEqual(asked, ["/auth/v1/user", "/auth/v1/user", "/rest/v1/rpc/has_access"]);
});

test("a deleted account's sign-in is forgotten at once", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => (calls++, Response.json({ id: ME })));
  const users = createUsers({ supabaseUrl: "https://db.test", anonKey: "anon", requireInvite: false });
  const req = { headers: { authorization: `Bearer x.${Buffer.from("{}").toString("base64url")}.y` } };
  await users.from(req);
  await users.from(req);
  assert.equal(calls, 1);
  users.forget(req);
  await users.from(req);
  assert.equal(calls, 2);
});

test("a token granted to an outside app can't delete the account", async () => {
  const users = createUsers({ supabaseUrl: "https://db.test", anonKey: "anon", requireInvite: false });
  const req = { headers: { authorization: `Bearer x.${Buffer.from(JSON.stringify({ sub: ME, client_id: "claude" })).toString("base64url")}.y` } };
  await assert.rejects(users.from(req, { waiting: true }), { status: 401 });
});

test("erasing an account's files empties its folders, page by page, and only its own", async (t) => {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const { createMedia } = await import("./media.mjs");
  const deleted = [];
  const listed = [];
  t.mock.method(S3Client.prototype, "send", async (command) => {
    const input = command.input;
    if (command.constructor.name === "ListObjectsV2Command") {
      listed.push(input.Prefix);
      if (input.Prefix === `sent/${ME}/` && !input.ContinuationToken) return { Contents: [{ Key: `sent/${ME}/a` }], IsTruncated: true, NextContinuationToken: "next" };
      if (input.Prefix === `sent/${ME}/`) return { Contents: [{ Key: `sent/${ME}/b` }], IsTruncated: false };
      if (input.Prefix === `media/${ME}/`) return { Contents: [{ Key: `media/${ME}/m` }], IsTruncated: false };
      return { IsTruncated: false };
    }
    deleted.push(...input.Delete.Objects.map((item) => item.Key));
    return {};
  });
  const media = createMedia({ R2_ACCOUNT_ID: "acct", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });

  await media.eraseUser(ME);
  assert.deepEqual(listed, [`media/${ME}/`, `posts/${ME}/`, `projects/${ME}/`, `sent/${ME}/`, `sent/${ME}/`]);
  assert.deepEqual(deleted, [`media/${ME}/m`, `sent/${ME}/a`, `sent/${ME}/b`]);

  await assert.rejects(media.eraseUser("../other"));
  t.mock.method(S3Client.prototype, "send", async (command) =>
    command.constructor.name === "ListObjectsV2Command" ? { Contents: [{ Key: `media/${ME}/m` }], IsTruncated: false } : { Errors: [{ Key: "x", Code: "AccessDenied" }] });
  await assert.rejects(media.eraseUser(ME), /weren't deleted/);
});
