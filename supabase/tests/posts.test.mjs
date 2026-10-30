// Posts in their own table (migrations/20261026090000_posts.sql) against a
// real Supabase: what an owner, an admin, a member, an outsider and an
// outside AI agent's token can read and write, the versioned writes, the
// deletion markers, thumbnails, Realtime, the publisher's functions, and what
// the shared-workspace functions do with posts now. See helpers.mjs to run it.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";

import { ANON, SERVICE, URL, call, makeUser, refuses, rpc, saveOwner, setLevel, slice, sql } from "./helpers.mjs";

const W1 = "default";
const W2 = randomUUID();
const W3 = randomUUID();

let owner, admin, member, outsider;

/** A post as the calendar keeps it. */
function post(id, overrides = {}) {
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
    ...overrides,
  };
}

const insert = (person, ownerId, workspace, data, { id = data.id } = {}) =>
  call("/rest/v1/posts", { token: person.token, method: "POST", prefer: "return=representation", body: { owner_id: ownerId, id, workspace_id: workspace, data } });

/** A write over the version read, as browsers make it. An empty answer means the post moved on. */
const update = (person, ownerId, id, version, values) =>
  call(`/rest/v1/posts?owner_id=eq.${ownerId}&id=eq.${id}&version=eq.${version}`, { token: person.token, method: "PATCH", prefer: "return=representation", body: values });

const read = async (person, filter = "") => (await call(`/rest/v1/posts?select=*&owner_id=eq.${owner.id}${filter}&order=id`, { token: person.token })).data;
const one = async (ownerId, id) => (await call(`/rest/v1/posts?select=*&owner_id=eq.${ownerId}&id=eq.${id}`)).data[0];
const schedule = async (ownerId, id) => (await call(`/rest/v1/post_schedule?select=*&owner_id=eq.${ownerId}&post_id=eq.${id}`)).data[0];

before(async () => {
  [owner, admin, member, outsider] = await Promise.all(["owner", "admin", "member", "outsider"].map(makeUser));
  await setLevel(owner.id, 3);
  const saved = await saveOwner(owner, {
    revision: "r1",
    workspaces: {
      active: W1,
      list: [
        { id: W1, name: "Shared", color: "sky", createdAt: "2026-10-01T00:00:00.000Z", members: [] },
        { id: W2, name: "Private", color: "#E07A5F", createdAt: "2026-10-02T00:00:00.000Z", members: [] },
        { id: W3, name: "Going", color: "#81B29A", createdAt: "2026-10-03T00:00:00.000Z", members: [] },
      ],
    },
    timeZone: "Europe/Amsterdam",
    notifications: { read: [], cleared: [], seen: {} },
    slices: {
      [W1]: slice({ connections: [{ id: "conn-1", platform: "x", handle: "brand" }] }),
      [W2]: slice({
        connections: [{ id: "conn-2", platform: "youtube", handle: "other" }],
        library: [{ id: "lib-private", name: "secret.mp4", kind: "video", cloud: { key: "media/x/lib-private" } }],
      }),
      [W3]: slice(),
    },
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

describe("an owner's posts", () => {
  test("a new post starts at version 1, and the publisher is due to look at it", async () => {
    const made = await insert(owner, owner.id, W1, post("own-1"));
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.equal(made.data[0].version, 1);
    assert.equal(made.data[0].status, "draft");
    assert.deepEqual(made.data[0].file_ids, ["own-1"]);
    const due = await schedule(owner.id, "own-1");
    assert.ok(due.next_run_at && Date.parse(due.next_run_at) <= Date.now() + 1000);
  });

  test("a write over the version read lands and raises it; one over an older version changes nothing", async () => {
    const first = await update(owner, owner.id, "own-1", 1, { data: post("own-1", { title: "Changed" }) });
    assert.equal(first.status, 200);
    assert.equal(first.data[0].version, 2);
    assert.equal(first.data[0].data.title, "Changed");
    const stale = await update(owner, owner.id, "own-1", 1, { data: post("own-1", { title: "Lost" }) });
    assert.deepEqual(stale.data, []);
    assert.equal((await one(owner.id, "own-1")).data.title, "Changed");
  });

  test("writing the same post again changes neither its version nor its time", async () => {
    const before = await one(owner.id, "own-1");
    const same = await update(owner, owner.id, "own-1", before.version, { data: before.data });
    assert.equal(same.data[0].version, before.version);
    assert.equal(same.data[0].updated_at, before.updated_at);
  });

  test("a browser can't set the database's columns, move a post or delete it outright", async () => {
    const row = await one(owner.id, "own-1");
    for (const values of [{ version: 99 }, { updated_at: "2020-01-01T00:00:00Z" }, { thumbnail_at: "2020-01-01T00:00:00Z" }, { workspace_id: W2 }, { id: "other" }, { owner_id: member.id }]) {
      const tried = await update(owner, owner.id, "own-1", row.version, values);
      assert.ok(tried.status === 401 || tried.status === 403, `${JSON.stringify(values)} gave ${tried.status}`);
      assert.equal(tried.data.code, "42501");
    }
    const removed = await call(`/rest/v1/posts?owner_id=eq.${owner.id}&id=eq.own-1`, { token: owner.token, method: "DELETE" });
    assert.ok(removed.status === 401 || removed.status === 403);
    const kept = await one(owner.id, "own-1");
    assert.equal(kept.version, row.version);
    assert.equal(kept.workspace_id, W1);
    const schedules = await call(`/rest/v1/post_schedule?select=*`, { token: owner.token });
    assert.ok(schedules.status >= 400 || schedules.data.length === 0);
  });

  test("a post must be an object naming its own id and a known status, and not too large", async () => {
    for (const [id, data] of [
      ["bad-id", post("other")],
      ["bad-status", post("bad-status", { status: "sent" })],
      ["too-big", post("too-big", { description: "x".repeat(300_000) })],
    ]) {
      const tried = await insert(owner, owner.id, W1, data, { id });
      assert.equal(tried.status, 400, `${id}: ${JSON.stringify(tried.data)}`);
      assert.equal(tried.data.code, "23514");
    }
    const notObject = await call("/rest/v1/posts", { token: owner.token, method: "POST", body: { owner_id: owner.id, id: "list", workspace_id: W1, data: ["list"] } });
    assert.equal(notObject.data.code, "23514");
    const noData = await call("/rest/v1/posts", { token: owner.token, method: "POST", body: { owner_id: owner.id, id: "empty", workspace_id: W1 } });
    assert.equal(noData.data.code, "23514");
    const badWorkspace = await insert(owner, owner.id, "bad workspace", post("in-bad"));
    assert.equal(badWorkspace.data.code, "23514");
  });

  test("a deletion's time is the database's, whatever the browser's clock says", async () => {
    await insert(owner, owner.id, W1, post("clock"));
    const row = await one(owner.id, "clock");
    const deleted = await update(owner, owner.id, "clock", row.version, { deleted_at: "2001-01-01T00:00:00Z" });
    assert.ok(Math.abs(Date.parse(deleted.data[0].deleted_at) - Date.now()) < 60_000, deleted.data[0].deleted_at);
    // Kept as it was by a later write that still names it deleted.
    const again = await update(owner, owner.id, "clock", deleted.data[0].version, { deleted_at: "2100-01-01T00:00:00Z" });
    assert.equal(again.data[0].deleted_at, deleted.data[0].deleted_at);
  });

  test("an id is one post: the same id can't be made again, in any workspace", async () => {
    const again = await insert(owner, owner.id, W2, post("own-1"));
    assert.equal(again.status, 409);
    assert.equal(again.data.code, "23505");
  });

  test("a deleted post keeps only a marker, which other devices read, and can be brought back by an edit", async () => {
    await insert(owner, owner.id, W1, post("own-gone", { files: ["own-gone_a"] }));
    const thumb = await call("/rest/v1/post_thumbnails", { token: owner.token, method: "POST", body: { owner_id: owner.id, post_id: "own-gone", thumbnail: "data:image/jpeg;base64,AAAA" } });
    assert.equal(thumb.status, 201, JSON.stringify(thumb.data));
    const row = await one(owner.id, "own-gone");
    const deleted = await update(owner, owner.id, "own-gone", row.version, { deleted_at: new Date().toISOString(), data: post("own-gone", { title: "kept?" }) });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data[0].data, null);
    assert.equal(deleted.data[0].version, row.version + 1);
    assert.deepEqual(deleted.data[0].file_ids, ["own-gone"]);
    assert.deepEqual((await call(`/rest/v1/post_thumbnails?owner_id=eq.${owner.id}&post_id=eq.own-gone`)).data, []);
    const changes = await read(owner, `&updated_at=gte.${encodeURIComponent(row.updated_at)}`);
    assert.ok(changes.some((change) => change.id === "own-gone" && change.deleted_at));
    const back = await update(owner, owner.id, "own-gone", row.version + 1, { deleted_at: null, data: post("own-gone", { title: "Back" }) });
    assert.equal(back.data[0].data.title, "Back");
    assert.equal(back.data[0].deleted_at, null);
  });
});

describe("posts in a shared workspace", () => {
  before(async () => {
    const made = await insert(owner, owner.id, W2, post("private-1", { files: ["private-1_video"], ownFiles: { youtube: ["private-1_cut"] }, thread: [{ id: "t1", text: "More", delay: 0, files: ["private-1_t"] }] }));
    assert.equal(made.status, 201, JSON.stringify(made.data));
    assert.deepEqual(made.data[0].file_ids, ["private-1", "private-1_cut", "private-1_t", "private-1_video"]);
  });

  test("a member reads their workspace's posts and nothing of the owner's other workspaces, not even ids", async () => {
    const seen = await read(member);
    assert.ok(seen.length > 0);
    assert.ok(seen.every((row) => row.workspace_id === W1));
    assert.ok(!JSON.stringify(seen).includes("private-1"));
    assert.deepEqual(await read(member, "&id=eq.private-1"), []);
  });

  test("a member and an admin make and change posts in their workspace", async () => {
    for (const person of [member, admin]) {
      const id = `by-${person === member ? "member" : "admin"}`;
      const made = await insert(person, owner.id, W1, post(id, { status: "scheduled", files: [`${id}_a`] }));
      assert.equal(made.status, 201, JSON.stringify(made.data));
      const changed = await update(person, owner.id, id, 1, { data: post(id, { status: "scheduled", title: "Edited" }) });
      assert.equal(changed.data[0].version, 2);
    }
    assert.equal((await one(owner.id, "by-member")).data.title, "Edited");
  });

  test("a member can't make a post in another workspace of the owner's, or the outsider's own", async () => {
    const elsewhere = await insert(member, owner.id, W2, post("member-in-w2"));
    assert.equal(elsewhere.status, 403);
    assert.equal(elsewhere.data.code, "42501");
    const asOutsider = await insert(member, outsider.id, W1, post("member-for-outsider"));
    assert.equal(asOutsider.status, 403);
  });

  test("a member can't change, delete or take over a post of another workspace", async () => {
    const changed = await update(member, owner.id, "private-1", 1, { data: post("private-1", { title: "Taken" }) });
    assert.deepEqual(changed.data, []);
    const deleted = await update(member, owner.id, "private-1", 1, { deleted_at: new Date().toISOString() });
    assert.deepEqual(deleted.data, []);
    const taken = await insert(member, owner.id, W1, post("private-1"));
    assert.equal(taken.status, 409);
    assert.equal((await one(owner.id, "private-1")).data.title, "private-1");
  });

  test("nobody's post may name a file of another workspace: its posts' files, follow-up files or library", async () => {
    for (const files of [["private-1_video"], ["private-1"], ["lib-private"]]) {
      const tried = await insert(member, owner.id, W1, post(`steal-${files[0]}`, { files }));
      assert.equal(tried.status, 403, `${files[0]}: ${JSON.stringify(tried.data)}`);
      assert.equal(tried.data.code, "42501");
    }
    const own = await insert(owner, owner.id, W1, post("own-steal", { ownFiles: { x: ["private-1_cut"] } }));
    assert.equal(own.data.code, "42501", "the owner is held to it too");
    const thread = await insert(member, owner.id, W1, post("thread-steal", { thread: [{ id: "t", text: "", delay: 0, files: ["private-1_t"] }] }));
    assert.equal(thread.data.code, "42501");
    const media = await insert(member, owner.id, W1, post("media-steal", { media: [{ id: "private-1_video", name: "v.mp4", type: "video/mp4", lastModified: 0 }] }));
    assert.equal(media.data.code, "42501");
    const row = await one(owner.id, "by-member");
    const later = await update(member, owner.id, "by-member", row.version, { data: post("by-member", { files: ["private-1_video"] }) });
    assert.equal(later.data.code, "42501");
  });

  test("an outsider reads and writes nothing", async () => {
    assert.deepEqual(await read(outsider), []);
    const made = await insert(outsider, owner.id, W1, post("outsider"));
    assert.equal(made.status, 403);
    const row = await one(owner.id, "own-1");
    assert.deepEqual((await update(outsider, owner.id, "own-1", row.version, { data: post("own-1", { title: "Outsider" }) })).data, []);
  });

  test("a team paused by the owner's plan reaches nothing until it's back", async () => {
    await setLevel(owner.id, 2);
    try {
      assert.deepEqual(await read(member), []);
      assert.equal((await insert(member, owner.id, W1, post("while-paused"))).status, 403);
    } finally {
      await setLevel(owner.id, 3);
    }
    assert.ok((await read(member)).length > 0);
  });

  test("an outside AI agent's token reaches no posts or thumbnails, through the API or the rules themselves", async () => {
    const claims = (person) => JSON.stringify({ sub: person.id, role: "authenticated", client_id: "some-agent" });
    const count = (table, person) =>
      sql(`begin; set local role authenticated; set local request.jwt.claims = '${claims(person)}'; select count(*) from public.${table}; rollback;`).split("\n").filter(Boolean).at(-1);
    assert.equal(count("posts", owner), "0");
    assert.equal(count("post_thumbnails", owner), "0");
    assert.equal(count("post_replies", owner), "0");
    const plain = (person) => JSON.stringify({ sub: person.id, role: "authenticated" });
    assert.notEqual(sql(`begin; set local role authenticated; set local request.jwt.claims = '${plain(owner)}'; select count(*) from public.posts; rollback;`).split("\n").filter(Boolean).at(-1), "0");
  });
});

describe("thumbnails", () => {
  test("a thumbnail is saved apart, its post learns when it changed, and its version stays", async () => {
    const before = await one(owner.id, "own-1");
    const saved = await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: owner.token,
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { owner_id: owner.id, post_id: "own-1", thumbnail: "data:image/jpeg;base64,BBBB" },
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    const after = await one(owner.id, "own-1");
    assert.equal(after.version, before.version);
    assert.ok(Date.parse(after.updated_at) > Date.parse(before.updated_at));
    assert.equal(after.thumbnail_at, saved.data[0].updated_at);
    const again = await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: owner.token,
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { owner_id: owner.id, post_id: "own-1", thumbnail: "data:image/jpeg;base64,CCCC" },
    });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.ok(Date.parse((await one(owner.id, "own-1")).thumbnail_at) > Date.parse(after.thumbnail_at));
  });

  test("a thumbnail's change and its post's are one moment, so the tab that saved it knows its own change", async () => {
    const saved = await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: owner.token,
      method: "POST",
      prefer: "resolution=merge-duplicates,return=representation",
      body: { owner_id: owner.id, post_id: "own-1", thumbnail: "data:image/jpeg;base64,SAME" },
    });
    const row = await one(owner.id, "own-1");
    // To the microsecond: two readings of the clock in one statement can share a millisecond.
    assert.equal(row.updated_at, saved.data[0].updated_at);
    assert.equal(row.thumbnail_at, saved.data[0].updated_at);
  });

  test("deleting a post with a thumbnail is one change, as the delete answered it", async () => {
    await insert(owner, owner.id, W1, post("thumb-gone"));
    await call("/rest/v1/post_thumbnails", { token: owner.token, method: "POST", body: { owner_id: owner.id, post_id: "thumb-gone", thumbnail: "data:image/jpeg;base64,GONE" } });
    const before = await one(owner.id, "thumb-gone");
    const deleted = await update(owner, owner.id, "thumb-gone", before.version, { deleted_at: new Date().toISOString() });
    const after = await one(owner.id, "thumb-gone");
    assert.equal(after.updated_at, deleted.data[0].updated_at);
    assert.equal(after.version, deleted.data[0].version);
  });

  test("a deleted post takes no thumbnail, said as its post being gone", async () => {
    await insert(owner, owner.id, W1, post("no-picture"));
    const row = await one(owner.id, "no-picture");
    await update(owner, owner.id, "no-picture", row.version, { deleted_at: new Date().toISOString() });
    const tried = await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: owner.token,
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { owner_id: owner.id, post_id: "no-picture", thumbnail: "data:image/jpeg;base64,LATE" },
    });
    assert.ok(tried.status >= 400, JSON.stringify(tried));
    assert.ok(["23503", "42501"].includes(tried.data.code), tried.data.code);
    assert.deepEqual((await call(`/rest/v1/post_thumbnails?owner_id=eq.${owner.id}&post_id=eq.no-picture`)).data, []);
  });

  test("only someone who reaches the post reaches its thumbnail, and only a picture is kept", async () => {
    await call("/rest/v1/post_thumbnails", { method: "POST", body: { owner_id: owner.id, post_id: "private-1", thumbnail: "data:image/jpeg;base64,PRIV" } });
    const seen = await call(`/rest/v1/post_thumbnails?select=post_id&owner_id=eq.${owner.id}`, { token: member.token });
    assert.ok(seen.data.some((row) => row.post_id === "own-1"));
    assert.ok(!seen.data.some((row) => row.post_id === "private-1"));
    assert.deepEqual((await call(`/rest/v1/post_thumbnails?select=post_id&owner_id=eq.${owner.id}`, { token: outsider.token })).data, []);
    const forPrivate = await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: member.token,
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { owner_id: owner.id, post_id: "private-1", thumbnail: "data:image/jpeg;base64,MINE" },
    });
    assert.equal(forPrivate.status, 403);
    const notPicture = await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", {
      token: owner.token,
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { owner_id: owner.id, post_id: "own-1", thumbnail: "javascript:alert(1)" },
    });
    assert.equal(notPicture.data.code, "23514");
  });
});

describe("live changes", () => {
  const clients = [];
  after(async () => {
    for (const client of clients) await client.removeAllChannels();
  });

  /** What `person` hears of the owner's posts. */
  async function listen(person) {
    const client = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${person.token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    await client.realtime.setAuth(person.token);
    const heard = [];
    await new Promise((resolve, reject) => {
      client
        .channel(`posts-${person.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `owner_id=eq.${owner.id}` }, (change) => heard.push(change.new))
        .subscribe((status, error) => (status === "SUBSCRIBED" ? resolve() : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? reject(error ?? new Error(status)) : null));
    });
    return heard;
  }

  test("a change reaches the tabs that may see the post, and no others", async () => {
    const [toOwner, toMember, toOutsider] = await Promise.all([listen(owner), listen(member), listen(outsider)]);
    // Realtime starts passing changes on a moment after it says it's subscribed, longer just after the database was reset:
    // a probe in the shared workspace is written until both the owner and the member hear one.
    for (let probe = 0; probe < 60 && !(toOwner.some((row) => row.id?.startsWith("probe-")) && toMember.some((row) => row.id?.startsWith("probe-"))); probe++) {
      await insert(owner, owner.id, W1, post(`probe-${probe}`));
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(toMember.some((row) => row.id?.startsWith("probe-")), "Realtime never started passing changes on");
    await insert(owner, owner.id, W1, post("live-shared"));
    await insert(owner, owner.id, W2, post("live-private"));
    for (let waited = 0; waited < 10_000 && !(toOwner.length >= 2 && toMember.length >= 1); waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // Only what was written once all three listened: Realtime may still pass on a write made just before.
    const live = (heard) => heard.filter((row) => row.id?.startsWith("live-")).map((row) => row.id);
    assert.deepEqual(live(toOwner).sort(), ["live-private", "live-shared"]);
    assert.deepEqual(live(toMember), ["live-shared"]);
    assert.ok(toMember.every((row) => row.workspace_id === W1));
    assert.deepEqual(toOutsider, []);
    assert.equal(toMember.find((row) => row.id === "live-shared").data.title, "live-shared");
  });
});

describe("the publisher", () => {
  test("only the service may call the publisher's functions", async () => {
    for (const [name, args] of [
      ["publisher_due", { before: new Date().toISOString() }],
      ["publisher_next_due", {}],
      ["publisher_schedule", { items: [] }],
      ["publisher_mark_posted", { owner: owner.id, post: "own-1" }],
      ["publisher_prune_deleted", { before: new Date().toISOString() }],
      ["publisher_post", { owner: owner.id, post: "own-1" }],
      ["publisher_posts_after", {}],
    ]) {
      await refuses(rpc(owner.token, name, args), "42501");
    }
    await refuses(rpc(member.token, "team_foreign_ids", { owner: owner.id, workspace: W1 }), "42501");
  });

  test("a changed post is due a look with its workspace's accounts and the account's zone; a deleted one too", async () => {
    const due = await rpc(SERVICE, "publisher_due", { before: new Date(Date.now() + 1000).toISOString(), size: 1000 });
    const mine = due.filter((row) => row.user_id === owner.id);
    const shared = mine.find((row) => row.post_id === "own-1");
    assert.equal(shared.workspace_id, W1);
    assert.equal(shared.time_zone, "Europe/Amsterdam");
    assert.deepEqual(shared.connections, [{ id: "conn-1", platform: "x" }]);
    assert.equal(shared.post.id, "own-1");
    assert.equal(typeof shared.version, "number");
    const sorted = [...due].sort((a, b) => Date.parse(a.next_run_at) - Date.parse(b.next_run_at));
    assert.deepEqual(due.map((row) => row.next_run_at), sorted.map((row) => row.next_run_at));

    const row = await one(owner.id, "live-shared");
    const deleted = await update(owner, owner.id, "live-shared", row.version, { deleted_at: new Date().toISOString() });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(deleted.data.length, 1, JSON.stringify(deleted.data));
    const again = await rpc(SERVICE, "publisher_due", { before: new Date(Date.now() + 1000).toISOString(), size: 1000 });
    const gone = again.find((item) => item.user_id === owner.id && item.post_id === "live-shared");
    assert.equal(gone.post, null);
  });

  test("the publisher keeps its next look only for a post unchanged since it read it", async () => {
    const row = await one(owner.id, "own-1");
    const later = "2030-01-01T09:00:00.000Z";
    const kept = await rpc(SERVICE, "publisher_schedule", {
      items: [
        { user_id: owner.id, post_id: "own-1", version: row.version, next_run_at: later, planned_through: "2026-10-26T00:00:00.000Z" },
        { user_id: owner.id, post_id: "private-1", version: 999, next_run_at: later, planned_through: null },
      ],
    });
    assert.equal(kept, 1);
    const scheduled = await schedule(owner.id, "own-1");
    assert.equal(Date.parse(scheduled.next_run_at), Date.parse(later));
    assert.equal(Date.parse(scheduled.planned_through), Date.parse("2026-10-26T00:00:00.000Z"));
    assert.notEqual(Date.parse((await schedule(owner.id, "private-1")).next_run_at), Date.parse(later));
    // A browser's change makes it due a look again, at once.
    await update(owner, owner.id, "own-1", row.version, { data: post("own-1", { title: "Again" }) });
    assert.ok(Date.parse((await schedule(owner.id, "own-1")).next_run_at) <= Date.now() + 1000);
    // Its thumbnail alone doesn't.
    await rpc(SERVICE, "publisher_schedule", { items: [{ user_id: owner.id, post_id: "own-1", version: row.version + 1, next_run_at: later, planned_through: null }] });
    await call("/rest/v1/post_thumbnails?on_conflict=owner_id,post_id", { token: owner.token, method: "POST", prefer: "resolution=merge-duplicates", body: { owner_id: owner.id, post_id: "own-1", thumbnail: "data:image/jpeg;base64,DDDD" } });
    assert.equal(Date.parse((await schedule(owner.id, "own-1")).next_run_at), Date.parse(later));
    const soonest = await rpc(SERVICE, "publisher_next_due");
    assert.ok(Date.parse(soonest) <= Date.now() + 1000);
  });

  test("a one-off post is marked posted by the publisher, a draft sent with Post now too; a series isn't", async () => {
    await insert(owner, owner.id, W1, post("to-post", { status: "scheduled" }));
    await insert(owner, owner.id, W1, post("series", { status: "scheduled", recurrence: "every:1:day" }));
    assert.equal(await rpc(SERVICE, "publisher_mark_posted", { owner: owner.id, post: "to-post" }), true);
    const marked = await one(owner.id, "to-post");
    assert.equal(marked.data.status, "posted");
    assert.equal(marked.status, "posted");
    assert.equal(marked.version, 2);
    assert.equal(await rpc(SERVICE, "publisher_mark_posted", { owner: owner.id, post: "to-post" }), false);
    assert.equal(await rpc(SERVICE, "publisher_mark_posted", { owner: owner.id, post: "series" }), false);
    assert.equal(await rpc(SERVICE, "publisher_mark_posted", { owner: owner.id, post: "own-1" }), true);
    assert.equal((await one(owner.id, "own-1")).data.status, "posted");
  });

  test("one post by its workspace, and every scheduled one in pages", async () => {
    const [found] = await rpc(SERVICE, "publisher_post", { owner: owner.id, post: "private-1" });
    assert.equal(found.workspace_id, W2);
    assert.deepEqual(found.connections, [{ id: "conn-2", platform: "youtube" }]);
    assert.deepEqual(await rpc(SERVICE, "publisher_post", { owner: owner.id, post: "private-1", workspace: W1 }), []);
    assert.deepEqual(await rpc(SERVICE, "publisher_post", { owner: owner.id, post: "live-shared" }), [], "a deleted post isn't sent");
    await insert(owner, owner.id, W2, post("paused", { status: "scheduled", paused: true }));
    await insert(owner, owner.id, W2, post("no-network", { status: "scheduled", platforms: ["pinterest"] }));
    const pages = [];
    let after = {};
    for (;;) {
      const page = await rpc(SERVICE, "publisher_posts_after", { ...after, size: 1 });
      pages.push(...page.filter((row) => row.user_id === owner.id));
      if (page.length < 1) break;
      const last = page.at(-1);
      after = { after_user: last.user_id, after_workspace: last.workspace_id, after_post: last.post.id };
    }
    assert.deepEqual(pages.map((row) => row.post.id).sort(), ["by-admin", "by-member", "series"]);
    const whole = (await rpc(SERVICE, "publisher_posts")).filter((row) => row.user_id === owner.id);
    assert.deepEqual(whole.map((row) => row.post.id).sort(), ["by-admin", "by-member", "series"]);
    // With each its version and next look, for the hourly look to put right.
    const series = whole.find((row) => row.post.id === "series");
    assert.equal(series.version, (await one(owner.id, "series")).version);
    assert.equal(Date.parse(series.next_run_at), Date.parse((await schedule(owner.id, "series")).next_run_at));
    // A repair that leaves out how far runs were looked through keeps it.
    await rpc(SERVICE, "publisher_schedule", { items: [{ user_id: owner.id, post_id: "series", version: series.version, next_run_at: "2030-01-01T00:00:00Z", planned_through: "2026-10-20T00:00:00Z" }] });
    await rpc(SERVICE, "publisher_schedule", { items: [{ user_id: owner.id, post_id: "series", version: series.version, next_run_at: "2030-01-02T00:00:00Z", planned_through: null }] });
    assert.equal(Date.parse((await schedule(owner.id, "series")).planned_through), Date.parse("2026-10-20T00:00:00Z"));
  });

  test("deletion markers past their time go, with nothing else", async () => {
    // Backdated past the triggers, which keep a deletion's time as the database first gave it.
    sql(`set session_replication_role = replica; update public.posts set deleted_at = now() - interval '100 days' where owner_id = '${owner.id}' and id = 'live-shared'; set session_replication_role = origin;`);
    const pruned = await rpc(SERVICE, "publisher_prune_deleted", { before: new Date(Date.now() - 90 * 86_400_000).toISOString() });
    assert.ok(pruned >= 1);
    assert.equal(await one(owner.id, "live-shared"), undefined);
    assert.ok(await one(owner.id, "own-1"));
  });
});

describe("shared workspaces' other functions", () => {
  test("the storage signer lets a member reach their workspace's files only", async () => {
    const allowed = (ids) => rpc(member.token, "team_files_allowed", { owner: owner.id, workspace: W1, ids });
    assert.equal(await allowed(["by-member_a", "by-member_a-poster", "new-upload"]), true);
    for (const ids of [["private-1_video"], ["private-1_cut-poster"], ["private-1_t"], ["lib-private"], ["private-1"]]) {
      assert.equal(await allowed(ids), false, ids[0]);
    }
    assert.equal(await rpc(outsider.token, "team_files_allowed", { owner: owner.id, workspace: W1, ids: ["by-member_a"] }), false);
  });

  test("a member shares previews of their workspace's posts, never another workspace's", async () => {
    const share = (postId) =>
      call("/rest/v1/post_previews", { token: member.token, method: "POST", body: { owner_id: owner.id, post_id: postId, snapshot: { workspaceId: W1, title: "Look" } } });
    assert.equal((await share("by-member")).status, 201);
    const stolen = await share("private-1");
    assert.equal(stolen.status, 403, JSON.stringify(stolen.data));
    assert.equal(await rpc(outsider.token, "team_post_elsewhere", { owner: owner.id, workspace: W1, post: "anything" }), true);
  });

  test("a member's save of the workspace's lists carries no posts", async () => {
    const shared = await rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 });
    assert.equal(shared.slice.events, undefined);
    const saved = await rpc(member.token, "save_team_workspace", {
      owner: owner.id,
      workspace: W1,
      slice: { ...shared.slice, events: [post("smuggled")], media: [{ id: "x" }], library: [{ id: "lib-private" }, { id: "lib-own" }] },
      base: shared.revision,
    });
    assert.equal(saved.same, false);
    const stored = await rpc(member.token, "team_workspace", { owner: owner.id, workspace: W1 });
    assert.equal(stored.slice.events, undefined);
    assert.equal(stored.slice.media, undefined);
    assert.deepEqual(stored.slice.library.map((item) => item.id), ["lib-own"]);
  });

  test("deleting a workspace deletes its posts, but only once it's gone from the account", async () => {
    await insert(owner, owner.id, W3, post("in-w3"));
    await rpc(owner.token, "forget_workspace_team", { workspace: W3 });
    assert.ok(await one(owner.id, "in-w3"), "still in the account, so kept");
    const { data } = await call(`/rest/v1/account_state?select=payload&user_id=eq.${owner.id}`);
    const payload = data[0].payload;
    delete payload.slices[W3];
    payload.workspaces.list = payload.workspaces.list.filter((item) => item.id !== W3);
    const saved = await saveOwner(owner, { ...payload, revision: randomUUID() }, payload.revision);
    assert.ok(saved.status < 300, JSON.stringify(saved.data));
    await rpc(owner.token, "forget_workspace_team", { workspace: W3 });
    assert.equal(await one(owner.id, "in-w3"), undefined);
  });
});

describe("the account record", () => {
  test("it no longer takes posts, and has a size limit", async () => {
    const { data } = await call(`/rest/v1/account_state?select=payload&user_id=eq.${owner.id}`);
    const payload = data[0].payload;
    const withPosts = structuredClone(payload);
    withPosts.slices[W1].events = [post("old-style")];
    const refused = await saveOwner(owner, { ...withPosts, revision: randomUUID() }, payload.revision);
    assert.equal(refused.status, 400);
    assert.equal(refused.data.code, "23514");
    const huge = await saveOwner(owner, { ...payload, revision: randomUUID(), junk: randomUUID().repeat(80_000) }, payload.revision);
    assert.equal(huge.data.code, "23514");
  });
});

describe("copying posts out of the account record", () => {
  test("every post is copied with its fields, file details and thumbnail, without its delivery state", async () => {
    const somebody = await makeUser("copied");
    const events = [
      post("c-1", { status: "posted", files: ["c-1_a"], thumbnail: "data:image/jpeg;base64,T1", deliveries: { x: { state: "sent", attempts: 1, at: "2026-10-01T00:00:00Z" } } }),
      post("c-2", { status: "scheduled", ownFiles: { youtube: ["c-2_cut"] } }),
      { id: "bad id", status: "draft" },
      post("c-3", { status: "unknown" }),
    ];
    const media = [
      { id: "c-1_a", name: "a.mp4", type: "video/mp4", lastModified: 1 },
      { id: "c-2_cut", name: "cut.mp4", type: "video/mp4", lastModified: 2 },
      { id: "orphan", name: "o.mp4", type: "video/mp4", lastModified: 3 },
    ];
    const payload = JSON.stringify({ revision: "r", workspaces: { active: "default", list: [] }, slices: { default: slice({ events, media }) } }).replaceAll("'", "''");
    const copy = (await import("node:fs")).readFileSync(new globalThis.URL("../migrations/20261026090100_posts_copy.sql", import.meta.url), "utf8");
    const result = sql(`begin;
      alter table public.account_state drop constraint account_state_without_posts;
      delete from public.account_state where user_id <> '${somebody.id}';
      insert into public.account_state (user_id, payload) values ('${somebody.id}', '${payload}'::jsonb);
      ${copy}
      select json_agg(json_build_object('id', p.id, 'data', p.data, 'thumb', t.thumbnail) order by p.id) from public.posts p left join public.post_thumbnails t on t.owner_id = p.owner_id and t.post_id = p.id where p.owner_id = '${somebody.id}';
      rollback;`);
    const copied = JSON.parse(result.split("\n").filter(Boolean).at(-1));
    assert.deepEqual(copied.map((row) => row.id), ["c-1", "c-2"]);
    const [first, second] = copied;
    assert.equal(first.thumb, "data:image/jpeg;base64,T1");
    assert.equal(first.data.thumbnail, undefined);
    assert.equal(first.data.deliveries, undefined);
    assert.deepEqual(first.data.media, [media[0]]);
    assert.deepEqual(second.data.media, [media[1]]);
    assert.equal(second.thumb, null);
    const { thumbnail: _t, deliveries: _d, ...rest } = events[0];
    assert.deepEqual({ ...first.data, media: undefined }, { ...rest, media: undefined });
  });

  test("an id used twice by one owner stops the copy, and nothing is kept", async () => {
    const somebody = await makeUser("twice");
    const payload = JSON.stringify({
      revision: "r",
      workspaces: { active: "default", list: [] },
      slices: { default: slice({ events: [post("dup")] }), other: slice({ events: [post("dup")] }) },
    }).replaceAll("'", "''");
    const copy = (await import("node:fs")).readFileSync(new globalThis.URL("../migrations/20261026090100_posts_copy.sql", import.meta.url), "utf8");
    assert.throws(
      () =>
        sql(`begin;
          alter table public.account_state drop constraint account_state_without_posts;
          delete from public.account_state where user_id <> '${somebody.id}';
          insert into public.account_state (user_id, payload) values ('${somebody.id}', '${payload}'::jsonb);
          ${copy}
          rollback;`),
      /used more than once/,
    );
    assert.equal(sql(`select count(*) from public.posts where owner_id = '${somebody.id}'`), "0");
  });
});
