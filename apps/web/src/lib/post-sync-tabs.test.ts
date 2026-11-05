/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Each tab is its own copy of the store and the sync, over one shared database, as tabs of a browser are.

import { beforeEach, describe, expect, test, vi } from "vitest";

import type { EventDraft } from "@/components/calendar/types";
import type { PostRow } from "@/lib/post-sync-core";

const shared = vi.hoisted(() => ({
  idb: null as unknown as import("./fake-idb").FakeIdb,
  rows: new Map<string, PostRow>(),
  clock: 0,
  refuse: null as string | null,
}));

const saved = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  removeItem: (key: string) => void saved.delete(key),
});

function writeRow(id: string, values: Partial<PostRow>): PostRow {
  const at = new Date(Date.UTC(2026, 10, 5, 9, 0, ++shared.clock)).toISOString();
  const row: PostRow = { id, version: (shared.rows.get(id)?.version ?? 0) + 1, data: null, deleted_at: null, thumbnail_at: null, updated_at: at, ...values };
  shared.rows.set(id, row);
  return structuredClone(row);
}

vi.mock("idb", () => ({ openDB: async () => shared.idb.open() }));
vi.mock("somoto", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("@/lib/cloud-storage", () => ({ cloudEnabled: false, cloudHoldUps: () => new Map(), cloudUploads: () => new Set(), queueCloud: () => {} }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false, ownerOf: (id?: string) => id }));
vi.mock("@/lib/account-sync", () => ({
  onePostsCalendar: (_calendars: unknown, events: unknown) => ({ events }),
  legacyKnownPosts: async () => null,
  legacyFingerprint: () => "",
}));
vi.mock("@/lib/team-sync", () => ({ readTeamCopyPosts: async () => null }));
vi.mock("@/lib/post-rows", () => ({
  POST_COLUMNS: "*",
  readPostRows: vi.fn(async (_db: unknown, _owner: string, _workspace: string, since: string | null) =>
    [...shared.rows.values()].filter((row) => !since || row.updated_at >= since).map((row) => structuredClone(row)),
  ),
}));
vi.mock("@/lib/supabase", () => {
  const posts = {
    select: () => ({
      match: ({ id }: { id: string }) => ({ maybeSingle: async () => ({ data: structuredClone(shared.rows.get(id) ?? null), error: null }) }),
    }),
    insert: ({ id, data }: { id: string; data: PostRow["data"] }) => ({
      select: () => ({
        maybeSingle: async () => {
          if (shared.refuse === id) return { data: null, error: { code: "23514", message: "Turned down" } };
          return shared.rows.has(id) ? { data: null, error: { code: "23505" } } : { data: writeRow(id, { data }), error: null };
        },
      }),
    }),
    update: (change: { data?: PostRow["data"]; deleted_at?: string | null }) => ({
      match: ({ id, version }: { id: string; version: number }) => ({
        select: async () => {
          if (shared.rows.get(id)?.version !== version) return { data: [], error: null };
          return { data: [writeRow(id, { data: change.data ?? null, deleted_at: change.deleted_at ?? null })], error: null };
        },
      }),
    }),
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: () => posts, channel: () => channel, removeChannel: async () => {} } };
});

const USER = "user-1";

async function openTab({ hydrate = true } = {}) {
  vi.resetModules();
  const { loadWorkspaces } = await import("@/lib/workspaces");
  loadWorkspaces(USER);
  const store = await import("@/components/calendar/store");
  const sync = await import("@/lib/post-sync");
  sync.beginPostSync(USER);
  if (hydrate) await store.hydrateCalendar();
  const saves = async () => {
    while (store.saving()) await new Promise((resolve) => setImmediate(resolve));
  };
  /** The run a live change from another tab, or the minute's look, starts. */
  const sync_ = async () => {
    await saves();
    await sync.flushPostSync();
  };
  return { store, sync: sync_, saves, flush: sync.flushPostSync, unsaved: sync.postsNotOnServer };
}

function draft(change: Partial<EventDraft> = {}): EventDraft {
  return {
    id: "p1",
    allDay: false,
    calendarId: "posts",
    day: "2099-01-05",
    description: "Words",
    duration: 15,
    link: "",
    platforms: ["x"],
    accounts: {},
    repeat: "",
    repeatEnd: "",
    start: "10:00",
    status: "scheduled",
    title: "The post",
    ...change,
  };
}

const sharedPost = (id = "p1") => shared.rows.get(id)?.data as { start?: string; title?: string } | null | undefined;

beforeEach(async () => {
  const { FakeIdb } = await import("./fake-idb");
  shared.idb = new FakeIdb();
  shared.rows.clear();
  shared.refuse = null;
  saved.clear();
});

describe("two tabs of one browser", () => {
  async function bothWithAPost() {
    const a = await openTab();
    const b = await openTab();
    expect(await a.store.createEvent(draft())).toBeUndefined();
    await a.sync();
    await b.sync();
    return { a, b };
  }

  test("a later save in the second tab doesn't put back what the first moved", async () => {
    const { a, b } = await bothWithAPost();
    expect(a.store.moveEvent({ sourceId: "p1", day: "2099-01-05", start: "15:00" })).toBeUndefined();
    await a.sync();
    expect(sharedPost()?.start).toBe("15:00");

    await b.sync();
    expect(b.store.allPosts().find((post) => post.id === "p1")?.start).toBe("15:00");

    b.store.setDelivery("p1", "x", { state: "sending", attempts: 1, at: "2099-01-05T15:00:00.000Z" });
    await b.sync();
    expect(sharedPost()?.start).toBe("15:00");
    expect(shared.rows.get("p1")?.version).toBe(2);
  });

  test("a post deleted in the first tab doesn't come back when the second edits it", async () => {
    const { a, b } = await bothWithAPost();
    a.store.deleteEvent({ sourceId: "p1" });
    await a.sync();

    await b.sync();
    expect(b.store.allPosts().map((post) => post.id)).toEqual([]);
    b.store.setPostCaptions("p1", { x: "Written here" });
    await b.sync();
    expect(shared.rows.get("p1")?.data).toBeNull();
  });

  test("a run with nothing new leaves the list and every post on screen as they were", async () => {
    const a = await openTab();
    a.store.createEvent(draft({ id: "z" }));
    a.store.createEvent(draft({ id: "a" }));
    await a.sync();
    const before = a.store.allPosts();
    expect(before.map((post) => post.id)).toEqual(["a", "z"]);
    a.store.createEvent(draft({ id: "m" }));
    await a.sync();
    const order = a.store.allPosts();
    // A new post shows first here, and is read back in key order: only a change may reorder the list.
    expect(order.map((post) => post.id)).toEqual(["m", "a", "z"]);
    await a.sync();
    const after = a.store.allPosts();
    expect(after.map((post) => post.id)).toEqual(["m", "a", "z"]);
    after.forEach((post, index) => expect(post).toBe(order[index]));
  });

  test("a post that changed elsewhere is the only one given a new object", async () => {
    const a = await openTab();
    const b = await openTab();
    a.store.createEvent(draft({ id: "one" }));
    a.store.createEvent(draft({ id: "two" }));
    await a.sync();
    await b.sync();
    const [one, two] = ["one", "two"].map((id) => b.store.allPosts().find((post) => post.id === id));
    a.store.moveEvent({ sourceId: "two", day: "2099-01-05", start: "16:00" });
    await a.sync();
    await b.sync();
    expect(b.store.allPosts().find((post) => post.id === "one")).toBe(one);
    expect(b.store.allPosts().find((post) => post.id === "two")).not.toBe(two);
  });

  test("a save still in flight here stays on screen through a run", async () => {
    const { b } = await bothWithAPost();
    let release = () => {};
    shared.idb.holdWrite = { store: "events", until: new Promise<void>((resolve) => (release = resolve)) };
    expect(b.store.moveEvent({ sourceId: "p1", day: "2099-01-05", start: "18:00" })).toBeUndefined();
    await b.flush();
    expect(b.store.allPosts().find((post) => post.id === "p1")?.start).toBe("18:00");
    shared.idb.holdWrite = null;
    release();
    await b.saves();
    expect(b.store.allPosts().find((post) => post.id === "p1")?.start).toBe("18:00");
  });

  test("a save that lands between the read and the refresh isn't undone by that read", async () => {
    const { b } = await bothWithAPost();
    // The first read of the run is the sync's own; the refresh's is the next.
    let reads = 0;
    const hook = async (name: string) => {
      if (name === "events" && ++reads === 2) {
        b.store.moveEvent({ sourceId: "p1", day: "2099-01-05", start: "19:00" });
        await b.saves();
        return;
      }
      shared.idb.afterRead = hook;
    };
    shared.idb.afterRead = hook;
    await b.flush();
    expect(reads).toBe(2);
    expect(b.store.allPosts().find((post) => post.id === "p1")?.start).toBe("19:00");
    await b.sync();
    expect(sharedPost()?.start).toBe("19:00");
  });

  test("a tab that never opened the calendar loads no posts for a run", async () => {
    const a = await openTab();
    a.store.createEvent(draft());
    await a.sync();
    const c = await openTab({ hydrate: false });
    await c.sync();
    expect(c.store.loaded()).toBe(false);
    expect(c.store.allPosts()).toEqual([]);
  });
});

describe("a save that hasn't reached the account yet", () => {
  test("counts from the save until a run has sent it", async () => {
    const a = await openTab();
    await a.sync();
    expect(a.unsaved()).toBe(false);
    a.store.createEvent(draft());
    await a.saves();
    expect(a.unsaved()).toBe(true);
    await a.flush();
    expect(a.unsaved()).toBe(false);
  });

  test("still counts when the run couldn't reach the server", async () => {
    const a = await openTab();
    await a.sync();
    a.store.createEvent(draft());
    await a.saves();
    const { readPostRows } = await import("@/lib/post-rows");
    vi.mocked(readPostRows).mockRejectedValueOnce(new Error("Failed to fetch"));
    await a.flush();
    expect(a.unsaved()).toBe(true);
    await a.flush();
    expect(a.unsaved()).toBe(false);
  });

  test("a post the server turned down doesn't count: staying wouldn't send it", async () => {
    const a = await openTab();
    await a.sync();
    shared.refuse = "p1";
    a.store.createEvent(draft());
    await a.saves();
    await a.flush();
    expect(a.unsaved()).toBe(false);
  });
});
