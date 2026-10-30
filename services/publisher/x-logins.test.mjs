import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { handleX } from "../x/handler.mjs";

import { createApi } from "./api.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createVault } from "./vault.mjs";
import { createXLogins } from "./x-logins.mjs";

const KEY = Buffer.alloc(32, 9).toString("base64");
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";
const T0 = Date.parse("2026-10-16T12:00:00Z");
const CODE = { code: "x-code", redirectUri: "https://plan.video/x/callback", codeVerifier: "v".repeat(43) };

function setup({ role = "owner", level = 2 } = {}) {
  const db = fakeDb({
    users: [{ id: OWNER, access_level: level }],
    posts: [{ user_id: OWNER, workspace_id: "brand", time_zone: "UTC", connections: [{ id: "x1", platform: "x" }], post: { id: "p", status: "draft", platforms: [] } }],
  });
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => (name === "publisher_workspace_connections" ? [{ workspace_id: "brand", connection_id: "x1" }] : rpc(name, args));
  const vault = createVault({ db, key: KEY, env: {} });
  const asked = [];
  const x = createXLogins({
    key: KEY,
    env: { clientId: "id", clientSecret: "secret" },
    now: () => T0,
    token: async (_env, fields) => (asked.push(fields), { accessToken: "x-access", refreshToken: "x-refresh", expiresIn: 7200, scope: "tweet.write" }),
    member: async () => ({ userId: "42", username: "maker", avatarUrl: "https://pbs.test/a.jpg" }),
  });
  const api = createApi({
    env: {},
    vault,
    worker: {},
    kick: () => undefined,
    users: {
      from: async (req) => ({ id: req.headers.authorization.slice(7) }),
      access: async (req) => (req.headers.authorization.slice(7) === MEMBER ? { role, level: 3 } : null),
    },
    limits: { limitFor: async () => 40 },
    db,
    x,
  });

  async function ask(person, route, body) {
    const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: `Bearer ${person}` } });
    req.push(JSON.stringify(body));
    req.push(null);
    let status = 0;
    let answer = "";
    const res = { writableEnded: false, writeHead: (code) => (status = code), end: (text) => (answer = text) };
    try {
      await api(req, res, `/api/publisher/${route}`);
    } catch (error) {
      return { status: error.status ?? 400, error: error.message };
    }
    return { status, ...JSON.parse(answer) };
  }
  return { db, vault, ask, asked, x };
}

test("connecting X gives the browser who the account is and a ticket, never X's tokens", async () => {
  const { ask, asked } = setup();
  const answer = await ask(OWNER, "x/exchange", CODE);
  assert.equal(answer.status, 200);
  assert.equal(answer.xUserId, "42");
  assert.equal(answer.username, "maker");
  assert.ok(answer.ticket.startsWith("v1."));
  assert.doesNotMatch(JSON.stringify(answer), /x-access|x-refresh|accessToken|refreshToken/);
  assert.deepEqual(asked, [{ grant_type: "authorization_code", code: "x-code", redirect_uri: CODE.redirectUri, code_verifier: CODE.codeVerifier }]);
});

test("the ticket attaches the account's login on the server", async () => {
  const { ask, vault } = setup();
  const { ticket, xUserId, expiresAt, scope } = await ask(OWNER, "x/exchange", CODE);
  assert.equal((await ask(OWNER, "login/save", { connectionId: "x1", platform: "x", session: { xUserId, ticket, expiresAt, scope } })).status, 200);
  const kept = await vault.read(OWNER, "x1");
  assert.equal(kept.session.refreshToken, "x-refresh");
  assert.equal(kept.session.xUserId, "42");
});

test("an X login without a ticket, or with someone else's, isn't kept", async () => {
  const { ask, vault } = setup();
  const raw = { xUserId: "42", accessToken: "stolen", refreshToken: "stolen", expiresAt: T0 * 2, scope: "s" };
  assert.equal((await ask(OWNER, "login/save", { connectionId: "x1", platform: "x", session: raw })).status, 403);
  const { ticket } = await ask(OWNER, "x/exchange", CODE);
  const stranger = "0f0f0f0f-0000-4000-8000-000000000009";
  assert.equal((await ask(stranger, "login/save", { connectionId: "x9", platform: "x", session: { xUserId: "42", ticket } })).status, 403);
  assert.deepEqual(await vault.list(OWNER), []);
});

test("Free can't connect X, and a member can't connect at all", async () => {
  assert.equal((await setup({ level: 1 }).ask(OWNER, "x/exchange", CODE)).status, 403);
  const { ask, asked } = setup({ role: "member" });
  assert.equal((await ask(MEMBER, "x/exchange", { ...CODE, team: { owner: OWNER, workspace: "brand" } })).status, 403);
  assert.equal((await ask(OWNER, "x/exchange", { ...CODE, redirectUri: "https://evil.test/x/callback" })).status, 400);
  assert.deepEqual(asked, []);
});

test("no browser gets an X access token, not even the owner", async () => {
  const { ask, vault } = setup();
  await vault.put(OWNER, "x1", "x", { xUserId: "42", accessToken: "x-access", refreshToken: "x-refresh", expiresAt: T0 * 2, scope: "s" });
  const answer = await ask(OWNER, "login/access", { connectionId: "x1" });
  assert.equal(answer.status, 403);
  assert.equal(answer.accessToken, undefined);
});

test("the X service no longer swaps codes, refreshes, or posts for a browser", async () => {
  const env = { clientId: "id", clientSecret: "secret", supabaseUrl: "https://sb.test", supabaseAnonKey: "anon", requireInvite: false };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (/sb\.test\/auth\/v1\/user/.test(text)) return new Response(JSON.stringify({ id: OWNER }));
    if (/sb\.test\/rest\/v1\/user_data/.test(text)) return new Response(JSON.stringify([{ access_level: 4 }]));
    assert.fail(`called ${text}`);
  };
  try {
    for (const route of ["exchange", "refresh", "post", "media/start", "media/append", "media/finish", "media/state"]) {
      const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: "Bearer a.e30.b" } });
      req.push(JSON.stringify({ code: "c", refreshToken: "r", accessToken: "a", text: "hi", redirectUri: CODE.redirectUri }));
      req.push(null);
      let status = 0;
      let answer = "";
      const res = { writableEnded: false, writeHead: (code) => (status = code), end: (text) => (answer = text) };
      await handleX(req, res, `/api/x/${route}`, env);
      assert.equal(status, 404, route);
      assert.doesNotMatch(answer, /accessToken|refreshToken/);
    }
  } finally {
    globalThis.fetch = original;
  }
});
