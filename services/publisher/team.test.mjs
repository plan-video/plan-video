import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApi, createUsers } from "./api.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createInviteMailer } from "./invites.mjs";
import { createVault } from "./vault.mjs";
import { createWorker } from "./worker.mjs";

const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const ADMIN = "0f0f0f0f-0000-4000-8000-000000000002";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";
const OUTSIDER = "0f0f0f0f-0000-4000-8000-000000000004";
const SHARED = "brand";
const PRIVATE = "secret";
const INVITE = "0f0f0f0f-0000-4000-8000-0000000000aa";

const ROLES = { [`${OWNER}:${SHARED}`]: "owner", [`${OWNER}:${PRIVATE}`]: "owner", [`${ADMIN}:${SHARED}`]: "admin", [`${MEMBER}:${SHARED}`]: "member" };

const session = { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000, openId: "o", scope: "video.publish" };

/** The owner's workspaces: one shared with an admin and a member, one only theirs. */
function setup() {
  const db = fakeDb({
    posts: [
      { user_id: OWNER, workspace_id: SHARED, time_zone: "UTC", connections: [{ id: "c-shared", platform: "tiktok" }], post: { id: "p-shared", status: "draft", platforms: ["tiktok"] } },
      { user_id: OWNER, workspace_id: PRIVATE, time_zone: "UTC", connections: [{ id: "c-private", platform: "tiktok" }], post: { id: "p-private", status: "draft", platforms: ["tiktok"] } },
    ],
  });
  db.tables.workspace_members = [{ id: INVITE, owner_id: OWNER, workspace_id: SHARED, email: "new@team.test", user_id: null, invited_by: ADMIN }];
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) => {
    if (name === "publisher_workspace_connections") {
      return db.posts.filter((item) => item.user_id === args.owner).flatMap((item) => item.connections.map((row) => ({ workspace_id: item.workspace_id, connection_id: row.id })));
    }
    return rpc(name, args);
  };
  const vault = createVault({ db, key: Buffer.alloc(32, 7).toString("base64"), env: {} });
  const worker = createWorker({ db, vault, media: {}, networks: { tiktok: {} }, plugs: {}, sendFrom: 0 });
  const mailed = [];
  // The signed-in person is whoever the bearer token names.
  const users = {
    from: async (req) => ({ id: req.headers.authorization.slice(7) }),
    access: async (req, owner, workspace) => {
      const person = req.headers.authorization.slice(7);
      const role = owner === OWNER ? ROLES[`${person}:${workspace}`] : undefined;
      return role ? { role, level: 3 } : null;
    },
  };
  const api = createApi({
    env: { tiktok: { clientKey: "key", clientSecret: "secret" } },
    vault,
    worker,
    kick: () => undefined,
    users,
    limits: { limitFor: async () => 40 },
    db,
    mailer: { invite: async (invite) => (mailed.push(invite.email), true) },
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

  return { db, vault, ask, mailed };
}

const team = (workspace = SHARED) => ({ owner: OWNER, workspace });

test("a member reaches their workspace's accounts and posts, and nothing else of the owner's", async () => {
  const { vault, ask, db } = setup();
  await vault.put(OWNER, "c-shared", "tiktok", session);
  await vault.put(OWNER, "c-private", "tiktok", session);

  const logins = await ask(MEMBER, "logins", { team: team() });
  assert.deepEqual(logins.connections.map((row) => row.connectionId), ["c-shared"]);
  assert.equal((await ask(MEMBER, "logins", { team: team(PRIVATE) })).status, 403);

  // "Post now" works for the workspace's posts, not for the owner's others.
  db.posts[0].post.status = "scheduled";
  const sent = await ask(MEMBER, "send", { team: team(), postId: "p-shared" });
  assert.equal(sent.status, 200);
  assert.equal(sent.deliveries[0].connection_id, "c-shared");
  assert.equal((await ask(MEMBER, "send", { team: team(), postId: "p-private" })).status, 400);
  assert.ok(db.tables.post_deliveries.every((row) => row.user_id === OWNER && row.post_id === "p-shared"));

  // Without `team`, they're themselves: none of the owner's logins.
  assert.deepEqual((await ask(MEMBER, "logins", {})).connections, []);
});

test("only the owner and admins connect and remove accounts, and only in their workspace", async () => {
  const { vault, ask, db } = setup();
  await vault.put(OWNER, "c-private", "tiktok", session);

  assert.equal((await ask(MEMBER, "login/save", { team: team(), connectionId: "c-new", platform: "tiktok", session })).status, 403);
  assert.equal((await ask(MEMBER, "login/forget", { team: team(), connectionId: "c-shared" })).status, 403);

  // An admin's new account is kept for the owner, where the publisher sends from.
  assert.equal((await ask(ADMIN, "login/save", { team: team(), connectionId: "c-new", platform: "tiktok", session })).status, 200);
  assert.ok(db.tables.social_tokens.some((row) => row.user_id === OWNER && row.connection_id === "c-new"));
  assert.ok(!db.tables.social_tokens.some((row) => row.user_id === ADMIN));

  // Not an account of another of the owner's workspaces.
  assert.equal((await ask(ADMIN, "login/save", { team: team(), connectionId: "c-private", platform: "tiktok", session })).status, 403);
  assert.equal((await ask(ADMIN, "login/forget", { team: team(), connectionId: "c-private" })).status, 403);
  assert.ok(db.tables.social_tokens.some((row) => row.connection_id === "c-private"));

  // One the admin's workspace has, or none has any more (just removed from the list), can go.
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    assert.deepEqual(await ask(ADMIN, "login/forget", { team: team(), connectionId: "c-new" }), { status: 200, revoked: true });
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(!db.tables.social_tokens.some((row) => row.connection_id === "c-new"));
});

test("no browser gets a TikTok or LinkedIn token, and no admin or member gets any", async () => {
  const { vault, ask, db } = setup();
  db.posts[0].connections.push({ id: "c-linkedin", platform: "linkedin" }, { id: "c-bluesky", platform: "bluesky" });
  await vault.put(OWNER, "c-shared", "tiktok", session);
  await vault.put(OWNER, "c-linkedin", "linkedin", { accessToken: "li", expiresAt: Date.now() + 60 * 86_400_000, personId: "p", scope: "w_member_social" });
  await vault.put(OWNER, "c-bluesky", "bluesky", { did: "did:plc:abc", pds: "https://pds.test", accessJwt: "jwt", refreshJwt: "rjwt" });
  for (const person of [ADMIN, MEMBER]) {
    for (const connectionId of ["c-shared", "c-linkedin", "c-bluesky"]) {
      const answer = await ask(person, "login/access", { team: team(), connectionId });
      assert.equal(answer.status, 403);
      assert.equal(answer.accessToken, undefined);
      assert.equal(answer.accessJwt, undefined);
    }
  }
  // Not for an account outside the workspace either, nor for someone not in it.
  assert.equal((await ask(ADMIN, "login/access", { team: team(), connectionId: "c-private" })).status, 403);
  assert.equal((await ask(OUTSIDER, "login/access", { team: team(), connectionId: "c-shared" })).status, 403);
  // TikTok and LinkedIn tokens stay on the server, the owner's own included.
  for (const connectionId of ["c-shared", "c-linkedin"]) {
    const own = await ask(OWNER, "login/access", { connectionId });
    assert.equal(own.status, 403);
    assert.equal(own.accessToken, undefined);
  }
});

/** Fakes TikTok's and LinkedIn's APIs, and notes the token each call came with. */
function fakeNetworks() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const link = String(url);
    calls.push({ url: link, auth: init.headers?.Authorization ?? "" });
    const ok = (data) => new Response(JSON.stringify({ data, error: { code: "ok" } }), { status: 200 });
    if (link.includes("/v2/user/info/")) return ok({ user: { open_id: "o", display_name: "Brand" } });
    if (link.includes("/v2/video/list/")) return ok({ videos: [{ id: "v1", title: "Hello", create_time: 1_700_000_000, view_count: 10, like_count: 2, comment_count: 1 }], has_more: false });
    if (link.includes("/v2/post/publish/creator_info/query/")) return ok({ creator_nickname: "Brand", privacy_level_options: ["PUBLIC_TO_EVERYONE"], max_video_post_duration_sec: 600 });
    if (link === "https://api.linkedin.com/v2/userinfo") return new Response(JSON.stringify({ sub: "p", name: "Ada", picture: "https://media.licdn.com/a.jpg" }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

/** No login in an answer: none of a login's fields, and none of the test logins' tokens. */
function assertNoTokens(answer) {
  const text = JSON.stringify(answer);
  for (const key of ["accessToken", "refreshToken", "accessJwt", "refreshJwt"]) assert.ok(!text.includes(`"${key}"`), text);
  for (const secret of ["a", "r", "li-access", "li-refresh"]) assert.ok(!text.includes(`"${secret}"`), text);
}

test("TikTok's and LinkedIn's reads go through the publisher for anyone in the workspace, with no token in the answer", async () => {
  const { vault, ask, db } = setup();
  db.posts[0].connections.push({ id: "c-linkedin", platform: "linkedin" });
  await vault.put(OWNER, "c-shared", "tiktok", session);
  await vault.put(OWNER, "c-private", "tiktok", session);
  await vault.put(OWNER, "c-linkedin", "linkedin", { accessToken: "li-access", refreshToken: "li-refresh", expiresAt: Date.now() + 60 * 86_400_000, personId: "p", scope: "w_member_social" });
  const networks = fakeNetworks();
  try {
    for (const [person, scope] of [[OWNER, undefined], [ADMIN, team()], [MEMBER, team()]]) {
      const profile = await ask(person, "tiktok/profile", { team: scope, connectionId: "c-shared" });
      assert.deepEqual(profile, { status: 200, openId: "o", displayName: "Brand", avatarUrl: "" });
      const videos = await ask(person, "tiktok/videos", { team: scope, connectionId: "c-shared" });
      assert.equal(videos.status, 200);
      assert.deepEqual(videos.videos.map((video) => [video.id, video.views]), [["v1", 10]]);
      const creator = await ask(person, "tiktok/creator", { team: scope, connectionId: "c-shared" });
      assert.equal(creator.status, 200);
      assert.deepEqual(creator.data.privacy_level_options, ["PUBLIC_TO_EVERYONE"]);
      const member = await ask(person, "linkedin/profile", { team: scope, connectionId: "c-linkedin" });
      assert.deepEqual(member, { status: 200, personId: "p", name: "Ada", avatarUrl: "https://media.licdn.com/a.jpg" });
      for (const answer of [profile, videos, creator, member]) assertNoTokens(answer);
    }
    // Every call was made here, with the owner's logins.
    assert.equal(networks.calls.length, 12);
    assert.ok(networks.calls.every((call) => call.auth === "Bearer a" || call.auth === "Bearer li-access"));

    // Not an account of another workspace, not someone outside it, not the wrong network.
    assert.equal((await ask(MEMBER, "tiktok/creator", { team: team(), connectionId: "c-private" })).status, 403);
    assert.equal((await ask(ADMIN, "tiktok/videos", { team: team(), connectionId: "c-private" })).status, 403);
    assert.equal((await ask(OUTSIDER, "tiktok/profile", { team: team(), connectionId: "c-shared" })).status, 403);
    assert.equal((await ask(MEMBER, "linkedin/profile", { team: team(), connectionId: "c-shared" })).status, 400);
    assert.equal((await ask(MEMBER, "tiktok/profile", { team: team(), connectionId: "c-linkedin" })).status, 400);
    assert.equal((await ask(MEMBER, "tiktok/profile", { team: team(), connectionId: "../x" })).status, 400);
    assert.equal(networks.calls.length, 12);
  } finally {
    networks.restore();
  }
});

test("a network's refusal comes back as its reason, without the login", async () => {
  const { vault, ask } = setup();
  await vault.put(OWNER, "c-shared", "tiktok", session);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "access_token_invalid", message: "The access token is invalid." } }), { status: 401 });
  try {
    const answer = await ask(MEMBER, "tiktok/creator", { team: team(), connectionId: "c-shared" });
    assert.equal(answer.status, 400);
    assert.equal(typeof answer.error, "string");
    assert.equal(answer.data, undefined);
    assertNoTokens(answer);
  } finally {
    globalThis.fetch = original;
  }
});

test("someone not in the workspace is refused, and a bad workspace is a bad request", async () => {
  const { ask } = setup();
  assert.equal((await ask(OUTSIDER, "logins", { team: team() })).status, 403);
  assert.equal((await ask(OUTSIDER, "send", { team: team(), postId: "p-shared" })).status, 403);
  assert.equal((await ask(MEMBER, "logins", { team: { owner: "nope", workspace: SHARED } })).status, 400);
  assert.equal((await ask(MEMBER, "logins", { team: { owner: OWNER, workspace: "../x" } })).status, 400);
});

test("the owner naming their own workspace is just themselves", async () => {
  const { vault, ask } = setup();
  await vault.put(OWNER, "c-private", "tiktok", session);
  const logins = await ask(OWNER, "logins", { team: team(PRIVATE) });
  assert.deepEqual(logins.connections.map((row) => row.connectionId), ["c-private"]);
});

test("invite emails go out for the owner and admins, once per open invite", async () => {
  const { ask, mailed, db } = setup();
  assert.equal((await ask(MEMBER, "team/invite", { invite: INVITE })).status, 403);
  assert.equal((await ask(OUTSIDER, "team/invite", { invite: INVITE })).status, 403);
  assert.deepEqual(await ask(ADMIN, "team/invite", { invite: INVITE }), { status: 200, emailed: true });
  assert.deepEqual(mailed, ["new@team.test"]);
  assert.equal((await ask(ADMIN, "team/invite", { invite: "not-a-uuid" })).status, 400);
  db.tables.workspace_members[0].user_id = MEMBER;
  assert.equal((await ask(ADMIN, "team/invite", { invite: INVITE })).status, 404);
});

test("the mailer asks Supabase to invite a new address, and stays quiet for an existing one", async () => {
  const calls = [];
  const db = { rpc: async (name) => (name === "person_name" ? "Ada" : { name: "Brand" }) };
  const answer = { status: 200 };
  const mailer = createInviteMailer({
    supabaseUrl: "https://sb.test",
    serviceKey: "service",
    publicUrl: "https://plan.video",
    db,
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
      return new Response("{}", { status: answer.status });
    },
  });
  const invite = { id: INVITE, owner_id: OWNER, workspace_id: SHARED, email: "new@team.test", invited_by: ADMIN };
  assert.equal(await mailer.invite(invite), true);
  assert.equal(calls[0].url, `https://sb.test/auth/v1/invite?redirect_to=${encodeURIComponent(`https://plan.video/dashboard?invite=${INVITE}`)}`);
  assert.deepEqual(calls[0].body, { email: "new@team.test", data: { invited_by_name: "Ada", invited_workspace: "Brand", invite_id: INVITE } });
  assert.equal(calls[0].auth, "Bearer service");
  answer.status = 422;
  assert.equal(await mailer.invite(invite), false);
});

test("access asks Supabase with the person's own token and keeps the answer briefly", async () => {
  const asked = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    asked.push({ url, auth: init.headers.Authorization, body: init.body });
    return new Response(JSON.stringify({ role: "member", level: 4 }), { status: 200 });
  };
  try {
    const users = createUsers({ supabaseUrl: "https://sb.test", anonKey: "anon", requireInvite: false });
    const req = { headers: { authorization: "Bearer member-token" } };
    assert.deepEqual(await users.access(req, OWNER, SHARED), { role: "member", level: 4 });
    assert.deepEqual(await users.access(req, OWNER, SHARED), { role: "member", level: 4 });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].url, "https://sb.test/rest/v1/rpc/team_access");
    assert.equal(asked[0].auth, "Bearer member-token");
    assert.deepEqual(JSON.parse(asked[0].body), { owner: OWNER, workspace: SHARED });
  } finally {
    globalThis.fetch = original;
  }
});
