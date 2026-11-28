/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from "vitest";

import { nextRunAfter } from "../../../../../services/publisher/schedule.mjs";

import { createPostingTools, type AgentContext, type DeliveryRow, type FileCopy, type PostData, type PostFilter, type PostingStore, type PostRow } from "./posts";

const NOW = Date.parse("2026-11-27T12:00:00Z");

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    owner: "owner-1",
    workspace: "default",
    name: "Personal",
    role: "owner",
    level: 2,
    membersNeedApproval: false,
    timeZone: "Europe/Amsterdam",
    calendarId: "posts",
    connections: [
      { id: "bsky", platform: "bluesky", handle: "me.bsky.social", ready: true, scope: "", page: false },
      { id: "tt", platform: "tiktok", handle: "@me", ready: true, scope: "video.publish,video.list", page: false },
      { id: "yt", platform: "youtube", handle: "Me", ready: true, scope: "", page: false },
    ],
    library: [
      { id: "clip", name: "clip.mp4", kind: "video", type: "video/mp4", size: 100, width: 1080, height: 1920, duration: 30, lastModified: 1, createdAt: "2026-11-01T00:00:00Z", uses: 0 },
      { id: "pic", name: "pic.jpg", kind: "image", type: "image/jpeg", size: 10, width: 1000, height: 1000, duration: 0, lastModified: 2, createdAt: "2026-11-02T00:00:00Z", uses: 0 },
    ],
    ...overrides,
  };
}

const CREATOR = { creator_nickname: "Me", creator_username: "me", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 600 };

/**
 * Versions as the posts table keeps them: a write over an older one is a conflict. A send hands each network to the
 * publisher, which settles it (`settle`) by the time the tool first waits.
 */
function memoryStore(scope = context(), { settle = (_platform: string) => ({ state: "sent" }) as { state: string; error?: string }, reads = {} as Record<string, unknown> } = {}) {
  const rows = new Map<string, PostRow>();
  const copies: FileCopy[] = [];
  const sent: string[] = [];
  const asked: { route: string; body: object }[] = [];
  const approvals: { id: string; base: number; snapshot: Record<string, unknown> }[] = [];
  const store: PostingStore = {
    context: async () => scope,
    async posts(_scope, filter: PostFilter) {
      return [...rows.values()].filter(
        (row) =>
          (!filter.id || row.id === filter.id) &&
          (!filter.status || row.data.status === filter.status) &&
          (!filter.from || row.data.day >= filter.from) &&
          (!filter.to || row.data.day <= filter.to),
      );
    },
    async save(_scope, post, base) {
      const before = rows.get(post.id);
      if (base === null ? before : before?.version !== base) return base === null ? Promise.reject(new Error("This post already exists.")) : { conflict: true as const };
      const version = (before?.version ?? 0) + 1;
      rows.set(post.id, { id: post.id, version, data: structuredClone(post), deliveries: before?.deliveries ?? {} });
      return { version };
    },
    async copyFiles(_scope, list) {
      copies.push(...list);
    },
    async remove(_scope, id, base) {
      if (rows.get(id)?.version !== base) return { conflict: true as const };
      rows.delete(id);
      return { deleted: true as const };
    },
    async askApproval(_scope, id, base, snapshot) {
      const row = rows.get(id)!;
      if (row.version !== base) return { conflict: true as const };
      approvals.push({ id, base, snapshot: snapshot as Record<string, unknown> });
      row.data = { ...row.data, status: "draft", approval: { state: "pending", at: new Date(NOW).toISOString() } };
      row.version += 1;
      return { version: row.version, preview: "preview-1" };
    },
    async send(id) {
      const row = rows.get(id)!;
      sent.push(id);
      row.deliveries = Object.fromEntries(row.data.platforms.map((platform) => [platform, { state: "queued" }]));
      return row.data.platforms.map((platform): DeliveryRow => ({ platform, connection_id: "c", state: "queued", error: null }));
    },
    async network<T>(route: string, body: object) {
      asked.push({ route, body });
      if (!(route in reads)) throw new Error(`no ${route} here`);
      const answer = reads[route];
      if (answer instanceof Error) throw answer;
      return answer as T;
    },
  };
  const sleep = async () => {
    for (const id of sent) {
      const row = rows.get(id);
      if (!row) continue;
      const deliveries = Object.fromEntries(Object.keys(row.deliveries).map((platform) => [platform, settle(platform)]));
      row.deliveries = deliveries;
      if (Object.values(deliveries).every((delivery) => delivery.state === "sent")) row.data = { ...row.data, status: "posted" };
    }
  };
  return { store, rows, copies, sent, asked, approvals, tools: createPostingTools(store, { now: () => NOW, sleep, site: "https://plan.example" }) };
}

async function ok(outcome: Promise<unknown>) {
  const result = (await outcome) as { text?: string; error?: boolean };
  expect(result.error, result.text).toBe(false);
  return JSON.parse(result.text!);
}

async function refused(outcome: Promise<unknown>) {
  const result = (await outcome) as { text: string; error: boolean };
  expect(result.error, result.text).toBe(true);
  return result.text;
}

const existing = (id: string, data: Partial<PostData> = {}): PostRow => ({
  id,
  version: 3,
  deliveries: {},
  data: {
    id,
    title: "Hello",
    description: "Hello",
    day: "2026-12-10",
    start: "09:00",
    allDay: false,
    duration: 15,
    platforms: ["bluesky"],
    accounts: { bluesky: ["bsky"] },
    status: "scheduled",
    calendarId: "posts",
    createdAt: "2026-11-20T00:00:00Z",
    recurrence: null,
    recurrenceExceptions: [],
    link: null,
    timeZone: "Europe/Amsterdam",
    sendFrom: "2026-11-20T00:00:00Z",
    ...data,
  },
});

describe("schedule_post without a tab", () => {
  test("saves a post the publisher sends at that time in the dashboard's zone", async () => {
    const { tools, rows } = memoryStore();
    const view = await ok(tools.run("schedule_post", { caption: "Hi there", platforms: ["bluesky"], day: "2026-12-01", time: "9:30" }));
    const saved = rows.get(view.id)!.data;
    expect(saved).toMatchObject({ status: "scheduled", day: "2026-12-01", start: "09:30", allDay: false, timeZone: "Europe/Amsterdam", accounts: { bluesky: ["bsky"] }, calendarId: "posts" });
    expect(saved.sendFrom).toBe(new Date(NOW).toISOString());
    expect(view).toMatchObject({ status: "scheduled", time: "09:30", timeZone: "Europe/Amsterdam", platforms: [{ platform: "bluesky", accountId: "bsky", handle: "me.bsky.social" }] });
    // As the publisher reads it, whatever zone the account is in.
    expect(nextRunAfter(saved, "America/New_York", new Date(NOW))).toBe(Date.parse("2026-12-01T08:30:00Z"));
  });

  test("a repeating post runs on the publisher's days until its end", async () => {
    const { tools, rows } = memoryStore();
    const view = await ok(tools.run("schedule_post", { caption: "Weekly", platforms: ["bluesky"], day: "2026-12-01", time: "10:00", repeat: { every: 1, unit: "week", times: 2 } }));
    const saved = rows.get(view.id)!.data;
    expect(saved).toMatchObject({ recurrence: "every:1:week", recurrenceEnd: "2026-12-08" });
    expect(nextRunAfter(saved, "UTC", new Date("2026-12-01T09:00:00Z"))).toBe(Date.parse("2026-12-08T09:00:00Z"));
    expect(nextRunAfter(saved, "UTC", new Date("2026-12-08T09:00:00Z"))).toBeNull();
  });

  test("a post due in a few minutes is saved like any other", async () => {
    const { tools, rows } = memoryStore();
    // 13:05 in Amsterdam is five minutes from NOW.
    const view = await ok(tools.run("schedule_post", { caption: "Now-ish", platforms: ["bluesky"], day: "2026-11-27", time: "13:05" }));
    expect(rows.get(view.id)!.data).toMatchObject({ status: "scheduled", start: "13:05" });
  });

  test("a draft has no time to go out at", async () => {
    const { tools, rows } = memoryStore();
    const view = await ok(tools.run("schedule_post", { caption: "Idea", platforms: ["bluesky"], draft: true }));
    expect(rows.get(view.id)!.data).toMatchObject({ status: "draft", allDay: true, day: "2026-11-27" });
  });

  test("TikTok's profile needs the user's yes and goes by the account's creator info; its inbox needs neither", async () => {
    const { tools, rows, asked } = memoryStore(context(), { reads: { "tiktok/creator": { data: { ...CREATOR, comment_disabled: true } } } });
    const post = { caption: "Dance", platforms: ["tiktok"], day: "2026-12-02", time: "10:00", media: "media:clip" };
    const unasked = await refused(tools.run("schedule_post", { ...post, tiktok: { privacy: "public", promotion: "none" } }));
    expect(unasked).toContain("By posting, you agree to TikTok's Music Usage Confirmation");
    expect(await refused(tools.run("schedule_post", { ...post, tiktok: { privacy: "friends", promotion: "none", agreed: true } }))).toContain("can't show a post to friends");
    expect(rows.size).toBe(0);

    const view = await ok(tools.run("schedule_post", { ...post, tiktok: { privacy: "public", promotion: "none", comments: true, agreed: true } }));
    expect(rows.get(view.id)!.data.tiktok).toMatchObject({ privacy: "public", comments: false });
    expect(view.warnings).toContainEqual(expect.stringContaining("Comments is turned off"));
    expect(asked.every(({ route, body }) => route === "tiktok/creator" && (body as { connectionId: string }).connectionId === "tt")).toBe(true);

    asked.length = 0;
    await ok(tools.run("schedule_post", { ...post, tiktok: { inbox: true } }));
    expect(asked).toEqual([]);
  });

  test("a member's post waits for approval where the workspace asks for it, and the owner's goes out", async () => {
    const member = memoryStore(context({ role: "member", membersNeedApproval: true }));
    const held = await ok(member.tools.run("schedule_post", { caption: "Hi", platforms: ["bluesky"], day: "2026-12-01", time: "09:30" }));
    expect(member.rows.get(held.id)!.data).toMatchObject({ status: "draft", approval: { state: "pending" } });
    expect(held.approval).toEqual({ state: "pending" });
    expect(held.warnings).toContainEqual(expect.stringContaining("ask_for_approval"));

    const owner = memoryStore(context({ membersNeedApproval: true }));
    const view = await ok(owner.tools.run("schedule_post", { caption: "Hi", platforms: ["bluesky"], day: "2026-12-01", time: "09:30" }));
    expect(owner.rows.get(view.id)!.data.status).toBe("scheduled");
  });

  test("copies a library file onto the post before the post names it", async () => {
    const { tools, rows, copies } = memoryStore();
    const view = await ok(tools.run("schedule_post", { caption: "Watch", platforms: ["youtube"], day: "2026-12-03", time: "18:00", media: "media:clip" }));
    const saved = rows.get(view.id)!.data;
    expect(copies).toEqual([{ from: "media/clip", to: saved.files![0] }]);
    expect(saved.files![0]).toMatch(new RegExp(`^${view.id}_[0-9a-f]{12}$`));
    expect(saved.media).toEqual([{ id: saved.files![0], name: "clip.mp4", type: "video/mp4", lastModified: 1, cloud: { key: `posts/owner-1/${saved.files![0]}`, at: new Date(NOW).toISOString() } }]);
    expect(saved.youtube).toMatchObject({ title: "Watch", short: true });
  });

  test("refuses a file that isn't in the library, and a path, copying nothing", async () => {
    const { tools, copies } = memoryStore();
    expect(await tools.run("schedule_post", { caption: "x", platforms: ["bluesky"], day: "2026-12-03", time: "18:00", media: "media:gone" })).toMatchObject({ error: true, text: expect.stringMatching(/^not-found/) });
    expect(await tools.run("schedule_post", { caption: "x", platforms: ["bluesky"], day: "2026-12-03", time: "18:00", media: "/etc/passwd" })).toMatchObject({ error: true });
    expect(copies).toEqual([]);
  });

  test("checks each network's rules before anything is copied or saved", async () => {
    const { tools, rows, copies } = memoryStore();
    const result = await tools.run("schedule_post", { caption: "x".repeat(301), platforms: ["bluesky"], day: "2026-12-03", time: "18:00", media: "media:pic" });
    expect(result).toMatchObject({ error: true, text: expect.stringContaining("Bluesky") });
    expect(rows.size + copies.length).toBe(0);
  });

  test("keeps the Free plan's waiting posts per account, but not in a shared workspace", async () => {
    const free = memoryStore(context({ level: 1 }));
    for (let day = 1; day <= 10; day++) {
      await ok(free.tools.run("schedule_post", { caption: `Post ${day}`, platforms: ["bluesky"], day: `2026-12-${String(day).padStart(2, "0")}`, time: "10:00" }));
    }
    expect(await free.tools.run("schedule_post", { caption: "Eleventh", platforms: ["bluesky"], day: "2026-12-20", time: "10:00" })).toMatchObject({ error: true, text: expect.stringContaining("Free plan") });
    expect(JSON.parse(((await free.tools.run("social_accounts", {})) as { text: string }).text).accounts[0].scheduledRoom).toBe(0);
    await ok(free.tools.run("schedule_post", { caption: "A draft", platforms: ["bluesky"], draft: true }));

    const shared = memoryStore(context({ level: 1, role: "member", owner: "someone-else" }));
    for (let day = 1; day <= 11; day++) {
      await ok(shared.tools.run("schedule_post", { caption: `Post ${day}`, platforms: ["bluesky"], day: `2026-12-${String(day).padStart(2, "0")}`, time: "10:00" }));
    }
  });
});

describe("update_post and copy_post without a tab", () => {
  test("saves over the version read, and a post changed meanwhile is left alone", async () => {
    const { tools, rows, store } = memoryStore();
    rows.set("p1", existing("p1"));
    const view = await ok(tools.run("update_post", { id: "p1", caption: "New words" }));
    expect(view.caption).toBe("New words");
    expect(rows.get("p1")!.version).toBe(4);
    // Not retimed: the publisher's guard against sending past runs stays where it was.
    expect(rows.get("p1")!.data.sendFrom).toBe("2026-11-20T00:00:00Z");

    const save = store.save;
    store.save = async (scope, post) => save(scope, post, 1);
    expect(await tools.run("update_post", { id: "p1", caption: "Lost" })).toMatchObject({ error: true, text: expect.stringMatching(/^busy/) });
    expect(rows.get("p1")!.data.description).toBe("New words");
  });

  test("a new time gets a new sendFrom", async () => {
    const { tools, rows } = memoryStore();
    rows.set("p1", existing("p1"));
    await ok(tools.run("update_post", { id: "p1", day: "2026-12-11", time: "10:00" }));
    expect(rows.get("p1")!.data).toMatchObject({ day: "2026-12-11", start: "10:00", sendFrom: new Date(NOW).toISOString() });
  });

  test("a post waiting for approval keeps waiting at a new time, and can't be scheduled around it", async () => {
    const { tools, rows } = memoryStore(context({ role: "member", membersNeedApproval: true }));
    rows.set("p1", existing("p1", { status: "draft", approval: { state: "pending", at: "2026-11-20T00:00:00Z" } }));
    await ok(tools.run("update_post", { id: "p1", day: "2026-12-11", time: "10:00" }));
    expect(rows.get("p1")!.data).toMatchObject({ status: "draft", day: "2026-12-11", approval: { state: "pending" } });
    expect(await refused(tools.run("update_post", { id: "p1", draft: false }))).toContain("waiting for approval");
  });

  test("a post that went out stays as it went out", async () => {
    const { tools, rows } = memoryStore();
    rows.set("p1", existing("p1", { status: "posted" }));
    expect(await tools.run("update_post", { id: "p1", caption: "x" })).toMatchObject({ error: true, text: expect.stringContaining("Posted posts") });
  });

  test("new media replaces the post's files, and the follow-ups keep theirs", async () => {
    const { tools, rows, copies } = memoryStore();
    rows.set(
      "p1",
      existing("p1", {
        files: ["p1_old"],
        thread: [{ id: "r1", text: "More", delay: 0, files: ["p1_reply"] }],
        media: [
          { id: "p1_old", name: "old.jpg", type: "image/jpeg", lastModified: 0 },
          { id: "p1_reply", name: "reply.jpg", type: "image/jpeg", lastModified: 0 },
        ],
      }),
    );
    await ok(tools.run("update_post", { id: "p1", media: ["media:pic"] }));
    const saved = rows.get("p1")!.data;
    expect(copies).toEqual([{ from: "media/pic", to: saved.files![0] }]);
    expect(saved.media!.map((item) => item.id).sort()).toEqual([saved.files![0], "p1_reply"].sort());
  });

  test("copy_post copies the original's files, sent ones too, under the new post", async () => {
    const { tools, rows, copies } = memoryStore();
    rows.set(
      "p1",
      existing("p1", {
        status: "posted",
        platforms: ["youtube"],
        accounts: { youtube: ["yt"] },
        files: ["p1_a"],
        media: [{ id: "p1_a", name: "short.mp4", type: "video/mp4", lastModified: 5 }],
        youtube: { title: "My short", description: "", privacy: "unlisted", madeForKids: false, tags: ["fun"], short: true },
      }),
    );
    const view = await ok(tools.run("copy_post", { id: "p1", day: "2026-12-05", time: "12:00" }));
    const saved = rows.get(view.id)!.data;
    expect(copies).toEqual([{ from: "posts/p1_a", to: saved.files![0] }]);
    expect(saved.files![0].startsWith(`${view.id}_`)).toBe(true);
    expect(saved.youtube).toMatchObject({ title: "My short", privacy: "unlisted", tags: ["fun"], short: true });
    expect(saved).toMatchObject({ status: "scheduled", accounts: { youtube: ["yt"] } });
  });
});

describe("what used to need the tab", () => {
  test("delete_post deletes over the version read, but not a post that went out", async () => {
    const { tools, rows } = memoryStore();
    rows.set("p1", existing("p1"));
    rows.set("p2", existing("p2", { status: "posted" }));
    expect(await ok(tools.run("delete_post", { id: "p1" }))).toEqual({ id: "p1", deleted: true });
    expect(rows.has("p1")).toBe(false);
    expect(await refused(tools.run("delete_post", { id: "p2" }))).toContain("stay as they went out");
    expect(rows.has("p2")).toBe(true);
  });

  test("publish_post moves a future post to now, hands it to the publisher and waits until it's out", async () => {
    const { tools, rows, sent } = memoryStore();
    rows.set("p1", existing("p1"));
    const view = await ok(tools.run("publish_post", { id: "p1" }));
    expect(sent).toEqual(["p1"]);
    expect(view.deliveries).toEqual([{ platform: "bluesky", state: "sent" }]);
    // 12:00 UTC is 13:00 in Amsterdam.
    expect(rows.get("p1")!.data).toMatchObject({ day: "2026-11-27", start: "13:00", status: "posted" });
  });

  test("a send that fails says why and puts the post back at its time", async () => {
    const { tools, rows } = memoryStore(context(), { settle: () => ({ state: "failed", error: "Bluesky is down." }) });
    rows.set("p1", existing("p1"));
    expect(await refused(tools.run("publish_post", { id: "p1" }))).toContain("Bluesky: Bluesky is down.");
    expect(rows.get("p1")!.data).toMatchObject({ day: "2026-12-10", start: "09:00", status: "scheduled" });
  });

  test("publish_post sends nothing it can't: a post waiting for approval, files still uploading, TikTok without the user's yes", async () => {
    const { tools, rows, sent } = memoryStore(context(), { reads: { "tiktok/creator": { data: CREATOR } } });
    rows.set("waiting", existing("waiting", { status: "draft", approval: { state: "pending", at: "2026-11-20T00:00:00Z" } }));
    expect(await refused(tools.run("publish_post", { id: "waiting" }))).toContain("waiting for approval");
    const tiktok = { privacy: "public" as const, comments: true, duet: true, stitch: true, yourBrand: false, brandedContent: false };
    const video = { id: "f1", name: "clip.mp4", type: "video/mp4", lastModified: 1 };
    rows.set("uploading", existing("uploading", { platforms: ["tiktok"], accounts: { tiktok: ["tt"] }, tiktok, files: ["f1"], media: [video] }));
    expect(await refused(tools.run("publish_post", { id: "uploading", agreed: true }))).toContain("haven't reached plan.video's storage");
    rows.set("tiktok", existing("tiktok", { platforms: ["tiktok"], accounts: { tiktok: ["tt"] }, tiktok, files: ["f1"], media: [{ ...video, cloud: { key: "posts/owner-1/f1", at: "" } }] }));
    expect(await refused(tools.run("publish_post", { id: "tiktok" }))).toContain("TikTok's terms");
    expect(sent).toEqual([]);
    await ok(tools.run("publish_post", { id: "tiktok", agreed: true }));
    expect(sent).toEqual(["tiktok"]);
  });

  test("ask_for_approval shares what the post shows and returns its link", async () => {
    const { tools, rows, approvals } = memoryStore();
    rows.set("p1", existing("p1"));
    const view = await ok(tools.run("ask_for_approval", { id: "p1" }));
    expect(view).toMatchObject({ status: "draft", approval: { state: "pending" }, approvalLink: "https://plan.example/p/preview-1" });
    expect(approvals).toEqual([
      {
        id: "p1",
        base: 3,
        snapshot: expect.objectContaining({ status: "draft", workspaceId: "default", platforms: [{ id: "bluesky", name: "Bluesky", handles: ["me.bsky.social"], avatars: [""] }] }),
      },
    ]);
  });

  test("tiktok_creator reads the account through the publisher", async () => {
    const { tools } = memoryStore(context(), { reads: { "tiktok/creator": { data: CREATOR } } });
    expect(await ok(tools.run("tiktok_creator", {}))).toMatchObject({ accountId: "tt", nickname: "Me", privacy: ["public", "private"], comments: true });
  });

  test("analytics counts each network's posts on their day in the dashboard's zone, and says why one couldn't be read", async () => {
    // 23:30 UTC on Tuesday is 00:30 on Wednesday in Amsterdam.
    const late = Date.parse("2026-11-24T23:30:00Z");
    const { tools } = memoryStore(context(), {
      reads: {
        "tiktok/videos": { videos: [{ id: "v1", title: "Late one", postedAt: late, views: 120, likes: 10, comments: 2 }] },
        "youtube/analytics": new Error("YouTube is having a moment."),
      },
    });
    const answer = await ok(tools.run("analytics", { days: 30 }));
    expect(answer.timeZone).toBe("Europe/Amsterdam");
    expect(answer.topPosts).toEqual([expect.objectContaining({ title: "Late one", postedAt: "2026-11-25 00:30, Wednesday", views: 120 })]);
    expect(answer.byWeekday).toEqual([expect.objectContaining({ weekday: "Wednesday", posts: 1 })]);
    expect(answer.accounts).toContainEqual(expect.objectContaining({ platform: "youtube", state: "YouTube is having a moment." }));
    expect(answer.accounts).toContainEqual(expect.objectContaining({ platform: "tiktok", state: "ready", totals: { views: 120, likes: 10, comments: 2 } }));
  });
});

describe("what's read", () => {
  test("list_posts reads deliveries as sending until the network has it", async () => {
    const { tools, rows } = memoryStore();
    rows.set("p1", { ...existing("p1"), deliveries: { bluesky: { state: "queued" } } });
    rows.set("p2", { ...existing("p2", { day: "2026-12-01" }), deliveries: { bluesky: { state: "failed", error: "Too long" } } });
    const listed = await ok(tools.run("list_posts", {}));
    expect(listed.posts.map((post: { id: string }) => post.id)).toEqual(["p2", "p1"]);
    expect(listed.posts[0].deliveries).toEqual([{ platform: "bluesky", state: "failed", error: "Too long" }]);
    expect(listed.posts[1].deliveries).toEqual([{ platform: "bluesky", state: "sending" }]);
  });

  test("list_media lists the library newest first, by media id", async () => {
    const { tools } = memoryStore();
    const listed = await ok(tools.run("list_media", {}));
    expect(listed.media.map((item: { id: string }) => item.id)).toEqual(["media:pic", "media:clip"]);
  });
});
