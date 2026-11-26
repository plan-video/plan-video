// Run as helpers.mjs says, with the access token hook on in the stack's config.toml (see connector-tokens.test.mjs).

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { before, describe, test } from "node:test";

import { ANON, call, makeUser, refuses, rpc, saveOwner, setLevel, slice, sql, URL } from "./helpers.mjs";
import { createPostingTools } from "../../services/mcp/posting.mjs";
import { createStore } from "../../services/mcp/store.mjs";

const REDIRECT = "http://127.0.0.1:9/callback";

async function connect(user) {
  const form = async (path, body) => {
    const response = await fetch(`${URL}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    return { status: response.status, data: await response.json() };
  };
  const registered = await call("/auth/v1/oauth/clients/register", {
    method: "POST",
    body: { client_name: "Agent", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
  });
  assert.ok(registered.status < 300, JSON.stringify(registered.data));
  const clientId = registered.data.client_id;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s", scope: "openid email" });
  const authorize = await fetch(`${URL}/auth/v1/oauth/authorize?${query}`, { redirect: "manual" });
  const authorizationId = new globalThis.URL(authorize.headers.get("location"), URL).searchParams.get("authorization_id");
  assert.ok(authorizationId, `no consent step: ${authorize.status}`);
  await call(`/auth/v1/oauth/authorizations/${authorizationId}`, { token: user.token });
  const consent = await call(`/auth/v1/oauth/authorizations/${authorizationId}/consent`, { token: user.token, method: "POST", body: { action: "approve" } });
  const code = new globalThis.URL(consent.data.redirect_url).searchParams.get("code");
  const tokens = await form("/auth/v1/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  assert.equal(tokens.status, 200, JSON.stringify(tokens.data));
  return tokens.data.access_token;
}

function payload(slices, active = "default", list = [{ id: "default", name: "Personal" }]) {
  return { revision: "r1", timeZone: "Europe/Amsterdam", workspaces: { active, list }, notifications: { read: [], cleared: [], seen: {} }, projectFolders: [], slices };
}

const clip = (owner, id) => ({ id, name: `${id}.mp4`, kind: "video", type: "video/mp4", size: 10, width: 1080, height: 1920, duration: 12, cloud: { key: `media/${owner}/${id}`, at: "2026-11-01T00:00:00Z" }, cloudPoster: true });

const post = (id, extra = {}) => ({ id, title: "Hello", description: "Hello", day: "2026-12-01", start: "10:00", allDay: false, duration: 15, platforms: ["bluesky"], status: "scheduled", calendarId: "posts", createdAt: "2026-11-27T00:00:00Z", recurrence: null, recurrenceExceptions: [], link: null, ...extra });

describe("agent tools", () => {
  let owner;
  let stranger;
  let member;
  let agent;
  let strangerAgent;
  let memberAgent;

  before(async () => {
    owner = await makeUser("agent-owner");
    stranger = await makeUser("agent-stranger");
    member = await makeUser("agent-member");
    const connections = [
      { id: "b1", platform: "bluesky", handle: "me.bsky.social", connectedAt: "2026-11-01", bluesky: { did: "did:x", accessJwt: "SECRET" } },
      { id: "x1", platform: "x", handle: "@me", connectedAt: "2026-11-01" },
    ];
    const saved = await saveOwner(
      owner,
      payload(
        { default: slice({ connections, library: [clip(owner.id, "m1")] }), team: slice({ library: [clip(owner.id, "m2")] }) },
        "default",
        [{ id: "default", name: "Personal" }, { id: "team", name: "Clients" }],
      ),
    );
    assert.ok(saved.status < 300, JSON.stringify(saved.data));
    agent = await connect(owner);
    strangerAgent = await connect(stranger);
    memberAgent = await connect(member);
  });

  test("the context is the workspace open in the dashboard, with no login in it", async () => {
    const context = await rpc(agent, "agent_context");
    assert.equal(context.owner, owner.id);
    assert.equal(context.workspace, "default");
    assert.equal(context.name, "Personal");
    assert.equal(context.role, "owner");
    assert.equal(context.timeZone, "Europe/Amsterdam");
    assert.deepEqual(context.connections, [
      { id: "b1", platform: "bluesky", handle: "me.bsky.social", ready: true },
      { id: "x1", platform: "x", handle: "@me", ready: false },
    ]);
    assert.ok(!JSON.stringify(context).includes("SECRET"));
    assert.equal(context.library[0].id, "m1");
  });

  test("only a connector's token speaks for someone here", async () => {
    await refuses(rpc(owner.token, "agent_context"), "28000");
    await refuses(rpc(owner.token, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p0") }), "28000");
  });

  test("the connector's token still reaches nothing else", async () => {
    const table = await call("/rest/v1/posts?select=id", { token: agent });
    assert.equal(table.status, 403);
    await refuses(rpc(agent, "has_access"), "PT403");
    await refuses(rpc(agent, "agent_scope", { owner: owner.id, workspace: "default" }), "PT403");
  });

  test("a post saved over the version read reaches the publisher; a stale one is a conflict", async () => {
    const made = await rpc(agent, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p1") });
    assert.equal(made.version, 1);
    assert.equal(sql(`select count(*) from post_schedule where owner_id = '${owner.id}' and post_id = 'p1' and next_run_at is not null`), "1");
    await refuses(rpc(agent, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p1") }), "23505");

    const changed = await rpc(agent, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p1", { description: "Changed" }), base: 1 });
    assert.equal(changed.version, 2);
    const stale = await rpc(agent, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p1", { description: "Old" }), base: 1 });
    assert.deepEqual(stale, { conflict: true });

    const [listed] = await rpc(agent, "agent_posts", { owner: owner.id, workspace: "default", post_id: "p1" });
    assert.equal(listed.data.description, "Changed");
    assert.equal(listed.version, 2);
  });

  test("posts filter by status and day, and a deleted post is gone", async () => {
    await rpc(agent, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p2", { status: "draft", day: "2026-12-20" }) });
    const drafts = await rpc(agent, "agent_posts", { owner: owner.id, workspace: "default", status: "draft" });
    assert.deepEqual(drafts.map((row) => row.id), ["p2"]);
    const late = await rpc(agent, "agent_posts", { owner: owner.id, workspace: "default", from_day: "2026-12-10" });
    assert.deepEqual(late.map((row) => row.id), ["p2"]);

    assert.deepEqual(await rpc(agent, "agent_delete_post", { owner: owner.id, workspace: "default", post_id: "p2", base: 2 }), { conflict: true });
    assert.deepEqual(await rpc(agent, "agent_delete_post", { owner: owner.id, workspace: "default", post_id: "p2", base: 1 }), { deleted: true });
    assert.deepEqual(await rpc(agent, "agent_posts", { owner: owner.id, workspace: "default", post_id: "p2" }), []);
  });

  test("nobody reaches a workspace they're not in", async () => {
    await refuses(rpc(strangerAgent, "agent_posts", { owner: owner.id, workspace: "default" }), "42501");
    await refuses(rpc(strangerAgent, "agent_save_post", { owner: owner.id, workspace: "default", post: post("p3") }), "42501");
    await refuses(rpc(strangerAgent, "agent_delete_post", { owner: owner.id, workspace: "default", post_id: "p1", base: 2 }), "42501");
    await refuses(rpc(strangerAgent, "agent_copy_files", { owner: owner.id, workspace: "default", sources: ["media/m1"], files: ["p3_a"] }), "42501");
    await refuses(rpc(agent, "agent_posts", { owner: owner.id, workspace: "gone" }), "42501");
  });

  test("a member works in the shared workspace while the owner's plan has a team", async () => {
    sql(`insert into workspace_members (owner_id, workspace_id, email, user_id, role, joined_at) values ('${owner.id}', 'team', '${member.email}', '${member.id}', 'member', now())`);
    await saveOwner(member, payload({ default: slice() }, `shared-${owner.id}-team`));
    await setLevel(owner.id, 3);
    const context = await rpc(memberAgent, "agent_context");
    assert.equal(context.owner, owner.id);
    assert.equal(context.workspace, "team");
    assert.equal(context.role, "member");
    assert.equal(context.name, "Clients");
    assert.equal(context.level, 3);
    assert.equal(context.library[0].id, "m2");
    const made = await rpc(memberAgent, "agent_save_post", { owner: owner.id, workspace: "team", post: post("t1") });
    assert.equal(made.version, 1);

    await setLevel(owner.id, 1);
    await refuses(rpc(memberAgent, "agent_save_post", { owner: owner.id, workspace: "team", post: post("t2") }), "42501");
    const own = await rpc(memberAgent, "agent_context");
    assert.equal(own.owner, member.id);
    assert.equal(own.workspace, "default");
  });

  test("files copy onto a post only from this workspace's library or posts, as new files", async () => {
    const copy = (sources, files, token = agent) => rpc(token, "agent_copy_files", { owner: owner.id, workspace: "default", sources, files });
    assert.deepEqual(await copy(["media/m1"], ["p4_a"]), { level: 1 });
    assert.deepEqual(await copy(["posts/p1", "media/m1"], ["p4_b", "p4_c"]), { level: 1 });
    await refuses(copy(["media/m2"], ["p4_d"]), "P0002");
    await refuses(copy(["posts/t1"], ["p4_d"]), "P0002");
    await refuses(copy(["posts/p2"], ["p4_d"]), "P0002");
    await refuses(copy(["media/m1"], ["t1"]), "42501");
    await refuses(copy(["media/m1"], ["p1"]), "42501");
    await refuses(copy(["media/m1"], ["../x"]), "22023");
    await refuses(copy(["sent/m1"], ["p4_d"]), "22023");
    await refuses(copy(["media/m1", "media/m1"], ["p4_e"]), "22023");
    await refuses(copy(["media/m1", "posts/p1"], ["p4_e", "p4_e"]), "22023");
  });

  test("a connector signed out speaks for nobody", async () => {
    const extra = await connect(owner);
    assert.equal((await rpc(extra, "agent_context")).owner, owner.id);
    sql(`delete from auth.sessions where user_id = '${owner.id}' and oauth_client_id is not null and id = '${JSON.parse(Buffer.from(extra.split(".")[1], "base64url")).session_id}'`);
    await refuses(rpc(extra, "agent_context"), "28000");
  });

  test("the MCP server's own tools schedule, change and list a post the publisher then reads", async () => {
    await setLevel(owner.id, 2);
    const tools = createPostingTools(createStore({ supabaseUrl: URL, anonKey: ANON, storageUrl: "http://127.0.0.1:9", token: agent }));
    const run = async (name, args) => {
      const outcome = await tools.run(name, args);
      assert.equal(outcome.error, false, outcome.text ?? outcome.tab);
      return JSON.parse(outcome.text);
    };
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const made = await run("schedule_post", { caption: "From an agent", platforms: ["bluesky"], day, time: "10:00" });
    assert.equal(made.status, "scheduled");
    const changed = await run("update_post", { id: made.id, caption: "Changed by an agent" });
    assert.equal(changed.caption, "Changed by an agent");
    const listed = await run("list_posts", { from: day, to: day });
    assert.deepEqual(listed.posts.map((post) => post.id), [made.id]);

    const seen = sql(`select data ->> 'description' || ' ' || version || ' ' || (next_run_at is not null) from posts p join post_schedule s on s.owner_id = p.owner_id and s.post_id = p.id where p.id = '${made.id}'`);
    assert.equal(seen, "Changed by an agent 2 true");
    const [due] = JSON.parse(sql(`select coalesce(json_agg(json_build_object('id', post ->> 'id', 'zone', time_zone)), '[]') from publisher_posts() where post ->> 'id' = '${made.id}'`));
    assert.equal(due.id, made.id);
  });
});
