// Run as helpers.mjs says. The last test needs Supabase Auth's hook on in the stack's config.toml:
//   [auth.hook.before_user_created]
//   enabled = true
//   uri = "pg-functions://postgres/public/before_user_created"
// and BEFORE_USER_CREATED_HOOK=on when running it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { ANON, URL, address, call, letIn, makeUser, refuses, rpc, saveOwner, setLevel, slice, sql } from "./helpers.mjs";

const W = "default";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const gate = (on) => sql(`update public.invite_gate set invite_only = ${on ? "true" : "false"};`);
// A local database starts open (supabase/seed.sql); the tests close it and restore it after.
const wasOn = sql("select invite_only from public.invite_gate;") === "t";

function account(workspaces = [W]) {
  return {
    revision: randomUUID(),
    workspaces: { active: workspaces[0], list: workspaces.map((id) => ({ id, name: id, color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] })) },
    timeZone: "Europe/Amsterdam",
    notifications: { read: [], cleared: [], seen: {} },
    slices: Object.fromEntries(workspaces.map((id) => [id, slice()])),
  };
}

function post(id) {
  return {
    id,
    title: id,
    description: null,
    day: "2026-11-02",
    start: "09:00",
    allDay: false,
    duration: 30,
    calendarId: "posts",
    createdAt: "2026-10-26T08:00:00.000Z",
    link: null,
    platforms: ["x"],
    recurrence: null,
    recurrenceExceptions: [],
    status: "draft",
    timeZone: "Europe/Amsterdam",
  };
}

const writes = {
  account: (person) => saveOwner(person, account()),
  post: (person, id = `p-${randomUUID().slice(0, 8)}`) =>
    call("/rest/v1/posts", { token: person.token, method: "POST", prefer: "return=representation", body: { owner_id: person.id, id, workspace_id: W, data: post(id) } }),
  postChange: (person, id) =>
    call(`/rest/v1/posts?owner_id=eq.${person.id}&id=eq.${id}`, { token: person.token, method: "PATCH", prefer: "return=representation", body: { data: { ...post(id), title: "Changed" } } }),
  thumbnail: (person, id) =>
    call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: person.token,
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { owner_id: person.id, post_id: id, thumbnail: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
    }),
  chat: (person) =>
    call("/rest/v1/agent_chats", {
      token: person.token,
      method: "POST",
      prefer: "return=representation",
      body: { id: randomUUID(), user_id: person.id, workspace: W, title: "Hello", messages: [] },
    }),
  preview: (person, postId) =>
    call("/rest/v1/post_previews", { token: person.token, method: "POST", prefer: "return=representation", body: { owner_id: person.id, post_id: postId, snapshot: { title: "Preview" } } }),
  avatar: async (person) => {
    const response = await fetch(`${URL}/storage/v1/object/avatars/${person.id}/${randomUUID()}.png`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${person.token}`, "Content-Type": "image/png" },
      body: PNG,
    });
    return { status: response.status, data: await response.text() };
  },
  vote: async (person) => {
    try {
      return { status: 200, data: await rpc(person.token, "toggle_roadmap_vote", { card: "access-gate-test" }) };
    } catch (error) {
      return { status: 403, data: { code: error.code, message: error.message } };
    }
  },
};

const landed = (result, what) => assert.ok(result.status < 300, `${what}: ${result.status} ${JSON.stringify(result.data)}`);
function turnedDown(result, what) {
  assert.ok(result.status >= 400, `${what} went through: ${result.status} ${JSON.stringify(result.data)}`);
  assert.match(JSON.stringify(result.data), /42501|row-level security|let in|Unauthorized|policy/i, `${what}: ${JSON.stringify(result.data)}`);
}

let stranger, fresh, invited, owner, member;
const strangerPost = `stranger-${randomUUID().slice(0, 8)}`;
const theirs = {};

before(async () => {
  gate(true);
  [stranger, fresh, invited, owner, member] = await Promise.all([
    makeUser("stranger", { letIn: false }),
    makeUser("fresh", { letIn: false }),
    makeUser("invited"),
    makeUser("team-owner"),
    makeUser("team-member", { letIn: false }),
  ]);
  gate(false);
  try {
    landed(await writes.account(stranger), "the stranger's account with the gate off");
    landed(await writes.post(stranger, strangerPost), "the stranger's post with the gate off");
    landed(await writes.thumbnail(stranger, strangerPost), "the stranger's thumbnail with the gate off");
    landed(await writes.post(stranger, `${strangerPost}-bare`), "the stranger's post without a thumbnail, with the gate off");
    const chat = await writes.chat(stranger);
    landed(chat, "the stranger's chat with the gate off");
    theirs.chat = chat.data[0].id;
    const preview = await writes.preview(stranger, strangerPost);
    landed(preview, "the stranger's preview with the gate off");
    theirs.preview = preview.data[0].id;
    theirs.comment = await rpc(ANON, "add_post_preview_comment", { preview: theirs.preview, name: "Visitor", body: "Nice" });
    theirs.avatar = `${stranger.id}/face.png`;
    const avatar = await fetch(`${URL}/storage/v1/object/avatars/${theirs.avatar}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${stranger.token}`, "Content-Type": "image/png" },
      body: PNG,
    });
    assert.ok(avatar.ok, await avatar.text());
  } finally {
    gate(true);
  }
});

const stored = (query) => sql(query);

after(() => gate(wasOn));

describe("someone who made an account past the site, without an invite", () => {
  test("isn't let in", async () => {
    assert.equal(await rpc(stranger.token, "has_access"), false);
    assert.equal(await rpc(stranger.token, "let_in"), false);
  });

  test("can't save their account, posts, thumbnails, chats, previews, avatar or a roadmap vote", async () => {
    // Never saved anything, so this is an insert, not an update.
    turnedDown(await writes.account(fresh), "account");
    assert.equal(stored(`select count(*) from public.account_state where user_id = '${fresh.id}';`), "0");
    turnedDown(await writes.thumbnail(stranger, `${strangerPost}-bare`), "a post's first thumbnail");
    turnedDown(await writes.post(stranger), "new post");
    const changed = await writes.postChange(stranger, strangerPost);
    // RLS may turn an update down quietly (no rows) or refuse it outright.
    if (changed.status < 300) assert.deepEqual(changed.data, []);
    else turnedDown(changed, "post change");
    assert.equal((await call(`/rest/v1/posts?select=data&owner_id=eq.${stranger.id}&id=eq.${strangerPost}`)).data[0].data.title, strangerPost);
    turnedDown(await writes.thumbnail(stranger, strangerPost), "thumbnail");
    turnedDown(await writes.chat(stranger), "chat");
    turnedDown(await writes.preview(stranger, strangerPost), "preview");
    turnedDown(await writes.avatar(stranger), "avatar");
    const vote = await writes.vote(stranger);
    assert.equal(vote.data.code, "42501", JSON.stringify(vote.data));
  });

  test("can't change what they saved before", async () => {
    const quietlyOrRefused = (result, what) => {
      if (result.status < 300) assert.deepEqual(result.data ?? [], [], `${what} changed`);
    };
    const before = stored(`select payload::text from public.account_state where user_id = '${stranger.id}';`);
    await writes.account(stranger);
    quietlyOrRefused(
      await call(`/rest/v1/account_state?user_id=eq.${stranger.id}`, { token: stranger.token, method: "PATCH", prefer: "return=representation", body: { payload: account() } }),
      "account",
    );
    assert.equal(stored(`select payload::text from public.account_state where user_id = '${stranger.id}';`), before, "the account changed");

    await writes.thumbnail(stranger, strangerPost);
    quietlyOrRefused(
      await call(`/rest/v1/post_thumbnails?owner_id=eq.${stranger.id}&post_id=eq.${strangerPost}`, {
        token: stranger.token,
        method: "PATCH",
        prefer: "return=representation",
        body: { thumbnail: "data:image/png;base64,iVBORw0KGgo=" },
      }),
      "thumbnail",
    );
    assert.equal(stored(`select thumbnail from public.post_thumbnails where owner_id = '${stranger.id}';`), "data:image/jpeg;base64,/9j/4AAQSkZJRg==");

    quietlyOrRefused(
      await call(`/rest/v1/agent_chats?id=eq.${theirs.chat}`, { token: stranger.token, method: "PATCH", prefer: "return=representation", body: { title: "Changed" } }),
      "chat",
    );
    assert.equal(stored(`select title from public.agent_chats where id = '${theirs.chat}';`), "Hello");

    quietlyOrRefused(
      await call(`/rest/v1/post_previews?id=eq.${theirs.preview}`, { token: stranger.token, method: "PATCH", prefer: "return=representation", body: { snapshot: { title: "Changed" } } }),
      "preview",
    );
    assert.equal(stored(`select snapshot ->> 'title' from public.post_previews where id = '${theirs.preview}';`), "Preview");

    quietlyOrRefused(
      await call(`/rest/v1/post_preview_comments?id=eq.${theirs.comment}`, { token: stranger.token, method: "PATCH", prefer: "return=representation", body: { resolved_at: new Date().toISOString() } }),
      "comment",
    );
    assert.equal(stored(`select resolved_at is null from public.post_preview_comments where id = '${theirs.comment}';`), "t");

    const avatar = await fetch(`${URL}/storage/v1/object/avatars/${theirs.avatar}`, {
      method: "PUT",
      headers: { apikey: ANON, Authorization: `Bearer ${stranger.token}`, "Content-Type": "image/png", "x-upsert": "true" },
      body: Buffer.concat([PNG, Buffer.from("changed")]),
    });
    assert.ok(avatar.status >= 400, `the avatar was replaced: ${avatar.status}`);
    assert.equal(stored(`select (metadata ->> 'size')::int from storage.objects where bucket_id = 'avatars' and name = '${theirs.avatar}';`), String(PNG.length));
  });

  test("can still read and delete what's theirs", async () => {
    const read = await call(`/rest/v1/posts?select=id&owner_id=eq.${stranger.id}&order=id`, { token: stranger.token });
    assert.equal(read.status, 200);
    assert.deepEqual(read.data.map((row) => row.id), [strangerPost, `${strangerPost}-bare`]);
    const removed = await call(`/rest/v1/agent_chats?user_id=eq.${stranger.id}`, { token: stranger.token, method: "DELETE" });
    assert.ok(removed.status < 300, JSON.stringify(removed.data));
  });

  test("can't open the gate, nor call the sign-up hook", async () => {
    const opened = await call("/rest/v1/invite_gate?only_row=eq.true", { token: stranger.token, method: "PATCH", prefer: "return=representation", body: { invite_only: false } });
    assert.ok(opened.status >= 400 || (Array.isArray(opened.data) && opened.data.length === 0), JSON.stringify(opened.data));
    assert.equal(sql("select invite_only from public.invite_gate;"), "t");
    await refuses(rpc(stranger.token, "before_user_created", { event: { user: { email: stranger.email } } }), "42501");
    await refuses(rpc(ANON, "before_user_created", { event: { user: { email: stranger.email } } }), "42501");
    await refuses(rpc(ANON, "let_in"), "42501");
  });

  test("saves like anyone once the app opens", async () => {
    gate(false);
    try {
      landed(await writes.account(stranger), "account");
      landed(await writes.post(stranger), "post");
      landed(await writes.thumbnail(stranger, strangerPost), "thumbnail");
      landed(await writes.chat(stranger), "chat");
      landed(await writes.preview(stranger, `${strangerPost}-again`), "preview");
      landed(await writes.avatar(stranger), "avatar");
      landed(await writes.vote(stranger), "vote");
    } finally {
      gate(true);
    }
  });
});

describe("someone let in from the waitlist", () => {
  test("saves everything", async () => {
    assert.equal(await rpc(invited.token, "let_in"), true);
    landed(await writes.account(invited), "account");
    const id = `invited-${randomUUID().slice(0, 8)}`;
    landed(await writes.post(invited, id), "post");
    const changed = await writes.postChange(invited, id);
    landed(changed, "post change");
    assert.equal(changed.data.length, 1);
    landed(await writes.thumbnail(invited, id), "thumbnail");
    landed(await writes.chat(invited), "chat");
    landed(await writes.preview(invited, id), "preview");
    landed(await writes.avatar(invited), "avatar");
    landed(await writes.vote(invited), "vote");
  });
});

describe("someone let in by a team", () => {
  test("saves while the owner's plan has a team, and not after", async () => {
    await setLevel(owner.id, 3);
    landed(await saveOwner(owner, account()), "owner's account");
    const invite = await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W, address: member.email, role: "member" });
    await rpc(member.token, "accept_workspace_invite", { invite: invite.id });

    const id = `team-${randomUUID().slice(0, 8)}`;
    const made = await call("/rest/v1/posts", { token: member.token, method: "POST", prefer: "return=representation", body: { owner_id: owner.id, id, workspace_id: W, data: post(id) } });
    landed(made, "the member's post in the owner's workspace");
    landed(await writes.account(member), "the member's own account");

    await setLevel(owner.id, 1);
    try {
      assert.equal(await rpc(member.token, "let_in"), false);
      turnedDown(await writes.account(member), "the member's own account, the team gone");
      const after = await call("/rest/v1/posts", { token: member.token, method: "POST", prefer: "return=representation", body: { owner_id: owner.id, id: `${id}-2`, workspace_id: W, data: post(`${id}-2`) } });
      turnedDown(after, "a post, the team gone");
    } finally {
      await setLevel(owner.id, 3);
    }
  });
});

describe("the sign-up hook", () => {
  const hook = (email) => {
    const event = JSON.stringify({ user: email === undefined ? {} : { email } }).replaceAll("'", "''");
    return JSON.parse(sql(`select public.before_user_created('${event}'::jsonb);`));
  };
  const refusal = (answer) => answer?.error?.http_code === 403 && /invite-only/.test(answer.error.message);

  test("is Supabase Auth's to call, and nobody else's", () => {
    assert.equal(
      sql(`select string_agg(r || '=' || has_function_privilege(r, 'public.before_user_created(jsonb)', 'execute'), ',' order by r) from unnest(array['anon', 'authenticated', 'supabase_auth_admin']) r;`),
      "anon=false,authenticated=false,supabase_auth_admin=true",
    );
  });

  test("makes an account only for an address that was let in", async () => {
    assert.deepEqual(hook(invited.email), {});
    assert.deepEqual(hook(`  ${invited.email.toUpperCase()} `), {}, "case and spaces don't matter");
    assert.ok(refusal(hook(address("nobody"))));
    assert.ok(refusal(hook("")));
    assert.ok(refusal(hook(undefined)));

    const waiting = address("waiting");
    await call("/rest/v1/waitlist", { method: "POST", body: { email: waiting } });
    assert.ok(refusal(hook(waiting)));
    await letIn(waiting);
    assert.deepEqual(hook(waiting), {});
  });

  test("lets in someone invited to a workspace whose plan has a team", async () => {
    const invitee = address("invitee");
    await rpc(owner.token, "invite_workspace_member", { owner: owner.id, workspace: W, address: invitee, role: "member" });
    assert.deepEqual(hook(invitee), {});
    await setLevel(owner.id, 1);
    try {
      assert.ok(refusal(hook(invitee)));
    } finally {
      await setLevel(owner.id, 3);
    }
  });

  test("makes any account once the app opens", () => {
    gate(false);
    try {
      assert.deepEqual(hook(address("anyone")), {});
    } finally {
      gate(true);
    }
  });

  test("turns down a sign-up through Supabase Auth itself", { skip: process.env.BEFORE_USER_CREATED_HOOK !== "on" && "the hook isn't on in this stack" }, async () => {
    const signUp = (email) =>
      fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "access-gate-password" }) });
    const outsider = address("signs-up");
    const refused = await signUp(outsider);
    assert.equal(refused.status, 403, await refused.text());
    assert.equal(sql(`select count(*) from auth.users where email = '${outsider}';`), "0");

    const welcome = address("welcome");
    await letIn(welcome);
    const made = await signUp(welcome);
    assert.ok(made.status < 300, await made.text());
    assert.equal(sql(`select count(*) from auth.users where email = '${welcome}';`), "1");

    const otp = await fetch(`${URL}/auth/v1/otp`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: address("link"), create_user: true }) });
    assert.ok(otp.status >= 400, `a sign-in link made an account: ${otp.status}`);
    assert.equal(sql(`select count(*) from auth.users where email = '${address("link")}';`), "0");
  });
});
