// A workspace shared with a team member, through the posts table: the
// owner's and the member's posts reach each other, the owner's other
// workspaces never reach the member, and a paused team holds the member's
// changes until it's back. See helpers.mjs for how to run it.

import { assert, inStore, launch, openDashboard, person, post, postIn, randomUUID, rest, serverPost, sleep, slice, step, until } from "./helpers.mjs";

const owner = await person("owner", 3);
const member = await person("member", 1);
const W = randomUUID();
await rest("/rest/v1/account_state", {
  method: "POST",
  token: owner.session.access_token,
  body: {
    user_id: owner.id,
    payload: {
      revision: "r1",
      timeZone: "Europe/Amsterdam",
      notifications: { read: [], cleared: [], seen: {} },
      workspaces: { active: W, list: [{ id: "default", name: "Mine", color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] }, { id: W, name: "Team W", color: "#E07A5F", createdAt: "2026-10-02T00:00:00.000Z", members: [] }] },
      slices: { default: slice(), [W]: slice() },
    },
  },
});
const invite = await rest("/rest/v1/rpc/invite_workspace_member", { method: "POST", token: owner.session.access_token, body: { owner: owner.id, workspace: W, address: member.email, role: "member" } });
await rest("/rest/v1/rpc/accept_workspace_invite", { method: "POST", token: member.session.access_token, body: { invite: invite.id } });
console.log("owner", owner.id, "member", member.id, "workspace", W);

const { device, finish } = await launch();

const O = await device("owner", owner);
const M = await device("member", member);
const sharedId = `shared-${owner.id}-${W}`;
const switchTo = (dev, id) => dev.page.evaluate(async (id) => (await import("/src/lib/workspaces.ts")).switchWorkspace(id), id);

await step("the owner opens Team W, the member opens it as a shared workspace", async () => {
  await openDashboard(O);
  await until("owner in Team W", () => O.page.evaluate(async () => (await import("/src/lib/workspaces.ts")).activeWorkspaceId()).then((id) => id === W ? id : null));
  await openDashboard(M);
  await until("the member's team list", () => M.page.evaluate(async (id) => (await import("/src/lib/workspaces.ts")).sharedWorkspaces().some((row) => row.id === id), sharedId));
  await switchTo(M, sharedId);
  await until("member's calendar", () => inStore(M, async (store) => (await store.hydrateCalendar(), store.loaded())));
});

await step("a post the owner makes in Team W reaches the member", async () => {
  await inStore(O, (store, _p, value) => store.restoreEvent(value), post("team-1"));
  const row = await until("on the server", () => serverPost(owner.id, "team-1"));
  assert.equal(row.workspace_id, W);
  await until("on the member's", () => postIn(M, "team-1"));
});

await step("the member's edit reaches the owner", async () => {
  await inStore(M, (store) => store.revisePost("team-1", { title: "Edited by the member" }));
  await until("on the owner's", async () => (await postIn(O, "team-1"))?.title === "Edited by the member");
});

await step("a post the member makes lands in the owner's workspace", async () => {
  await inStore(M, (store, _p, value) => store.restoreEvent(value), post("by-member"));
  const row = await until("on the server", () => serverPost(owner.id, "by-member"));
  assert.equal(row.workspace_id, W);
  await until("on the owner's", () => postIn(O, "by-member"));
});

await step("a post in the owner's own workspace never reaches the member", async () => {
  await switchTo(O, "default");
  await until("owner's own calendar", () => inStore(O, async (store) => (await store.hydrateCalendar(), store.loaded())));
  await inStore(O, (store, _p, value) => store.restoreEvent(value), post("private-1"));
  const row = await until("private on the server", () => serverPost(owner.id, "private-1"));
  assert.equal(row.workspace_id, "default");
  await sleep(2500);
  assert.equal(await postIn(M, "private-1"), null);
  const seen = await rest(`/rest/v1/posts?select=id&owner_id=eq.${owner.id}`, { token: member.session.access_token });
  assert.ok(!seen.some((item) => item.id === "private-1"), JSON.stringify(seen));
});

await step("with the owner's team paused, the member's change is held and named; back on, it goes", async () => {
  await rest(`/rest/v1/user_data?id=eq.${owner.id}`, { method: "PATCH", body: { access_level: 2 } });
  await inStore(M, (store) => store.revisePost("team-1", { description: "While paused" }));
  await until("named as not synced", () => inStore(M, (_store, posts) => posts.unsyncedPosts().has("team-1")), 20_000);
  assert.notEqual((await serverPost(owner.id, "team-1")).data.description, "While paused");
  await rest(`/rest/v1/user_data?id=eq.${owner.id}`, { method: "PATCH", body: { access_level: 3 } });
  // The member's team list is read again (on their next focus, or the team's next change), and the workspace is open again.
  await M.page.evaluate(async () => (await import("/src/lib/team.ts")).refreshTeam());
  await until("active again", () => M.page.evaluate(async (id) => (await import("/src/lib/workspaces.ts")).sharedWorkspaces().find((row) => row.id === id)?.state === "active", sharedId));
  await switchTo(M, sharedId);
  await until("member's calendar again", () => inStore(M, async (store) => (await store.hydrateCalendar(), store.loaded() && store.allPosts().some((post) => post.id === "team-1"))));
  // What was changed while paused went once it could.
  await until("the paused change on the server", async () => (await serverPost(owner.id, "team-1")).data.description === "While paused", 20_000);
  assert.equal(await inStore(M, (store) => store.revisePost("team-1", { description: "After the pause" }) ?? "edited"), "edited");
  try {
    await until("on the server", async () => (await serverPost(owner.id, "team-1")).data.description === "After the pause", 20_000);
  } catch (error) {
    console.log("member state", await inStore(M, async (store, posts) => {
      const ws = await import("/src/lib/workspaces.ts");
      const shown = store.allPosts().find((post) => post.id === "team-1");
      return JSON.stringify({ active: ws.activeWorkspaceId(), shared: ws.sharedWorkspaces().map((row) => [row.id, row.state]), problem: posts.postSyncProblem(), unsynced: [...posts.unsyncedPosts()], refused: [...posts.refusedPosts()], shown: shown?.description });
    }));
    console.log("server", JSON.stringify(await serverPost(owner.id, "team-1")));
    throw error;
  }
});


await finish();
