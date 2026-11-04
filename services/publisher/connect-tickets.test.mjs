import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";

import { handleLinkedIn } from "../linkedin/handler.mjs";
import { handleTikTok } from "../tiktok/handler.mjs";

import { createApi, revoke } from "./api.mjs";
import { createBlueskyOAuth, makeBlueskyKey } from "./bluesky-oauth.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createLinkedInLogins } from "./linkedin-logins.mjs";
import { createMetaLogins } from "./meta-logins.mjs";
import { createTikTokLogins } from "./tiktok-logins.mjs";
import { createVault, sealer } from "./vault.mjs";
import { createXLogins } from "./x-logins.mjs";
import { createYouTubeLogins } from "./youtube-logins.mjs";

const KEY = Buffer.alloc(32, 9).toString("base64");
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const ADMIN = "0f0f0f0f-0000-4000-8000-000000000002";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";
const ADMIN2 = "0f0f0f0f-0000-4000-8000-000000000004";
const T0 = Date.parse("2026-10-16T12:00:00Z");
const MINUTE = 60_000;
const TEAM = { owner: OWNER, workspace: "brand" };
const OTHER = { owner: OWNER, workspace: "other" };
const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const META_ENV = {
  instagram: { appId: "ig-app", appSecret: "ig-secret" },
  facebook: { appId: "fb-app", appSecret: "fb-secret", configId: "cfg-1" },
  threads: { appId: "th-app", appSecret: "th-secret" },
};

const NETWORKS = {
  tiktok: {
    code: { code: "tt-code", redirectUri: "https://plan.video/tiktok/callback", codeVerifier: "a".repeat(64) },
    tokens: ["act.tiktok-access", "rft.tiktok-refresh"],
    who: (answer) => answer.openId,
    id: "open-1",
  },
  linkedin: {
    code: { code: "li-code", redirectUri: "https://plan.video/linkedin/callback" },
    tokens: ["AQV-linkedin-access", "AQX-linkedin-refresh"],
    who: (answer) => answer.personId,
    id: "person-1",
  },
};

const EVERY = {
  youtube: { route: "youtube/exchange", code: { code: "g", redirectUri: "https://plan.video/youtube/callback", codeVerifier: "v".repeat(43) }, token: "ya29.youtube-access" },
  tiktok: { route: "tiktok/exchange", code: NETWORKS.tiktok.code, token: "act.tiktok-access" },
  linkedin: { route: "linkedin/exchange", code: NETWORKS.linkedin.code, token: "AQV-linkedin-access" },
  x: { route: "x/exchange", code: { code: "x", redirectUri: "https://plan.video/x/callback", codeVerifier: "v".repeat(43) }, token: "x-access" },
  instagram: { route: "instagram/exchange", code: { code: "c", redirectUri: "https://plan.video/instagram/callback" }, token: "instagram-token" },
  facebook: { route: "facebook/exchange", code: { code: "c", redirectUri: "https://plan.video/facebook/callback" }, token: "facebook-token" },
  threads: { route: "threads/exchange", code: { code: "c", redirectUri: "https://plan.video/threads/callback" }, token: "threads-token" },
  bluesky: { route: "bluesky/callback", code: { query: "code=c&state=s" } },
};

const ROLES = () => ({ [`${OWNER}|brand`]: "owner", [`${OWNER}|other`]: "owner", [`${ADMIN}|brand`]: "admin", [`${ADMIN}|other`]: "admin", [`${ADMIN2}|brand`]: "admin", [`${MEMBER}|brand`]: "member" });

async function setup(t, { clock = { now: T0 } } = {}) {
  const now = () => clock.now;
  t.mock.method(Date, "now", now);
  const db = fakeDb({ users: [{ id: OWNER, access_level: 2 }], posts: [{ user_id: OWNER, workspace_id: "brand", time_zone: "UTC", connections: [], post: { id: "p", status: "draft", platforms: [] } }] });
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) =>
    name === "publisher_workspace_connections" ? ["tt1", "li1"].map((id) => ({ workspace_id: "brand", connection_id: id })) : rpc(name, args);
  const vault = createVault({ db, key: KEY, env: {} });
  const asked = [];
  const tiktok = createTikTokLogins({
    key: KEY,
    env: { clientKey: "k", clientSecret: "s" },
    now,
    token: async (_env, fields) => (asked.push(fields), { accessToken: "act.tiktok-access", refreshToken: "rft.tiktok-refresh", expiresIn: 86400, openId: "open-1", scope: "video.publish" }),
    profile: async () => ({ openId: "open-1", displayName: "maker", avatarUrl: "data:image/jpeg;base64,AA" }),
  });
  let lastCode = "";
  const pageCode = () => lastCode;
  const linkedin = createLinkedInLogins({
    key: KEY,
    env: { clientId: "id", clientSecret: "s" },
    now,
    token: async (tokenEnv, fields) => {
      asked.push(fields);
      lastCode = fields.code;
      return tokenEnv.clientId === "pages-id"
        ? { accessToken: "AQV-pages-access", refreshToken: "AQX-pages-refresh", expiresIn: 5_184_000, scope: "w_organization_social" }
        : { accessToken: "AQV-linkedin-access", refreshToken: "AQX-linkedin-refresh", expiresIn: 5_184_000, scope: "w_member_social" };
    },
    member: async () => ({ personId: "person-1", name: "Maker", avatarUrl: "https://media.licdn.test/a.jpg" }),
    pagesEnv: { clientId: "pages-id", clientSecret: "pages-s", publicUrl: "https://plan.video" },
    pages: async () => ({ pages: pageCode() === "no-pages" ? [] : [{ organizationId: "1", name: "Acme" }, { organizationId: "2", name: "Beta" }] }),
  });
  const youtube = createYouTubeLogins({
    key: KEY,
    env: { clientId: "id", clientSecret: "s" },
    now,
    token: async () => ({ accessToken: "ya29.youtube-access", refreshToken: "1//youtube-refresh", expiresIn: 3600, scope: "youtube.upload" }),
    channel: async () => ({ channelId: "UC1", handle: "maker", avatarUrl: "https://yt3.test/a.jpg" }),
  });
  const x = createXLogins({
    key: KEY,
    env: { clientId: "id", clientSecret: "s" },
    now,
    token: async () => ({ accessToken: "x-access", refreshToken: "x-refresh", expiresIn: 7200, scope: "tweet.write" }),
    member: async () => ({ userId: "42", username: "maker", avatarUrl: "https://pbs.test/a.jpg" }),
  });
  const meta = createMetaLogins({
    key: KEY,
    env: META_ENV,
    now,
    exchange: async (network) => [
      { accountId: "17841400000000001", handle: "maker", avatarUrl: "", session: { accountId: "17841400000000001", accessToken: `${network}-token`, expiresAt: clock.now + 60 * 24 * 60 * MINUTE, renewedAt: clock.now, scope: "s" } },
    ],
  });
  // The real Bluesky tickets, made as its callback makes them, without a Bluesky server to sign in at.
  const real = await createBlueskyOAuth({ db, sealKey: KEY, privateJwk: await makeBlueskyKey(), publicUrl: "https://plan.video" });
  const ticketKey = createHmac("sha256", Buffer.from(KEY, "base64")).update("bluesky-ticket").digest();
  const bluesky = {
    ...real,
    async callback({ person, owner, workspace = "" }) {
      const until = String(Date.now() + 15 * MINUTE);
      const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("hex");
      const mac = createHmac("sha256", ticketKey).update(JSON.stringify([person, owner, workspace, DID, until, nonce])).digest("base64url");
      return { did: DID, ticket: `${until}.${nonce}.${mac}` };
    },
  };
  const roles = ROLES();
  const api = createApi({
    env: {},
    vault,
    worker: {},
    kick: () => undefined,
    users: {
      from: async (req) => ({ id: req.headers.authorization.slice(7) }),
      access: async (req, owner, workspace) => {
        const role = owner === OWNER ? roles[`${req.headers.authorization.slice(7)}|${workspace}`] : undefined;
        return role ? { role, level: 3 } : null;
      },
    },
    limits: { limitFor: async () => 40 },
    db,
    tiktok,
    linkedin,
    youtube,
    x,
    meta,
    bluesky,
    now,
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

  async function connect(network, person, team) {
    const answer = await ask(person, EVERY[network].route, team ? { ...EVERY[network].code, team } : EVERY[network].code);
    assert.equal(answer.status, 200, answer.error);
    if (network === "bluesky") return { did: answer.did, oauth: true, ticket: answer.ticket };
    return { ticket: answer.accounts ? answer.accounts[0].ticket : answer.ticket };
  }

  async function save(network, person, connectionId, session, team) {
    return (await ask(person, "login/save", { connectionId, platform: network, session, ...(team ? { team } : {}) })).status;
  }

  return { vault, ask, asked, tiktok, linkedin, roles, clock, connect, save };
}

for (const [network, about] of Object.entries(NETWORKS)) {
  const connection = network === "tiktok" ? "tt1" : "li1";

  test(`${network}: an admin connecting an account gets who it is and a ticket, never its tokens`, async (t) => {
    const { ask } = await setup(t);
    const answer = await ask(ADMIN, `${network}/exchange`, { ...about.code, team: TEAM });
    assert.equal(answer.status, 200);
    assert.equal(about.who(answer), about.id);
    assert.ok(answer.ticket.startsWith("v1."));
    const text = JSON.stringify(answer);
    for (const token of about.tokens) assert.ok(!text.includes(token), `${token} reached the browser`);
    assert.doesNotMatch(text, /accessToken|refreshToken/);
  });

  test(`${network}: the ticket attaches the login on the server, for the workspace's owner`, async (t) => {
    const { ask, vault } = await setup(t);
    const { ticket, expiresAt, scope } = await ask(ADMIN, `${network}/exchange`, { ...about.code, team: TEAM });
    const saved = await ask(ADMIN, "login/save", { connectionId: connection, platform: network, session: { ticket, expiresAt, scope }, team: TEAM });
    assert.equal(saved.status, 200);
    const kept = await vault.read(OWNER, connection);
    assert.equal(kept.session.accessToken, about.tokens[0]);
    assert.equal(kept.session.refreshToken, about.tokens[1]);
  });

  test(`${network}: a ticket made for someone else, or changed, attaches nothing`, async (t) => {
    const { ask, vault } = await setup(t);
    const { ticket } = await ask(OWNER, `${network}/exchange`, about.code);
    const stranger = "0f0f0f0f-0000-4000-8000-000000000009";
    assert.equal((await ask(stranger, "login/save", { connectionId: "x9", platform: network, session: { ticket } })).status, 403);
    assert.equal((await ask(OWNER, "login/save", { connectionId: connection, platform: network, session: { ticket: `${ticket.slice(0, -4)}AAA=` } })).status, 403);
    assert.deepEqual(await vault.list(OWNER), []);
  });

  test(`${network}: no browser is given the access token afterwards, not even the owner's`, async (t) => {
    const { ask } = await setup(t);
    const { ticket } = await ask(OWNER, `${network}/exchange`, about.code);
    await ask(OWNER, "login/save", { connectionId: connection, platform: network, session: { ticket } });
    const answer = await ask(OWNER, "login/access", { connectionId: connection });
    assert.equal(answer.status, 403);
    for (const token of about.tokens) assert.ok(!JSON.stringify(answer).includes(token));
  });

  test(`${network}: a member can't connect, and only saved redirects are swapped`, async (t) => {
    const { ask, asked } = await setup(t);
    assert.equal((await ask(MEMBER, `${network}/exchange`, { ...about.code, team: TEAM })).status, 403);
    assert.equal((await ask(OWNER, `${network}/exchange`, { ...about.code, redirectUri: "https://evil.test/callback" })).status, 400);
    assert.deepEqual(asked, []);
  });

  test(`${network}: a ticket runs out after 15 minutes`, async (t) => {
    const clock = { now: T0 };
    const logins = (await setup(t, { clock }))[network];
    const holder = { person: OWNER, owner: OWNER };
    const { ticket } = await logins.exchange(holder, about.code);
    clock.now += 14 * MINUTE;
    assert.equal(logins.open(holder, ticket).session.accessToken, about.tokens[0]);
    clock.now += 2 * MINUTE;
    assert.equal(logins.open(holder, ticket), null);
  });
}

for (const network of Object.keys(EVERY)) {
  const keptOf = async (vault, connectionId) => {
    const kept = await vault.read(OWNER, connectionId);
    return network === "bluesky" ? kept.session.did : kept.session.accessToken;
  };
  const wanted = network === "bluesky" ? DID : EVERY[network].token;

  test(`${network}: the owner connects an account, and its ticket attaches the login`, async (t) => {
    const { vault, connect, save } = await setup(t);
    assert.equal(await save(network, OWNER, "c1", await connect(network, OWNER)), 200);
    assert.equal(await keptOf(vault, "c1"), wanted);
  });

  test(`${network}: an admin connects an account in a shared workspace, for its owner`, async (t) => {
    const { vault, connect, save } = await setup(t);
    assert.equal(await save(network, ADMIN, "c1", await connect(network, ADMIN, TEAM), TEAM), 200);
    assert.equal(await keptOf(vault, "c1"), wanted);
  });

  test(`${network}: a ticket attaches its login once`, async (t) => {
    const { vault, connect, save } = await setup(t);
    const session = await connect(network, ADMIN, TEAM);
    assert.equal(await save(network, ADMIN, "c1", session, TEAM), 200);
    assert.equal(await save(network, ADMIN, "c2", session, TEAM), 403);
    assert.deepEqual((await vault.list(OWNER)).map((login) => login.connectionId), ["c1"]);
    await vault.remove(OWNER, "c1");
    assert.equal(await save(network, ADMIN, "c1", session, TEAM), 200);
    assert.deepEqual(await vault.list(OWNER), []);
    assert.equal(await save(network, ADMIN, "c2", await connect(network, ADMIN, TEAM), TEAM), 200);
  });

  test(`${network}: two tries at once with one ticket keep the login once`, async (t) => {
    const { vault, connect, save } = await setup(t);
    const session = await connect(network, OWNER);
    const answers = await Promise.all([save(network, OWNER, "c1", session), save(network, OWNER, "c2", session), save(network, OWNER, "c1", session)]);
    assert.deepEqual(answers, [200, 403, 200]);
    assert.deepEqual((await vault.list(OWNER)).map((login) => login.connectionId), ["c1"]);
  });

  test(`${network}: a ticket attaches nothing for another person`, async (t) => {
    const { vault, connect, save } = await setup(t);
    assert.equal(await save(network, ADMIN2, "c1", await connect(network, ADMIN, TEAM), TEAM), 403);
    assert.equal(await save(network, OWNER, "c1", await connect(network, ADMIN, TEAM), TEAM), 403);
    assert.equal(await save(network, OWNER, "c1", await connect(network, ADMIN, TEAM)), 403);
    assert.equal(await save(network, ADMIN, "c1", await connect(network, OWNER), TEAM), 403);
    assert.deepEqual(await vault.list(OWNER), []);
  });

  test(`${network}: an admin taken out of a workspace can't attach its account in another of the owner's`, async (t) => {
    const { vault, connect, save, roles } = await setup(t);
    const session = await connect(network, ADMIN, TEAM);
    assert.equal(await save(network, ADMIN, "c1", session, OTHER), 403);
    delete roles[`${ADMIN}|brand`];
    assert.equal(await save(network, ADMIN, "c1", session, OTHER), 403);
    assert.equal(await save(network, ADMIN, "c1", session, TEAM), 403);
    assert.equal(await save(network, ADMIN, "c1", session), 403);
    assert.deepEqual(await vault.list(OWNER), []);
    assert.deepEqual(await vault.list(ADMIN), []);
  });

  test(`${network}: a ticket runs out after 15 minutes`, async (t) => {
    const clock = { now: T0 };
    const { vault, connect, save } = await setup(t, { clock });
    const early = await connect(network, ADMIN, TEAM);
    const late = await connect(network, ADMIN, TEAM);
    clock.now += 14 * MINUTE;
    assert.equal(await save(network, ADMIN, "c1", early, TEAM), 200);
    clock.now += MINUTE + 1;
    assert.equal(await save(network, ADMIN, "c2", late, TEAM), 403);
    assert.deepEqual((await vault.list(OWNER)).map((login) => login.connectionId), ["c1"]);
  });
}

test("a ticket of the older kind, bound only to the owner and without a nonce, attaches nothing", async (t) => {
  const { vault, save } = await setup(t);
  const box = sealer(KEY);
  const session = { accessToken: "ya29.old", refreshToken: "1//old", expiresAt: T0 + 3_600_000, scope: "s", channelId: "UC1" };
  for (const [network, binding] of [["youtube", `youtube-ticket:${OWNER}`], ["tiktok", `tiktok-ticket:${OWNER}`], ["x", `x-ticket:${OWNER}`], ["instagram", `instagram-ticket:${OWNER}`]]) {
    assert.equal(await save(network, OWNER, "c1", { ticket: box.seal({ session, until: T0 + 30 * 24 * 60 * MINUTE }, binding) }), 403);
  }
  assert.equal(await save("youtube", OWNER, "c1", { ticket: box.seal({ session, until: T0 + MINUTE }, `youtube-ticket:${OWNER}:${OWNER}:`) }), 403);
  assert.deepEqual(await vault.list(OWNER), []);
});

test("linkedin: the browser learns whether the login renews itself, without the refresh token", async (t) => {
  const { ask } = await setup(t);
  const answer = await ask(OWNER, "linkedin/exchange", NETWORKS.linkedin.code);
  assert.equal(answer.renewable, true);
});

test("linkedin pages: each Page comes with its own ticket, kept under the Page and never as the member", async (t) => {
  const { ask, vault, linkedin, save } = await setup(t);
  const answer = await ask(OWNER, "linkedin/pages/exchange", NETWORKS.linkedin.code);
  assert.deepEqual(answer.accounts.map((account) => [account.organizationId, account.displayName]), [["1", "Acme"], ["2", "Beta"]]);
  const text = JSON.stringify(answer);
  for (const token of ["AQV-pages-access", "AQX-pages-refresh"]) assert.ok(!text.includes(token), `${token} reached the browser`);

  assert.equal(linkedin.open({ person: "someone-else", owner: "someone-else", workspace: "" }, answer.accounts[0].ticket), null);
  assert.equal(await save("linkedin", OWNER, "page-1", { ticket: answer.accounts[0].ticket }), 200);
  assert.equal(await save("linkedin", OWNER, "page-2", { ticket: answer.accounts[1].ticket }), 200);
  const { session } = await vault.read(OWNER, "page-2");
  assert.equal(session.organizationId, "2");
  assert.equal(session.accessToken, "AQV-pages-access");
  assert.equal("personId" in session, false);
});

test("linkedin pages: a member with no Page is told so, and a server without the app says it isn't set up", async (t) => {
  const { ask } = await setup(t);
  const none = await ask(OWNER, "linkedin/pages/exchange", { ...NETWORKS.linkedin.code, code: "no-pages" });
  assert.equal(none.status, 400);
  assert.match(none.error, /didn't find a Page/);
  const bare = createLinkedInLogins({ key: KEY, env: { clientId: "id", clientSecret: "s" } });
  await assert.rejects(bare.exchangePages({}, NETWORKS.linkedin.code), /aren't set up/);
});

test("a Page's sign-in starts at the Pages app with its scopes, and a person's stays at the first app", async (t) => {
  const answers = [];
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: OWNER }));
  const start = async (body, pages) => {
    const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: `Bearer ${OWNER}` } });
    req.push(JSON.stringify({ redirectUri: "https://plan.video/linkedin/callback", state: "s1", ...body }));
    req.push(null);
    let status = 0;
    let text = "";
    await handleLinkedIn(req, { writableEnded: false, writeHead: (code) => (status = code), end: (value) => (text = value) }, "/api/linkedin/authorize", {
      clientId: "first", clientSecret: "s", publicUrl: "https://plan.video", supabaseUrl: "https://db.test", supabaseAnonKey: "a", pages,
    });
    answers.push(status);
    return JSON.parse(text);
  };
  const personal = new URL((await start({}, { clientId: "second" })).url);
  assert.equal(personal.searchParams.get("client_id"), "first");
  assert.equal(personal.searchParams.get("scope"), "openid profile w_member_social");
  const page = new URL((await start({ pages: true }, { clientId: "second" })).url);
  assert.equal(page.searchParams.get("client_id"), "second");
  assert.equal(page.searchParams.get("scope"), "rw_organization_admin w_organization_social");
  assert.match((await start({ pages: true }, { clientId: "" })).error, /aren't set up/);
  assert.deepEqual(answers, [200, 200, 503]);
});

test("disconnecting a Page leaves its shared login alone at LinkedIn", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => (asked.push(String(url)), new Response("{}")));
  const env = { linkedin: { clientId: "i", clientSecret: "s" } };
  assert.equal(await revoke("linkedin", { organizationId: "1", accessToken: "a" }, env), false);
  assert.equal(asked.length, 0);
  assert.equal(await revoke("linkedin", { personId: "p", accessToken: "a" }, env), true);
  assert.equal(asked.length, 1);
});

test("the network services no longer swap codes or refresh logins for a browser", async () => {
  const env = { clientKey: "k", clientSecret: "s", clientId: "i", supabaseUrl: "https://db.test", supabaseAnonKey: "a" };
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://db.test/auth/v1/user")) return new Response(JSON.stringify({ id: OWNER }), { status: 200 });
    throw new Error(`unexpected call to ${url}`);
  };
  try {
    for (const [handle, path] of [
      [handleTikTok, "/api/tiktok/exchange"],
      [handleTikTok, "/api/tiktok/refresh"],
      [handleLinkedIn, "/api/linkedin/exchange"],
      [handleLinkedIn, "/api/linkedin/refresh"],
    ]) {
      const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: "Bearer jwt" } });
      req.push(JSON.stringify({ code: "c", redirectUri: "https://plan.video/tiktok/callback", refreshToken: "r" }));
      req.push(null);
      let status = 0;
      let answer = "";
      const res = { headersSent: false, setHeader() {}, writeHead: (code) => (status = code), end: (text) => (answer = text) };
      await handle(req, res, path, env);
      assert.equal(status, 410, `${path} answered ${status} ${answer}`);
      assert.doesNotMatch(answer, /accessToken|refreshToken/);
    }
  } finally {
    globalThis.fetch = original;
  }
});
