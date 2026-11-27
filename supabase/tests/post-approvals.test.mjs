// See helpers.mjs for how to run it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";

import { ANON, call, makeUser, refuses, rpc, saveOwner, setLevel, slice } from "./helpers.mjs";

const W1 = "default";
let owner, admin, member, outsider;

const dayFromNow = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

function post(id, overrides = {}) {
  return {
    id,
    title: id,
    description: "Hello",
    day: dayFromNow(2),
    start: "09:00",
    allDay: false,
    duration: 30,
    calendarId: "posts",
    createdAt: "2026-11-01T08:00:00.000Z",
    link: null,
    platforms: ["x"],
    recurrence: null,
    recurrenceExceptions: [],
    status: "draft",
    timeZone: "Europe/Amsterdam",
    ...overrides,
  };
}

const pending = (overrides = {}) => ({ approval: { state: "pending", by: "Sam", at: new Date().toISOString() }, ...overrides });

const insert = (person, data) =>
  call("/rest/v1/posts", { token: person.token, method: "POST", prefer: "return=representation", body: { owner_id: owner.id, id: data.id, workspace_id: W1, data } });

const update = (person, id, version, data) =>
  call(`/rest/v1/posts?owner_id=eq.${owner.id}&id=eq.${id}&version=eq.${version}`, { token: person.token, method: "PATCH", prefer: "return=representation", body: { data } });

const one = async (id) => (await call(`/rest/v1/posts?select=*&owner_id=eq.${owner.id}&id=eq.${id}`)).data[0];

async function made(person, data) {
  const answer = await insert(person, data);
  assert.equal(answer.status, 201, JSON.stringify(answer.data));
  return answer.data[0];
}

async function share(id) {
  const answer = await call("/rest/v1/post_previews", {
    token: owner.token,
    method: "POST",
    prefer: "return=representation",
    body: { owner_id: owner.id, post_id: id, snapshot: { title: id, workspaceId: W1, platforms: [], status: "draft" } },
  });
  assert.equal(answer.status, 201, JSON.stringify(answer.data));
  return answer.data[0].id;
}

const visitor = { token: ANON };
const comments = async (preview) => (await call(`/rest/v1/post_preview_comments?select=*&preview_id=eq.${preview}&order=created_at`)).data;

before(async () => {
  [owner, admin, member, outsider] = await Promise.all(["owner", "admin", "member", "outsider"].map(makeUser));
  await setLevel(owner.id, 3);
  const saved = await saveOwner(owner, {
    revision: "r1",
    workspaces: { active: W1, list: [{ id: W1, name: "Brand", color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] }] },
    timeZone: "Europe/Amsterdam",
    notifications: { read: [], cleared: [], seen: {} },
    slices: { [W1]: slice({ connections: [{ id: "conn-1", platform: "x", handle: "brand" }] }) },
  });
  assert.ok(saved.status < 300, JSON.stringify(saved.data));
  for (const [person, role] of [
    [member, "member"],
    [admin, "admin"],
  ]) {
    const invite = await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W1, address: person.email, role });
    await rpc(person.token, "accept_workspace_invite", { invite: invite.id });
  }
});

test("a client approves through the link without an account, and the post is scheduled for its time", async () => {
  await made(member, post("ap-1", pending()));
  const preview = await share("ap-1");

  const answer = await rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: "Client Co" });
  assert.deepEqual(answer, { state: "approved", status: "scheduled" });
  const row = await one("ap-1");
  assert.equal(row.data.status, "scheduled");
  assert.equal(row.data.approval.state, "approved");
  assert.equal(row.data.approval.by, "Client Co");
  assert.equal(row.data.approval.via, "link");
  assert.ok(Date.parse(row.data.sendFrom) > Date.now() - 60_000, "past runs never go out at once");

  // A second click changes nothing and says nothing more.
  await rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: "Client Co" });
  const kept = await comments(preview);
  assert.deepEqual(kept.map((comment) => comment.kind), ["approved"]);
  assert.equal(kept[0].body, "");
});

test("approving a post whose time passed while it waited leaves it an approved draft", async () => {
  await made(member, post("ap-2", pending({ day: dayFromNow(-1) })));
  const preview = await share("ap-2");
  const answer = await rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: "Client" });
  assert.deepEqual(answer, { state: "approved", status: "draft" });
  assert.equal((await one("ap-2")).data.status, "draft");
});

test("a series is scheduled when approved, and asking for changes takes it off the schedule", async () => {
  await made(owner, post("ap-3", pending({ day: dayFromNow(-30), recurrence: "weekday" })));
  const preview = await share("ap-3");
  assert.equal((await rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: "Client" })).status, "scheduled");

  const answer = await rpc(visitor.token, "review_post_preview", { preview, decision: "changes", name: "Client", note: "Use the blue logo" });
  assert.deepEqual(answer, { state: "changes", status: "draft" });
  const row = await one("ap-3");
  assert.equal(row.data.status, "draft");
  assert.equal(row.data.approval.note, "Use the blue logo");
  assert.deepEqual((await comments(preview)).map((comment) => [comment.kind, comment.body]), [
    ["approved", ""],
    ["changes", "Use the blue logo"],
  ]);
});

test("an ended series stays a draft when approved", async () => {
  await made(owner, post("ap-3b", pending({ day: dayFromNow(-30), recurrence: "weekday", recurrenceEnd: dayFromNow(-2) })));
  const preview = await share("ap-3b");
  assert.equal((await rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: "Client" })).status, "draft");
});

test("only a post waiting for approval can be decided on, and a posted one never", async () => {
  await made(owner, post("ap-4"));
  const preview = await share("ap-4");
  await refuses(rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: "Client" }), "22023");
  await refuses(rpc(visitor.token, "review_post_preview", { preview, decision: "approved", name: " " }), "22023");
  await refuses(rpc(visitor.token, "review_post_preview", { preview, decision: "maybe", name: "Client" }), "22023");
  await refuses(rpc(visitor.token, "review_post_preview", { preview: randomUUID(), decision: "approved", name: "Client" }), "P0002");

  await made(owner, post("ap-5", pending({ status: "posted" })));
  const posted = await share("ap-5");
  await refuses(rpc(visitor.token, "review_post_preview", { preview: posted, decision: "changes", name: "Client" }), "22023");
});

test("owners and admins decide in the dashboard; members can't, there or through the link", async () => {
  await made(member, post("ap-6", pending()));
  const preview = await share("ap-6");
  await refuses(rpc(member.token, "review_post", { owner: owner.id, post: "ap-6", decision: "approved" }), "42501");
  await refuses(rpc(member.token, "review_post_preview", { preview, decision: "approved", name: "Me" }), "42501");
  await refuses(rpc(outsider.token, "review_post", { owner: owner.id, post: "ap-6", decision: "approved" }), "42501");

  const answer = await rpc(admin.token, "review_post", { owner: owner.id, post: "ap-6", decision: "approved" });
  assert.equal(answer.status, "scheduled");
  const row = await one("ap-6");
  assert.equal(row.data.approval.via, "team");
  assert.ok(row.data.approval.by);
  assert.deepEqual((await comments(preview)).map((comment) => [comment.kind, comment.author_id]), [["approved", admin.id]]);

  // A signed-in stranger with the link counts as the client.
  await made(owner, post("ap-6b", pending()));
  const other = await share("ap-6b");
  assert.equal((await rpc(outsider.token, "review_post_preview", { preview: other, decision: "approved", name: "Client" })).state, "approved");
});

test("members ask for approval but can't write a decision themselves", async () => {
  const row = await made(member, post("ap-7"));
  const asked = await update(member, "ap-7", row.version, { ...row.data, ...pending() });
  assert.equal(asked.status, 200, JSON.stringify(asked.data));

  const forged = await update(member, "ap-7", asked.data[0].version, { ...asked.data[0].data, approval: { state: "approved", by: "Boss" } });
  assert.equal(forged.data.code, "42501");
  // The owner and admins can.
  const fine = await update(admin, "ap-7", asked.data[0].version, { ...asked.data[0].data, approval: { state: "approved", by: "Boss" } });
  assert.equal(fine.status, 200, JSON.stringify(fine.data));
});

test("where members need approval, a member can't schedule or change a scheduled post", async () => {
  await refuses(rpc(member.token, "set_workspace_rules", { owner: owner.id, workspace: W1, need_approval: true }), "42501");
  await rpc(admin.token, "set_workspace_rules", { owner: owner.id, workspace: W1, need_approval: true });
  const rules = await call(`/rest/v1/workspace_rules?select=members_need_approval&owner_id=eq.${owner.id}`, { token: member.token });
  assert.deepEqual(rules.data, [{ members_need_approval: true }]);
  assert.deepEqual((await call(`/rest/v1/workspace_rules?select=*&owner_id=eq.${owner.id}`, { token: outsider.token })).data, []);

  assert.equal((await insert(member, post("ap-8", { status: "scheduled" }))).data.code, "42501");
  const draft = await made(member, post("ap-8", pending()));
  assert.equal((await update(member, "ap-8", draft.version, { ...draft.data, status: "scheduled" })).data.code, "42501");

  // Approved by the owner, it's scheduled: the member can't change it, but it can go out and go back to drafts.
  await rpc(owner.token, "review_post", { owner: owner.id, post: "ap-8", decision: "approved" });
  let row = await one("ap-8");
  assert.equal(row.data.status, "scheduled");
  assert.equal((await update(member, "ap-8", row.version, { ...row.data, description: "Changed" })).data.code, "42501");
  const posted = await update(member, "ap-8", row.version, { ...row.data, status: "posted", sendFrom: new Date().toISOString() });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));

  await made(owner, post("ap-9", { status: "scheduled" }));
  row = await one("ap-9");
  const back = await update(member, "ap-9", row.version, { ...row.data, status: "draft", ...pending() });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  // The owner and admins schedule as before.
  assert.equal((await insert(admin, post("ap-10", { status: "scheduled" }))).status, 201);

  await rpc(owner.token, "set_workspace_rules", { owner: owner.id, workspace: W1, need_approval: false });
  assert.equal((await insert(member, post("ap-11", { status: "scheduled" }))).status, 201);
});

test("the preview page reads the post's live state, each note's kind, and who may decide", async () => {
  await made(member, post("ap-12", pending()));
  const preview = await share("ap-12");
  await rpc(member.token, "note_approval_request", { preview });
  await rpc(member.token, "note_approval_request", { preview });
  await refuses(rpc(outsider.token, "note_approval_request", { preview }), "42501");

  const seen = await rpc(visitor.token, "get_post_preview", { preview });
  assert.equal(seen.status, "draft");
  assert.equal(seen.approval.state, "pending");
  assert.equal(seen.canReview, true);
  assert.deepEqual(seen.comments.map((comment) => [comment.kind, comment.byOwner]), [["requested", true]]);
  assert.equal((await rpc(member.token, "get_post_preview", { preview })).canReview, false);
  assert.equal((await rpc(admin.token, "get_post_preview", { preview })).canReview, true);

  await rpc(visitor.token, "review_post_preview", { preview, decision: "changes", name: "Client", note: "Shorter" });
  await rpc(member.token, "note_approval_request", { preview });
  const later = await rpc(visitor.token, "get_post_preview", { preview });
  assert.equal(later.approval.state, "changes");
  assert.deepEqual(later.comments.map((comment) => comment.kind), ["requested", "changes", "requested"]);

  // Comments still need words.
  await refuses(rpc(visitor.token, "add_post_preview_comment", { preview, name: "Client", body: " " }), "22023");
});
