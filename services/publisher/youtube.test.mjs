import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { handleYouTube } from "../youtube/handler.mjs";

import { createApi } from "./api.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createVault } from "./vault.mjs";
import { createYouTubeLogins } from "./youtube-logins.mjs";

const KEY = Buffer.alloc(32, 9).toString("base64");
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";
const T0 = Date.parse("2026-10-15T12:00:00Z");
const CODE = { code: "google-code", redirectUri: "https://plan.video/youtube/callback", codeVerifier: "v".repeat(43) };

function logins({ clock = () => T0 } = {}) {
  const asked = [];
  const youtube = createYouTubeLogins({
    key: KEY,
    env: { clientId: "id", clientSecret: "secret" },
    now: clock,
    token: async (_env, fields) => (asked.push(fields), { accessToken: "ya29.access", refreshToken: "1//refresh", expiresIn: 3600, scope: "youtube.upload" }),
    channel: async () => ({ channelId: "UC1", handle: "maker", avatarUrl: "https://yt3.test/a.jpg" }),
  });
  return { youtube, asked };
}

function setup({ role = "owner" } = {}) {
  const db = fakeDb({ posts: [{ user_id: OWNER, workspace_id: "brand", time_zone: "UTC", connections: [{ id: "yt1", platform: "youtube" }], post: { id: "p", status: "draft", platforms: [] } }] });
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) =>
    name === "publisher_workspace_connections" ? [{ workspace_id: "brand", connection_id: "yt1" }] : rpc(name, args);
  const vault = createVault({ db, key: KEY, env: {} });
  const { youtube, asked } = logins();
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
    youtube,
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
  return { db, vault, ask, asked };
}

test("connecting a channel gives the browser who it is and a ticket, never YouTube's tokens", async () => {
  const { ask, asked } = setup();
  const answer = await ask(OWNER, "youtube/exchange", CODE);
  assert.equal(answer.status, 200);
  assert.equal(answer.channelId, "UC1");
  assert.equal(answer.handle, "maker");
  assert.ok(answer.ticket.startsWith("v1."));
  const text = JSON.stringify(answer);
  assert.doesNotMatch(text, /ya29|1\/\/refresh|accessToken|refreshToken/);
  assert.deepEqual(asked, [{ grant_type: "authorization_code", code: "google-code", redirect_uri: CODE.redirectUri, code_verifier: CODE.codeVerifier }]);
});

test("the ticket attaches the channel's login on the server", async () => {
  const { ask, vault } = setup();
  const { ticket, channelId, expiresAt, scope } = await ask(OWNER, "youtube/exchange", CODE);
  const saved = await ask(OWNER, "login/save", { connectionId: "yt1", platform: "youtube", session: { channelId, ticket, expiresAt, scope } });
  assert.equal(saved.status, 200);
  const kept = await vault.read(OWNER, "yt1");
  assert.equal(kept.session.refreshToken, "1//refresh");
  assert.equal(kept.session.channelId, "UC1");
});

test("a ticket made for someone else, or changed, attaches nothing", async () => {
  const { ask, vault } = setup();
  const { ticket } = await ask(OWNER, "youtube/exchange", CODE);
  const stranger = "0f0f0f0f-0000-4000-8000-000000000009";
  assert.equal((await ask(stranger, "login/save", { connectionId: "yt9", platform: "youtube", session: { channelId: "UC1", ticket } })).status, 403);
  const changed = `${ticket.slice(0, -4)}AAA=`;
  assert.equal((await ask(OWNER, "login/save", { connectionId: "yt1", platform: "youtube", session: { channelId: "UC1", ticket: changed } })).status, 403);
  assert.deepEqual(await vault.list(OWNER), []);
});

test("a ticket runs out after 15 minutes", async () => {
  let clock = T0;
  const { youtube } = logins({ clock: () => clock });
  const holder = { person: OWNER, owner: OWNER };
  const { ticket } = await youtube.exchange(holder, CODE);
  clock += 14 * 60_000;
  assert.equal(youtube.open(holder, ticket).session.refreshToken, "1//refresh");
  clock += 2 * 60_000;
  assert.equal(youtube.open(holder, ticket), null);
});

test("only redirects saved on the Google client are swapped, and a member can't connect", async () => {
  const { ask } = setup({ role: "member" });
  assert.equal((await ask(OWNER, "youtube/exchange", { ...CODE, redirectUri: "https://evil.test/youtube/callback" })).status, 400);
  assert.equal((await ask(MEMBER, "youtube/exchange", { ...CODE, team: { owner: OWNER, workspace: "brand" } })).status, 403);
});

test("no browser gets a YouTube access token, not even the owner", async () => {
  const { ask, vault } = setup();
  await vault.put(OWNER, "yt1", "youtube", { channelId: "UC1", accessToken: "ya29.access", refreshToken: "1//refresh", expiresAt: T0 * 2, scope: "s" });
  const answer = await ask(OWNER, "login/access", { connectionId: "yt1" });
  assert.equal(answer.status, 403);
  assert.equal(answer.accessToken, undefined);
});

test("the channel's picture and numbers come through the publisher, with the server's login", async () => {
  const { ask, vault } = setup({ role: "member" });
  await vault.put(OWNER, "yt1", "youtube", { channelId: "UC1", accessToken: "ya29.access", refreshToken: "1//refresh", expiresAt: T0 * 2, scope: "s" });
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization });
    if (String(url).includes("/channels?part=snippet")) {
      return new Response(JSON.stringify({ items: [{ id: "UC1", snippet: { title: "Maker", thumbnails: { default: { url: "https://yt3.test/a.jpg" } } } }] }));
    }
    return new Response(JSON.stringify({ rows: [["2026-10-14", 10, 2, 1]] }));
  };
  try {
    const team = { owner: OWNER, workspace: "brand" };
    const profile = await ask(MEMBER, "youtube/profile", { connectionId: "yt1", team });
    assert.equal(profile.status, 200);
    assert.equal(profile.avatarUrl, "https://yt3.test/a.jpg");
    const numbers = await ask(MEMBER, "youtube/analytics", { connectionId: "yt1", team, startDate: "2026-10-14", endDate: "2026-10-15", videoId: "abcdefgh" });
    assert.equal(numbers.status, 200);
    assert.deepEqual(numbers.days, [{ date: "2026-10-14", views: 10, likes: 2, comments: 1 }]);
    assert.ok(seen.every((call) => call.auth === "Bearer ya29.access"));
    assert.equal((await ask(MEMBER, "youtube/analytics", { connectionId: "yt1", team, startDate: "nope", endDate: "2026-10-15" })).status, 400);
    assert.equal((await ask(MEMBER, "youtube/profile", { connectionId: "yt2", team })).status, 403);
  } finally {
    globalThis.fetch = original;
  }
});

test("the YouTube service no longer swaps codes, refreshes, or relays uploads for a browser", async () => {
  const env = { clientId: "id", clientSecret: "secret", supabaseUrl: "https://sb.test", supabaseAnonKey: "anon", requireInvite: false };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /sb\.test\/auth\/v1\/user/, "nothing past sign-in is called");
    return new Response(JSON.stringify({ id: OWNER }));
  };
  try {
    for (const route of ["exchange", "refresh", "init", "upload", "status", "profile", "analytics"]) {
      const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: "Bearer a.e30.b" } });
      req.push(JSON.stringify({ code: "c", refreshToken: "r", accessToken: "a", redirectUri: CODE.redirectUri }));
      req.push(null);
      let status = 0;
      let answer = "";
      const res = { writableEnded: false, writeHead: (code) => (status = code), end: (text) => (answer = text) };
      await handleYouTube(req, res, `/api/youtube/${route}`, env);
      assert.equal(status, 404, route);
      assert.doesNotMatch(answer, /accessToken|refreshToken/);
    }
  } finally {
    globalThis.fetch = original;
  }
});
