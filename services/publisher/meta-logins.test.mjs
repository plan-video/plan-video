import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApi } from "./api.mjs";
import { fakeDb } from "./fake-db.mjs";
import { exchangeCode, renewed, RENEW_AFTER_MS } from "./meta.mjs";
import { createMetaLogins } from "./meta-logins.mjs";
import { cleanSession, createVault } from "./vault.mjs";

const KEY = Buffer.alloc(32, 9).toString("base64");
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";
// Today, not a fixed day: the vault goes by the real clock when it hands out a
// login (vault.fresh), and a login renewed over a week before that is renewed
// again, at Meta. With a fixed day this test reached graph.instagram.com, and
// failed, from a week after it.
const T0 = Date.now();
const DAY = 24 * 60 * 60_000;
const ENV = {
  instagram: { appId: "ig-app", appSecret: "ig-secret" },
  facebook: { appId: "fb-app", appSecret: "fb-secret", configId: "cfg-1" },
  threads: { appId: "th-app", appSecret: "th-secret" },
};
const redirect = (network) => `https://plan.video/${network}/callback`;

/** Answers fetches from a list of [match, body, status], in any order, and keeps what was asked. */
function fakeMeta(t, routes) {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const href = String(url);
    asked.push({ url: href, method: init.method ?? "GET", body: init.body ? String(init.body) : "" });
    const found = routes.find(([match]) => (typeof match === "string" ? href.includes(match) : match.test(href)));
    if (!found) return new Response(JSON.stringify({ error: { message: `unexpected ${href}`, code: 100 } }), { status: 400 });
    const [, body, status = 200] = found;
    return new Response(JSON.stringify(typeof body === "function" ? body(href, init) : body), { status });
  });
  return asked;
}

function setup({ role = "owner", exchange } = {}) {
  const db = fakeDb({ users: [{ id: OWNER, access_level: 2 }], posts: [] });
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => (name === "publisher_workspace_connections" ? [{ workspace_id: "brand", connection_id: "ig1" }] : rpc(name, args));
  const vault = createVault({ db, key: KEY, env: ENV });
  const meta = createMetaLogins({ key: KEY, env: ENV, now: () => T0, ...(exchange ? { exchange } : {}) });
  const api = createApi({
    env: ENV,
    vault,
    worker: {},
    kick: () => undefined,
    users: {
      from: async (req) => ({ id: req.headers.authorization.slice(7) }),
      access: async (req) => (req.headers.authorization.slice(7) === MEMBER ? { role, level: 3 } : null),
    },
    limits: { limitFor: async () => 40 },
    db,
    meta,
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
  return { db, vault, ask, meta };
}

const anAccount = (network, accountId, accessToken = "token") => ({
  network,
  accountId,
  handle: "maker",
  avatarUrl: "https://cdn.test/a.jpg",
  session: { accountId, accessToken, expiresAt: network === "facebook" ? 0 : T0 + 60 * DAY, renewedAt: T0, scope: "s" },
});

test("each network's sign-in goes to Meta with plan.video's app, the state and its redirect", async () => {
  const { ask } = setup();
  const state = "6b1e3c2a-0000-4000-8000-00000000abcd";
  const ig = new URL((await ask(OWNER, "instagram/authorize", { redirectUri: redirect("instagram"), state })).url);
  assert.equal(ig.origin + ig.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(ig.searchParams.get("client_id"), "ig-app");
  assert.equal(ig.searchParams.get("state"), state);
  assert.match(ig.searchParams.get("scope"), /instagram_business_content_publish/);
  assert.match(ig.searchParams.get("scope"), /instagram_business_manage_insights/);

  const fb = new URL((await ask(OWNER, "facebook/authorize", { redirectUri: redirect("facebook"), state })).url);
  assert.match(fb.pathname, /\/dialog\/oauth$/);
  assert.equal(fb.searchParams.get("config_id"), "cfg-1");
  assert.equal(fb.searchParams.get("scope"), null);

  const th = new URL((await ask(OWNER, "threads/authorize", { redirectUri: redirect("threads"), state })).url);
  assert.equal(th.searchParams.get("client_id"), "th-app");
  assert.match(th.searchParams.get("scope"), /threads_content_publish/);
  assert.equal(th.searchParams.get("redirect_uri"), redirect("threads"));
});

test("a redirect that isn't saved, or one for another network, is refused", async () => {
  const { ask } = setup();
  const state = "6b1e3c2a-0000-4000-8000-00000000abcd";
  assert.equal((await ask(OWNER, "instagram/authorize", { redirectUri: "https://evil.test/instagram/callback", state })).status, 400);
  assert.equal((await ask(OWNER, "instagram/authorize", { redirectUri: redirect("threads"), state })).status, 400);
  assert.equal((await ask(OWNER, "instagram/exchange", { code: "c", redirectUri: redirect("facebook") })).status, 400);
});

test("a copy hosted elsewhere takes its own site's redirects, and not plan.video's", () => {
  const meta = createMetaLogins({ key: KEY, env: ENV, publicUrl: "https://social.example.com/", now: () => T0 });
  const state = "6b1e3c2a-0000-4000-8000-00000000abcd";
  const url = new URL(meta.authorize("threads", { redirectUri: "https://social.example.com/threads/callback", state }).url);
  assert.equal(url.searchParams.get("redirect_uri"), "https://social.example.com/threads/callback");
  assert.throws(() => meta.authorize("threads", { redirectUri: redirect("threads"), state }), (error) => error.status === 400);
});

test("a workspace member can't start or finish connecting", async () => {
  const { ask } = setup({ role: "member" });
  const team = { owner: OWNER, workspace: "brand" };
  assert.equal((await ask(MEMBER, "threads/authorize", { redirectUri: redirect("threads"), state: "abcdefgh-1", team })).status, 403);
  assert.equal((await ask(MEMBER, "threads/exchange", { code: "c", redirectUri: redirect("threads"), team })).status, 403);
});

test("connecting gives the browser who each account is and a ticket, never the tokens", async () => {
  const { ask } = setup({ exchange: async () => [anAccount("facebook", "111", "page-token-1"), anAccount("facebook", "222", "page-token-2")] });
  const answer = await ask(OWNER, "facebook/exchange", { code: "c", redirectUri: redirect("facebook") });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.accounts.map((account) => account.accountId), ["111", "222"]);
  assert.ok(answer.accounts.every((account) => account.ticket.startsWith("v1.")));
  assert.doesNotMatch(JSON.stringify(answer), /page-token|accessToken/);
});

test("a ticket attaches its login, only for the person and network it was made for", async () => {
  const { ask, vault, meta } = setup({ exchange: async (network) => [anAccount(network, "17841400000000001", "ig-long")] });
  const [account] = (await ask(OWNER, "instagram/exchange", { code: "c", redirectUri: redirect("instagram") })).accounts;
  assert.equal(meta.open({ person: OWNER, owner: OWNER }, "instagram", account.ticket).session.accessToken, "ig-long");
  assert.equal(meta.open({ person: MEMBER, owner: MEMBER }, "instagram", account.ticket), null);
  assert.equal(meta.open({ person: OWNER, owner: OWNER }, "threads", account.ticket), null);
  // As another network, the ticket doesn't open.
  assert.equal((await ask(OWNER, "login/save", { connectionId: "ig1", platform: "threads", session: { ticket: account.ticket } })).status, 403);
  // Nor without one.
  assert.equal((await ask(OWNER, "login/save", { connectionId: "ig1", platform: "instagram", session: { accountId: "1", accessToken: "forged" } })).status, 403);
  assert.equal((await ask(OWNER, "login/save", { connectionId: "ig1", platform: "instagram", session: { ticket: account.ticket } })).status, 200);
  const kept = await vault.read(OWNER, "ig1");
  assert.equal(kept.platform, "instagram");
  assert.equal(kept.session.accessToken, "ig-long");
  // And no browser is handed the token afterwards.
  assert.equal((await ask(OWNER, "login/access", { connectionId: "ig1" })).status, 403);
});

test("Instagram's code is swapped for a 60-day login and the professional account's id", async (t) => {
  const asked = fakeMeta(t, [
    ["api.instagram.com/oauth/access_token", { data: [{ access_token: "short", user_id: "999", permissions: "instagram_business_basic,instagram_business_content_publish" }] }],
    ["grant_type=ig_exchange_token", { access_token: "long", token_type: "bearer", expires_in: 5183944 }],
    ["/me?fields=user_id", { id: "app-scoped", user_id: "17841400000000001", username: "maker", profile_picture_url: "https://cdn.test/p.jpg" }],
  ]);
  const [account] = await exchangeCode("instagram", ENV, { code: "abc#_", redirectUri: redirect("instagram"), now: T0 });
  assert.equal(account.accountId, "17841400000000001");
  assert.equal(account.handle, "maker");
  assert.equal(account.session.accessToken, "long");
  assert.equal(account.session.expiresAt, T0 + 5183944 * 1000);
  assert.match(asked[0].body, /code=abc(&|$)/);
  assert.match(asked[0].body, /client_secret=ig-secret/);
});

test("Facebook connects each Page shared that the person can post on, following the pages of the list", async (t) => {
  fakeMeta(t, [
    [/oauth\/access_token\?client_id/, { access_token: "short-user" }],
    ["grant_type=fb_exchange_token", { access_token: "long-user" }],
    ["after=next", { data: [{ id: "333", name: "Third", access_token: "p3", tasks: ["CREATE_CONTENT"] }] }],
    ["/me/accounts", (href) => ({
      data: [
        { id: "111", name: "Studio", access_token: "p1", tasks: ["CREATE_CONTENT", "MANAGE"], picture: { data: { url: "https://cdn.test/1.jpg" } } },
        { id: "222", name: "Read only", access_token: "p2", tasks: ["ANALYZE"] },
      ],
      paging: { next: `${href.split("?")[0]}?after=next&access_token=long-user` },
    })],
  ]);
  const accounts = await exchangeCode("facebook", ENV, { code: "abc", redirectUri: redirect("facebook"), now: T0 });
  assert.deepEqual(accounts.map((account) => [account.accountId, account.handle, account.session.accessToken]), [["111", "Studio", "p1"], ["333", "Third", "p3"]]);
  assert.equal(accounts[0].avatarUrl, "https://cdn.test/1.jpg");
  assert.equal(accounts[0].session.expiresAt, 0);
});

test("Threads' code is swapped for a 60-day login", async (t) => {
  fakeMeta(t, [
    ["graph.threads.net/oauth/access_token", { access_token: "short", user_id: 555 }],
    ["th_exchange_token", { access_token: "long", expires_in: 5183944 }],
    ["/me?fields=id", { id: "555", username: "maker", threads_profile_picture_url: "https://cdn.test/t.jpg" }],
  ]);
  const [account] = await exchangeCode("threads", ENV, { code: "abc", redirectUri: redirect("threads"), now: T0 });
  assert.equal(account.accountId, "555");
  assert.equal(account.session.accessToken, "long");
});

test("a Meta login is kept only with a numeric account id and a token", () => {
  assert.equal(cleanSession("instagram", { accountId: "17841400000000001", accessToken: "t", expiresAt: 1, renewedAt: 1, scope: "s", extra: "x" }).extra, undefined);
  assert.equal(cleanSession("threads", { accountId: "not-a-number", accessToken: "t" }), null);
  assert.equal(cleanSession("facebook", { accountId: "111" }), null);
});

test("Instagram's and Threads' logins are renewed after a week in use, and a Page's never", async (t) => {
  const asked = fakeMeta(t, [["refresh_access_token", { access_token: "renewed", expires_in: 5183944 }]]);
  const session = { accountId: "1", accessToken: "old", expiresAt: T0 + 50 * DAY, renewedAt: T0, scope: "s" };
  assert.equal(await renewed("instagram", session, ENV, T0 + 2 * DAY), null);
  const next = await renewed("threads", session, ENV, T0 + RENEW_AFTER_MS + 1);
  assert.equal(next.accessToken, "renewed");
  assert.equal(next.renewedAt, T0 + RENEW_AFTER_MS + 1);
  assert.match(asked[0].url, /graph\.threads\.net\/refresh_access_token\?grant_type=th_refresh_token/);
  assert.equal(await renewed("facebook", { ...session, expiresAt: 0 }, ENV, T0 + 400 * DAY), null);
  await assert.rejects(renewed("instagram", { ...session, expiresAt: T0 - 1 }, ENV, T0), (error) => error.expired === true);
});

test("a renewal Meta turns down for a gone login asks for a reconnect; one it doesn't answer keeps the old login", async (t) => {
  const session = { accountId: "1", accessToken: "old", expiresAt: T0 + 50 * DAY, renewedAt: T0, scope: "s" };
  fakeMeta(t, [["refresh_access_token", { error: { message: "Session has expired", code: 190 } }, 400]]);
  await assert.rejects(renewed("instagram", session, ENV, T0 + RENEW_AFTER_MS + 1), (error) => error.expired === true);
  t.mock.restoreAll();
  fakeMeta(t, [["refresh_access_token", { error: { message: "busy", code: 4 } }, 400]]);
  assert.equal(await renewed("instagram", session, ENV, T0 + RENEW_AFTER_MS + 1), null);
});

test("a member reads numbers only for accounts in their workspace, and only as the network they are", async (t) => {
  const { ask, vault } = setup({ role: "member" });
  await vault.put(OWNER, "ig1", "instagram", { accountId: "17841400000000001", accessToken: "tok", expiresAt: Date.now() + 50 * DAY, renewedAt: Date.now(), scope: "s" });
  await vault.put(OWNER, "other", "instagram", { accountId: "17841400000000002", accessToken: "tok2", expiresAt: Date.now() + 50 * DAY, renewedAt: Date.now(), scope: "s" });
  const asked = fakeMeta(t, [
    ["/me/media", { data: [{ id: "m1", caption: "Hello\nworld", timestamp: "2026-10-18T10:00:00+0000", like_count: 4, comments_count: 2, insights: { data: [{ name: "views", values: [{ value: 120 }] }] } }] }],
    ["/me?fields=followers_count", { followers_count: 87 }],
  ]);
  const team = { owner: OWNER, workspace: "brand" };
  const numbers = await ask(MEMBER, "instagram/analytics", { connectionId: "ig1", team });
  assert.equal(numbers.status, 200);
  assert.equal(numbers.followers, 87);
  assert.deepEqual(numbers.videos.map((video) => [video.title, video.views, video.likes, video.comments]), [["Hello", 120, 4, 2]]);
  assert.ok(asked.every((call) => call.url.includes("access_token=tok")));
  assert.doesNotMatch(JSON.stringify(numbers), /"tok"/);
  assert.equal((await ask(MEMBER, "instagram/analytics", { connectionId: "other", team })).status, 403);
  assert.equal((await ask(MEMBER, "threads/analytics", { connectionId: "ig1", team })).status, 400);
});
