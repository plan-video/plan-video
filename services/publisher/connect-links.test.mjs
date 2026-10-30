import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";

import { createApi } from "./api.mjs";
import { createConnectLinks } from "./connect-links.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createMetaLogins } from "./meta-logins.mjs";
import { createVault } from "./vault.mjs";
import { createXLogins } from "./x-logins.mjs";
import { createYouTubeLogins } from "./youtube-logins.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const ADMIN = "0f0f0f0f-0000-4000-8000-000000000002";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";
const T0 = Date.parse("2026-10-30T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const DID = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const META_ENV = {
  instagram: { appId: "ig", appSecret: "s" },
  facebook: { appId: "fb", appSecret: "s", configId: "c" },
  threads: { appId: "th", appSecret: "s" },
};
const ENV = { youtube: { clientId: "yt", clientSecret: "s" }, x: { clientId: "x", clientSecret: "s" }, tiktok: {}, linkedin: {}, ...META_ENV };
const YOUTUBE_CODE = { network: "youtube", code: "g", redirectUri: "https://plan.video/youtube/callback", codeVerifier: "v".repeat(43) };

/** The connect_link_keep function, as the migration has it, over the fake tables. */
function keepFor(db, clock) {
  return ({ link, connection }) => {
    const row = db.tables.connect_links.find((item) => item.id === link && !item.revoked_at && Date.parse(item.expires_at) > clock.now);
    if (!row) return false;
    const state = db.tables.account_state.find((item) => item.user_id === row.owner_id);
    const slice = state?.payload?.slices?.[row.workspace_id];
    if (!slice) return false;
    const list = slice.connections ?? [];
    const at = list.findIndex((item) => item.id === connection.id);
    if (at === -1) list.push(structuredClone(connection));
    else {
      const { connectedAt: _kept, ...rest } = connection;
      list[at] = { ...list[at], ...structuredClone(rest) };
    }
    slice.connections = list;
    state.payload.revision = `r-${Math.random()}`;
    row.connected += 1;
    return true;
  };
}

async function setup(t, { level = 2, limit = 40, connections = [] } = {}) {
  const clock = { now: T0 };
  const now = () => clock.now;
  t.mock.method(Date, "now", now);
  const db = fakeDb({ users: [{ id: OWNER, access_level: level }] });
  db.tables.connect_links = [];
  db.tables.account_state.push({
    user_id: OWNER,
    payload: {
      revision: "r0",
      workspaces: { active: "default", list: [{ id: "default", name: "Personal" }, { id: "brand", name: "Acme" }] },
      slices: { default: { connections: [] }, brand: { connections: structuredClone(connections) } },
    },
  });
  const rpc = db.rpc.bind(db);
  const keep = keepFor(db, clock);
  db.rpc = async (name, args) => (name === "connect_link_keep" ? keep(args) : name === "publisher_workspace_connections" ? [] : rpc(name, args));
  const vault = createVault({ db, key: KEY, env: {} });
  const youtube = createYouTubeLogins({
    key: KEY,
    env: ENV.youtube,
    now,
    token: async () => ({ accessToken: "ya29.youtube-access", refreshToken: "1//youtube-refresh", expiresIn: 3600, scope: "youtube.upload" }),
    channel: async () => ({ channelId: "UC1", handle: "acme", avatarUrl: "https://yt3.test/a.jpg" }),
  });
  const x = createXLogins({
    key: KEY,
    env: ENV.x,
    now,
    token: async () => ({ accessToken: "x-access", refreshToken: "x-refresh", expiresIn: 7200, scope: "tweet.write" }),
    member: async () => ({ userId: "42", username: "acme", avatarUrl: "" }),
  });
  const meta = createMetaLogins({
    key: KEY,
    env: META_ENV,
    now,
    exchange: async (network) =>
      ["1001", "1002"].map((accountId) => ({ accountId, handle: `page ${accountId}`, avatarUrl: "", session: { accountId, accessToken: `${network}-token-${accountId}`, expiresAt: 0, renewedAt: clock.now, scope: "s" } })),
  });
  const ticketKey = createHmac("sha256", Buffer.from(KEY, "base64")).update("bluesky-ticket").digest();
  const mac = (holder, did, until, nonce) => createHmac("sha256", ticketKey).update(JSON.stringify([holder.person, holder.owner, holder.workspace ?? "", did, until, nonce])).digest("base64url");
  const bluesky = {
    started: [],
    async authorize(owner, handle) {
      this.started.push({ owner, handle });
      return "https://bsky.social/oauth/authorize?x=1";
    },
    async callback(holder) {
      const until = String(Date.now() + 15 * 60_000);
      const nonce = "ab".repeat(12);
      return { did: DID, ticket: `${until}.${nonce}.${mac(holder, DID, until, nonce)}` };
    },
    openTicket(holder, did, ticket) {
      const [until, nonce, given] = ticket.split(".");
      return given === mac(holder, did, until, nonce) && Number(until) > Date.now() ? { nonce, until: Number(until) } : null;
    },
  };
  const limits = { limitFor: async () => limit };
  const links = createConnectLinks({ db, key: KEY, vault, limits, env: ENV, youtube, x, meta, bluesky, profile: async () => ({ handle: "acme.bsky.social", avatarUrl: "" }), now });
  const roles = { [`${ADMIN}|brand`]: "admin", [`${MEMBER}|brand`]: "member" };
  const api = createApi({
    env: ENV,
    vault,
    worker: {},
    kick: () => undefined,
    users: {
      from: async (req) => {
        const header = req.headers.authorization ?? "";
        if (!header) throw Object.assign(new Error("Sign in to plan.video first."), { status: 401 });
        return { id: header.slice(7) };
      },
      access: async (req, owner, workspace) => {
        const role = owner === OWNER ? roles[`${req.headers.authorization.slice(7)}|${workspace}`] : undefined;
        return role ? { role, level } : null;
      },
    },
    limits,
    db,
    youtube,
    x,
    meta,
    bluesky,
    links,
    now,
  });

  async function ask(person, route, body) {
    const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: person ? { authorization: `Bearer ${person}` } : {}, socket: { remoteAddress: "203.0.113.9" } });
    req.push(JSON.stringify(body));
    req.push(null);
    let status = 0;
    let answer = "";
    const res = { writeHead: (code) => (status = code), end: (text) => (answer = text) };
    try {
      await api(req, res, `/api/publisher/${route}`);
    } catch (error) {
      return { status: error.status ?? 400, error: error.message };
    }
    return { status, ...JSON.parse(answer) };
  }

  const brand = () => db.tables.account_state[0].payload.slices.brand.connections;
  return { db, vault, links, ask, clock, brand, bluesky };
}

async function ownerLink(ask) {
  const made = await ask(OWNER, "connect-link/create", { workspace: "brand", workspaceName: "Acme", fromName: "Sam" });
  assert.equal(made.status, 200, made.error);
  return made.link.link;
}

test("a client with the link sees whose workspace it is and what they can connect, without signing in", async (t) => {
  const { ask } = await setup(t);
  const link = await ownerLink(ask);
  assert.match(link, /^[A-Za-z0-9_-]{38}$/);
  const opened = await ask(null, "connect-link/open", { link });
  assert.equal(opened.status, 200, opened.error);
  assert.equal(opened.workspace, "Acme");
  assert.equal(opened.from, "Sam");
  assert.deepEqual(opened.networks, ["x", "instagram", "youtube", "facebook", "threads", "bluesky"]);
  assert.equal(Date.parse(opened.expiresAt), T0 + 7 * DAY);
});

test("X isn't offered for an owner on Free, as Connections doesn't offer it", async (t) => {
  const { ask } = await setup(t, { level: 1 });
  const link = await ownerLink(ask);
  const opened = await ask(null, "connect-link/open", { link });
  assert.ok(!opened.networks.includes("x"));
  const refused = await ask(null, "connect-link/authorize", { link, network: "x", redirectUri: "https://plan.video/x/callback", state: "s".repeat(20), codeChallenge: "c".repeat(43) });
  assert.equal(refused.status, 403);
});

test("a link with a wrong MAC, one turned off, one replaced and one run out open nothing", async (t) => {
  const { ask, clock } = await setup(t);
  const first = await ownerLink(ask);
  const forged = `${first.slice(0, 16)}${"A".repeat(22)}`;
  assert.equal((await ask(null, "connect-link/open", { link: forged })).status, 404);
  const second = await ownerLink(ask);
  assert.notEqual(first, second);
  assert.equal((await ask(null, "connect-link/open", { link: first })).status, 404, "a new link turns off the one before");
  assert.equal((await ask(OWNER, "connect-link/current", { workspace: "brand" })).link.link, second);
  await ask(OWNER, "connect-link/revoke", { workspace: "brand" });
  assert.equal((await ask(null, "connect-link/open", { link: second })).status, 404);
  assert.equal((await ask(OWNER, "connect-link/current", { workspace: "brand" })).link, null);
  const third = await ownerLink(ask);
  clock.now += 7 * DAY + 1;
  assert.equal((await ask(null, "connect-link/open", { link: third })).status, 404);
});

test("connecting through the link keeps the login under the owner and adds the account to that workspace, no token in either answer", async (t) => {
  const { ask, vault, brand, db } = await setup(t);
  const link = await ownerLink(ask);
  const answer = await ask(null, "connect-link/exchange", { link, ...YOUTUBE_CODE });
  assert.equal(answer.status, 200, answer.error);
  assert.deepEqual(answer.accounts, [{ platform: "youtube", handle: "acme", avatarUrl: "https://yt3.test/a.jpg" }]);
  assert.doesNotMatch(JSON.stringify(answer), /ya29|youtube-refresh|ticket/);
  const [row] = brand();
  assert.equal(row.platform, "youtube");
  assert.equal(row.youtube.channelId, "UC1");
  assert.doesNotMatch(JSON.stringify(row), /ya29|youtube-refresh|ticket/);
  assert.equal(db.tables.account_state[0].payload.slices.default.connections.length, 0, "only the link's workspace gets it");
  const kept = await vault.read(OWNER, row.id);
  assert.equal(kept.session.refreshToken, "1//youtube-refresh");
  assert.equal(db.tables.connect_links[0].connected, 1);
});

test("the same account connected again keeps its row and takes the new login", async (t) => {
  const existing = { id: "yt-old", platform: "youtube", handle: "old name", connectedAt: "2026-10-01T00:00:00.000Z", youtube: { channelId: "UC1", expiresAt: 0, scope: "" } };
  const { ask, vault, brand } = await setup(t, { connections: [existing] });
  const link = await ownerLink(ask);
  assert.equal((await ask(null, "connect-link/exchange", { link, ...YOUTUBE_CODE })).status, 200);
  assert.equal(brand().length, 1);
  assert.equal(brand()[0].id, "yt-old");
  assert.equal(brand()[0].handle, "acme");
  assert.equal(brand()[0].connectedAt, existing.connectedAt);
  assert.ok(await vault.read(OWNER, "yt-old"));
});

test("a Facebook login keeps each Page shared, and Bluesky's sign-in starts and finishes for the owner", async (t) => {
  const { ask, brand, vault, bluesky } = await setup(t);
  const link = await ownerLink(ask);
  const pages = await ask(null, "connect-link/exchange", { link, network: "facebook", code: "c", redirectUri: "https://plan.video/facebook/callback" });
  assert.equal(pages.status, 200, pages.error);
  assert.deepEqual(pages.accounts.map((account) => account.handle), ["page 1001", "page 1002"]);
  const started = await ask(null, "connect-link/authorize", { link, network: "bluesky", handle: "@acme.bsky.social" });
  assert.equal(started.status, 200, started.error);
  assert.deepEqual(bluesky.started, [{ owner: OWNER, handle: "acme.bsky.social" }]);
  const signedIn = await ask(null, "connect-link/exchange", { link, network: "bluesky", query: "code=c&state=s" });
  assert.equal(signedIn.status, 200, signedIn.error);
  const sky = brand().find((row) => row.platform === "bluesky");
  assert.deepEqual(sky.bluesky, { did: DID, pds: "", oauth: true, server: true });
  assert.equal(sky.handle, "acme.bsky.social");
  assert.deepEqual((await vault.read(OWNER, sky.id)).session, { did: DID, oauth: true, owner: OWNER });
  assert.equal(brand().length, 3);
});

test("the owner's plan still caps the accounts: a full one keeps nothing", async (t) => {
  const { ask, brand, vault } = await setup(t, { limit: 0 });
  const link = await ownerLink(ask);
  const refused = await ask(null, "connect-link/exchange", { link, ...YOUTUBE_CODE });
  assert.equal(refused.status, 403);
  assert.match(refused.error, /Acme has no room/);
  assert.equal(brand().length, 0);
  assert.deepEqual(await vault.list(OWNER), []);
});

test("a link turned off while the client signs in keeps no login", async (t) => {
  const { ask, db, vault, brand } = await setup(t);
  const link = await ownerLink(ask);
  const rpc = db.rpc;
  db.rpc = async (name, args) => {
    if (name === "connect_link_keep") db.tables.connect_links[0].revoked_at = new Date().toISOString();
    return rpc(name, args);
  };
  assert.equal((await ask(null, "connect-link/exchange", { link, ...YOUTUBE_CODE })).status, 410);
  assert.equal(brand().length, 0);
  assert.deepEqual(await vault.list(OWNER), []);
});

test("an admin makes the link for the workspace they're in; a member can't, nor can anyone signed out", async (t) => {
  const { ask, db } = await setup(t);
  const team = { owner: OWNER, workspace: "brand" };
  const made = await ask(ADMIN, "connect-link/create", { team, workspace: "default", workspaceName: "Acme", fromName: "Alex" });
  assert.equal(made.status, 200, made.error);
  assert.equal(db.tables.connect_links[0].workspace_id, "brand", "an admin's workspace is the one they act in, not one they name");
  assert.equal(db.tables.connect_links[0].owner_id, OWNER);
  assert.equal(db.tables.connect_links[0].created_by, ADMIN);
  assert.equal((await ask(MEMBER, "connect-link/create", { team, workspaceName: "Acme" })).status, 403);
  assert.equal((await ask(MEMBER, "connect-link/current", { team })).status, 403);
  assert.equal((await ask(null, "connect-link/create", { workspace: "brand" })).status, 401);
});

test("a link isn't made for a workspace the owner doesn't have", async (t) => {
  const { ask } = await setup(t);
  assert.equal((await ask(OWNER, "connect-link/create", { workspace: "nope" })).status, 404);
});
