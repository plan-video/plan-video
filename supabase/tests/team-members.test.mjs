// Team members against a real Supabase: the tables, functions and policies of
// migrations/20261014200000_team_members.sql, as an owner, an admin, a member
// and an outsider would meet them. Runs against a local stack:
//
//   supabase start            (in a copy of this folder, with the migrations applied)
//   node --test supabase/tests/team-members.test.mjs
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY point it at
// another one. It makes its own users, with random addresses, and leaves them.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, test } from "node:test";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const run = randomUUID().slice(0, 8);
const address = (name) => `${name}-${run}@team.test`;
const PASSWORD = "team-test-password";

async function call(path, { token = SERVICE, method = "GET", body, prefer } = {}) {
  const response = await fetch(`${URL}${path}`, {
    method,
    headers: {
      apikey: token === SERVICE ? SERVICE : ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { status: response.status, data };
}

/** Calls a function as `token`. Throws with Postgres's code when it refuses. */
async function rpc(token, name, args = {}) {
  const { status, data } = await call(`/rest/v1/rpc/${name}`, { token, method: "POST", body: args });
  if (status >= 400) {
    const error = new Error(data?.message || `rpc ${name} failed with ${status}`);
    error.code = data?.code;
    throw error;
  }
  return data;
}

async function refuses(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

async function makeUser(name, { letIn = false } = {}) {
  const email = address(name);
  // Let in from the waitlist, as the owner is: the others get in through the team, or not at all.
  if (letIn) {
    const invited = await call("/rest/v1/waitlist", { method: "POST", body: { email, invited_at: new Date().toISOString() } });
    assert.ok(invited.status < 300, JSON.stringify(invited.data));
  }
  const made = await call("/auth/v1/admin/users", { method: "POST", body: { email, password: PASSWORD, email_confirm: true } });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const session = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  }).then((response) => response.json());
  assert.ok(session.access_token, JSON.stringify(session));
  return { id: made.data.id, email, token: session.access_token };
}

async function setLevel(userId, level) {
  const { status } = await call(`/rest/v1/user_data?id=eq.${userId}`, { method: "PATCH", body: { access_level: level } });
  assert.ok(status < 300);
}

function slice(overrides = {}) {
  return {
    connections: [],
    groups: [],
    queue: [],
    boards: [],
    vault: [],
    signatureId: null,
    templates: [],
    plugs: [],
    captionStyles: [],
    calendars: [{ id: "posts", name: "Posts", color: "sky", createdAt: "2026-10-01T00:00:00.000Z" }],
    library: [],
    ...overrides,
  };
}

const W1 = "default";
const W2 = randomUUID();

async function ownerPayload(owner) {
  const { data } = await call(`/rest/v1/account_state?select=payload&user_id=eq.${owner.id}`);
  return data[0]?.payload;
}

/** Saves the owner's account the way their browser does: an upsert naming the revision it merged with. */
async function saveOwner(owner, payload, base) {
  return call("/rest/v1/account_state?on_conflict=user_id", {
    token: owner.token,
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { user_id: owner.id, payload: base === undefined ? payload : { ...payload, base }, updated_at: new Date().toISOString() },
  });
}

let owner, admin, member, outsider;
let memberInvite, adminInvite;

before(async () => {
  [owner, admin, member, outsider] = await Promise.all([makeUser("owner", { letIn: true }), makeUser("admin"), makeUser("member"), makeUser("outsider")]);
  await setLevel(owner.id, 3);
  const saved = await saveOwner(owner, {
    revision: "r1",
    workspaces: {
      active: W1,
      list: [
        { id: W1, name: "Owner's workspace", color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] },
        { id: W2, name: "Second brand", color: "#E07A5F", createdAt: "2026-10-02T00:00:00.000Z", members: [] },
      ],
    },
    timeZone: "Europe/Amsterdam",
    notifications: { read: [], cleared: [], seen: {} },
    slices: {
      [W1]: slice({ connections: [{ id: "conn-1", platform: "tiktok", handle: "brand" }] }),
      [W2]: slice({
        connections: [{ id: "conn-2", platform: "youtube", handle: "other" }],
        library: [{ id: "lib-secret", name: "secret.mp4", kind: "video", cloud: { key: "media/x/lib-secret" } }],
      }),
    },
  });
  assert.ok(saved.status < 300, JSON.stringify(saved.data));
  // Posts live in their own table (posts.test.mjs covers who reaches them).
  for (const [workspace, data] of [
    [W1, { id: "post-1", title: "First", day: "2026-10-20", calendarId: "posts", status: "draft" }],
    [
      W2,
      {
        id: "post-secret",
        title: "Secret",
        day: "2026-10-21",
        calendarId: "posts",
        status: "draft",
        files: ["post-secret_file"],
        media: [{ id: "post-secret_file", name: "secret.mp4", type: "video/mp4", lastModified: 0 }],
      },
    ],
  ]) {
    const made = await call("/rest/v1/posts", { token: owner.token, method: "POST", body: { owner_id: owner.id, id: data.id, workspace_id: workspace, data }, prefer: "return=minimal" });
    assert.ok(made.status < 300, JSON.stringify(made.data));
  }
});

describe("inviting", () => {
  test("nobody outside the workspace can invite, and Creator can't have a team", async () => {
    await refuses(rpc(outsider.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: outsider.email, role: "member" }), "42501");
    await setLevel(owner.id, 2);
    await refuses(rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: member.email, role: "member" }), "P0001");
    await setLevel(owner.id, 3);
  });

  test("the invite lets its person in while the app is invite-only", async () => {
    assert.equal(await rpc(member.token, "has_access"), false);
    assert.equal(await rpc(ANON, "is_invited", { address: member.email }), false);
    memberInvite = await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: ` ${member.email.toUpperCase()} `, role: "member" });
    assert.equal(memberInvite.email, member.email);
    assert.equal(memberInvite.role, "member");
    adminInvite = await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: admin.email, role: "admin" });
    assert.equal(await rpc(member.token, "has_access"), true);
    assert.equal(await rpc(ANON, "is_invited", { address: member.email }), true);
  });

  test("the same person twice, the owner, and a bad role or address are refused", async () => {
    await refuses(rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: member.email, role: "member" }), "23505");
    await refuses(rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: owner.email, role: "member" }), "23505");
    await refuses(rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: "nobody", role: "member" }), "22023");
    await refuses(rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: address("x"), role: "owner" }), "22023");
    await refuses(rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: "gone", address: address("y"), role: "member" }), "P0002");
  });

  test("the invitee sees it, and only they can take it", async () => {
    const team = await rpc(member.token, "my_team");
    assert.equal(team.workspaces.length, 0);
    assert.equal(team.invites.length, 1);
    assert.equal(team.invites[0].id, memberInvite.id);
    assert.equal(team.invites[0].look.name, "Owner's workspace");
    assert.deepEqual(Object.keys(team.invites[0].look).sort(), ["color", "name"]);
    assert.equal(team.invites[0].open, true);
    assert.equal(team.invites[0].ownerEmail, owner.email);
    assert.equal((await rpc(outsider.token, "my_team")).invites.length, 0);
    await refuses(rpc(outsider.token, "accept_workspace_invite", { invite: memberInvite.id }), "P0002");
    await refuses(rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 }), "42501");
  });

  test("accepting joins the workspace", async () => {
    const joined = await rpc(member.token, "accept_workspace_invite", { invite: memberInvite.id });
    assert.deepEqual(joined, { owner: owner.id, workspace: W1, role: "member" });
    await rpc(admin.token, "accept_workspace_invite", { invite: adminInvite.id });
    const team = await rpc(member.token, "my_team");
    assert.equal(team.invites.length, 0);
    assert.equal(team.workspaces.length, 1);
    assert.equal(team.workspaces[0].state, "active");
    assert.equal(team.workspaces[0].role, "member");
    assert.equal(team.workspaces[0].look.color, "sky");
    await refuses(rpc(member.token, "accept_workspace_invite", { invite: memberInvite.id }), "P0002");
  });

  test("everyone in the workspace sees who's in it; nobody else does", async () => {
    const team = await rpc(member.token, "workspace_team", { owner: owner.id, workspace: W1 });
    assert.equal(team.owner.email, owner.email);
    assert.equal(team.paused, false);
    assert.deepEqual(team.members.map((row) => row.email).sort(), [admin.email, member.email].sort());
    await refuses(rpc(outsider.token, "workspace_team", { owner: owner.id, workspace: W1 }), "42501");
    await refuses(rpc(member.token, "workspace_team", { owner: owner.id, workspace: W2 }), "42501");
    const { data: rows } = await call(`/rest/v1/workspace_members?select=email`, { token: outsider.token });
    assert.deepEqual(rows, []);
    const { data: seen } = await call(`/rest/v1/workspace_members?select=email&owner_id=eq.${owner.id}`, { token: member.token });
    assert.equal(seen.length, 2);
  });

  test("the services read a role and the owner's plan", async () => {
    assert.deepEqual(await rpc(member.token, "team_access", { owner: owner.id, workspace: W1 }), { role: "member", level: 3 });
    assert.deepEqual(await rpc(admin.token, "team_access", { owner: owner.id, workspace: W1 }), { role: "admin", level: 3 });
    assert.deepEqual(await rpc(owner.token, "team_access", { owner: owner.id, workspace: W2 }), { role: "owner", level: 3 });
    assert.equal(await rpc(member.token, "team_access", { owner: owner.id, workspace: W2 }), null);
    assert.equal(await rpc(outsider.token, "team_access", { owner: owner.id, workspace: W1 }), null);
  });
});

describe("working in a shared workspace", () => {
  test("a member reads their workspace and nothing else of the owner's", async () => {
    const shared = await rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 });
    assert.equal(shared.revision, "r1");
    assert.equal(shared.role, "member");
    assert.equal(shared.slice.events, undefined);
    assert.ok(!JSON.stringify(shared).includes("post-secret"));
    assert.ok(!JSON.stringify(shared).includes("lib-secret"));
    const { data: posts } = await call(`/rest/v1/posts?select=id&owner_id=eq.${owner.id}`, { token: member.token });
    assert.deepEqual(posts.map((row) => row.id), ["post-1"]);
    const { data } = await call(`/rest/v1/account_state?select=payload&user_id=eq.${owner.id}`, { token: member.token });
    assert.deepEqual(data, []);
  });

  test("a save over a stale copy is refused, and a fresh one lands in the owner's account", async () => {
    const changed = slice({
      connections: [{ id: "conn-evil", platform: "x", handle: "hijack" }],
      groups: [{ id: "group-1", name: "By the member" }],
    });
    assert.deepEqual(await rpc(member.token, "save_team_workspace", { owner: owner.id, workspace: W1, slice: changed, base: "stale" }), { conflict: true });
    const saved = await rpc(member.token, "save_team_workspace", { owner: owner.id, workspace: W1, slice: changed, base: "r1" });
    assert.ok(saved.revision && saved.revision !== "r1");
    const payload = await ownerPayload(owner);
    assert.equal(payload.revision, saved.revision);
    assert.deepEqual(payload.slices[W1].groups.map((group) => group.id), ["group-1"]);
    // A member can't change the accounts a workspace posts from.
    assert.deepEqual(payload.slices[W1].connections.map((row) => row.id), ["conn-1"]);
    // The rest of the account is as it was.
    assert.deepEqual(payload.slices[W2].library.map((item) => item.id), ["lib-secret"]);
    assert.equal(payload.timeZone, "Europe/Amsterdam");
    assert.equal(payload.workspaces.list.length, 2);
  });

  test("nobody's copy can take another workspace's library items, or carry posts", async () => {
    const payload = await ownerPayload(owner);
    const sneaky = {
      ...payload.slices[W1],
      events: [{ id: "post-secret", title: "Hijacked", day: "2026-10-21", calendarId: "posts", status: "scheduled" }],
      media: [{ id: "post-secret_file", name: "b.mp4", type: "video/mp4", lastModified: 0 }],
      library: [
        { id: "lib-secret", name: "x.mp4", kind: "video", cloud: { key: "k" } },
        { id: "post-secret_file", name: "named like a post's file", kind: "video", cloud: { key: "k" } },
        { id: "lib-mine", name: "mine.mp4", kind: "video", cloud: { key: "k" } },
      ],
    };
    const saved = await rpc(member.token, "save_team_workspace", { owner: owner.id, workspace: W1, slice: sneaky, base: payload.revision });
    assert.equal(saved.same, false);
    const after = await ownerPayload(owner);
    assert.equal(after.slices[W1].events, undefined);
    assert.equal(after.slices[W1].media, undefined);
    assert.deepEqual(after.slices[W1].library.map((item) => item.id), ["lib-mine"]);
    const { data: secret } = await call(`/rest/v1/posts?select=data&owner_id=eq.${owner.id}&id=eq.post-secret`);
    assert.equal(secret[0].data.title, "Secret");
    // A copy with nothing to leave out says so.
    const clean = await rpc(member.token, "save_team_workspace", { owner: owner.id, workspace: W1, slice: after.slices[W1], base: after.revision });
    assert.equal(clean.same, true);
  });

  test("the storage signer lets a member reach only their workspace's files", async () => {
    const allowed = (person, ids, workspace = W1) => rpc(person.token, "team_files_allowed", { owner: owner.id, workspace, ids });
    assert.equal(await allowed(member, ["lib-mine", "brand-new-file"]), true);
    assert.equal(await allowed(member, ["post-secret_file"]), false);
    assert.equal(await allowed(member, ["post-secret"]), false);
    assert.equal(await allowed(member, ["lib-secret-poster"]), false);
    assert.equal(await allowed(outsider, ["brand-new-file"]), false);
    assert.equal(await allowed(member, ["brand-new-file"], W2), false);
    // No browser reads another workspace's ids any more, not even its own workspace's foreign list.
    await refuses(rpc(member.token, "team_foreign_ids", { owner: owner.id, workspace: W1 }), "42501");
    await refuses(rpc(member.token, "team_plan", { owner: owner.id }), "42501");
    await refuses(rpc(member.token, "owner_has_workspace", { owner: owner.id, workspace: W2 }), "42501");
  });

  test("an admin can change the workspace's accounts, but not take another workspace's", async () => {
    const payload = await ownerPayload(owner);
    const next = {
      ...payload.slices[W1],
      connections: [...payload.slices[W1].connections, { id: "conn-3", platform: "x", handle: "brand" }, { id: "conn-2", platform: "youtube", handle: "other" }],
    };
    await rpc(admin.token, "save_team_workspace", { owner: owner.id, workspace: W1, slice: next, base: payload.revision });
    const after = await ownerPayload(owner);
    assert.deepEqual(after.slices[W1].connections.map((row) => row.id), ["conn-1", "conn-3"]);
    assert.deepEqual(after.slices[W2].connections.map((row) => row.id), ["conn-2"]);
  });

  test("the owner's own save is refused when someone saved meanwhile", async () => {
    const payload = await ownerPayload(owner);
    const stale = await saveOwner(owner, { ...payload, revision: "r-owner" }, "r1");
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, "PT409");
    const fresh = await saveOwner(owner, { ...payload, revision: "r-owner" }, payload.revision);
    assert.ok(fresh.status < 300, JSON.stringify(fresh.data));
    const stored = await ownerPayload(owner);
    assert.equal(stored.revision, "r-owner");
    assert.equal("base" in stored, false);
    // Older code that doesn't say what it merged with still saves.
    const older = await saveOwner(owner, { ...stored, revision: "r-old-code" });
    assert.ok(older.status < 300);
  });

  test("members hear when their workspace changes, and only theirs", async () => {
    const { data } = await call(`/rest/v1/workspace_versions?select=workspace_id,revision&owner_id=eq.${owner.id}`, { token: member.token });
    assert.deepEqual(data.map((row) => row.workspace_id), [W1]);
    const { data: none } = await call(`/rest/v1/workspace_versions?select=workspace_id&owner_id=eq.${owner.id}`, { token: outsider.token });
    assert.deepEqual(none, []);
    const before = data[0].revision;
    const payload = await ownerPayload(owner);
    // A change to another workspace doesn't touch this one's version.
    const other = {
      ...payload,
      revision: "r-other",
      slices: { ...payload.slices, [W2]: { ...payload.slices[W2], groups: [{ id: "group-w2", name: "Edited" }] } },
    };
    await saveOwner(owner, other, payload.revision);
    const { data: after } = await call(`/rest/v1/workspace_versions?select=revision&owner_id=eq.${owner.id}`, { token: member.token });
    assert.equal(after[0].revision, before);
    const renamed = {
      ...other,
      revision: "r-renamed",
      workspaces: { ...other.workspaces, list: other.workspaces.list.map((row) => (row.id === W1 ? { ...row, name: "Renamed" } : row)) },
    };
    await saveOwner(owner, renamed, "r-other");
    const { data: moved } = await call(`/rest/v1/workspace_versions?select=revision&owner_id=eq.${owner.id}`, { token: member.token });
    assert.equal(moved[0].revision, "r-renamed");
    assert.equal((await rpc(member.token, "my_team")).workspaces[0].look.name, "Renamed");
  });

  test("members see how their workspace's posts went out, not the others'", async () => {
    const rows = [W1, W2].map((workspace, index) => ({
      user_id: owner.id,
      workspace_id: workspace,
      post_id: `post-${index}`,
      occurrence: "once",
      platform: "tiktok",
      connection_id: `conn-${index}`,
      state: "sent",
      due_at: new Date().toISOString(),
    }));
    const made = await call("/rest/v1/post_deliveries", { method: "POST", body: rows, prefer: "return=minimal" });
    assert.ok(made.status < 300, JSON.stringify(made.data));
    const read = async (person) =>
      (await call(`/rest/v1/post_deliveries?select=workspace_id&user_id=eq.${owner.id}`, { token: person.token })).data.map((row) => row.workspace_id);
    assert.deepEqual(await read(member), [W1]);
    assert.deepEqual(await read(outsider), []);
    assert.deepEqual((await read(owner)).sort(), [W1, W2].sort());
  });

  test("members share previews of their workspace's posts as the owner's", async () => {
    const share = (person, workspace, post) =>
      call("/rest/v1/post_previews?on_conflict=owner_id,post_id&select=id", {
        token: person.token,
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: { owner_id: owner.id, post_id: post, snapshot: { title: "Hi", workspaceId: workspace } },
      });
    const made = await share(member, W1, "post-2");
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const preview = made.data[0].id;
    assert.equal((await share(member, W2, "post-secret")).status, 403);
    // Not another workspace's post, even said to be in this one.
    assert.equal((await share(member, W1, "post-secret")).status, 403);
    // Nor moved to the member's own account, or to another post.
    const moved = await call(`/rest/v1/post_previews?id=eq.${preview}`, { token: member.token, method: "PATCH", body: { owner_id: member.id } });
    assert.ok(moved.status >= 400, JSON.stringify(moved.data));
    const repointed = await call(`/rest/v1/post_previews?id=eq.${preview}`, { token: member.token, method: "PATCH", body: { post_id: "post-secret" } });
    assert.ok(repointed.status >= 400, JSON.stringify(repointed.data));
    assert.equal((await share(outsider, W1, "post-x")).status, 403);
    const shown = await rpc(member.token, "get_post_preview", { preview });
    assert.equal(shown.isOwner, true);
    assert.equal((await rpc(outsider.token, "get_post_preview", { preview })).isOwner, false);
    await rpc(member.token, "add_post_preview_comment", { preview, name: "Member", body: "Looks good" });
    assert.equal((await rpc(owner.token, "get_post_preview", { preview })).comments[0].byOwner, true);
  });
});

describe("roles and leaving", () => {
  test("members can't manage people; admins can", async () => {
    const team = await rpc(owner.token, "workspace_team", { owner: owner.id, workspace: W1 });
    const memberRow = team.members.find((row) => row.email === member.email);
    await refuses(rpc(member.token, "set_workspace_member_role", { member: memberRow.id, role: "admin" }), "42501");
    await refuses(rpc(member.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: address("friend"), role: "member" }), "42501");
    await rpc(admin.token, "set_workspace_member_role", { member: memberRow.id, role: "admin" });
    assert.deepEqual(await rpc(member.token, "team_access", { owner: owner.id, workspace: W1 }), { role: "admin", level: 3 });
    await rpc(admin.token, "set_workspace_member_role", { member: memberRow.id, role: "member" });
    const invite = await rpc(admin.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: address("friend"), role: "member" });
    await refuses(rpc(member.token, "remove_workspace_member", { member: invite.id }), "42501");
    await rpc(admin.token, "remove_workspace_member", { member: invite.id });
  });

  test("an invite can be turned down, and a member can leave", async () => {
    const invite = await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W2, address: outsider.email, role: "member" });
    assert.equal((await rpc(outsider.token, "my_team")).invites.length, 1);
    await rpc(outsider.token, "remove_workspace_member", { member: invite.id });
    assert.equal((await rpc(outsider.token, "my_team")).invites.length, 0);
    assert.equal(await rpc(outsider.token, "has_access"), false);

    const leaving = await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W2, address: member.email, role: "member" });
    await rpc(member.token, "accept_workspace_invite", { invite: leaving.id });
    assert.equal((await rpc(member.token, "team_workspace", { owner: owner.id, workspace: W2 })).role, "member");
    await rpc(member.token, "remove_workspace_member", { member: leaving.id });
    await refuses(rpc(member.token, "team_workspace", { owner: owner.id, workspace: W2 }), "42501");
  });

  test("a smaller plan pauses the team without losing it", async () => {
    await setLevel(owner.id, 2);
    await refuses(rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 }), "42501");
    await refuses(rpc(member.token, "save_team_workspace", { owner: owner.id, workspace: W1, slice: slice(), base: "x" }), "42501");
    assert.equal((await rpc(member.token, "my_team")).workspaces[0].state, "paused");
    assert.equal(await rpc(member.token, "has_access"), false);
    assert.equal((await rpc(owner.token, "workspace_team", { owner: owner.id, workspace: W1 })).paused, true);
    await setLevel(owner.id, 4);
    assert.equal((await rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 })).role, "member");
  });

  test("deleting the workspace takes its team with it", async () => {
    const payload = await ownerPayload(owner);
    const { [W1]: _gone, ...slices } = payload.slices;
    const without = { ...payload, revision: "r-deleted", workspaces: { active: W2, list: payload.workspaces.list.filter((row) => row.id !== W1) }, slices };
    await saveOwner(owner, without, payload.revision);
    // Gone from the account: the membership stays but opens nothing.
    assert.equal((await rpc(member.token, "my_team")).workspaces[0].state, "gone");
    await refuses(rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 }), "42501");
    await rpc(owner.token, "forget_workspace_team", { workspace: W1 });
    assert.equal((await rpc(member.token, "my_team")).workspaces.length, 0);
  });
});
