/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { FakeIdb } from "@/lib/fake-idb";

const shared = vi.hoisted(() => ({ idb: null as unknown as FakeIdb, online: true, handed: [] as string[], rows: [] as object[] }));

const saved = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  removeItem: (key: string) => void saved.delete(key),
});

vi.mock("idb", () => ({ openDB: async () => shared.idb.open() }));
vi.mock("somoto", () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/components/brand/mascot", () => ({ SquirrelPhone: () => null }));
vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {}, waitForAccountSync: async () => {} }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false, ownerOf: (id?: string) => id }));
vi.mock("@/lib/supabase", () => ({ supabase: null }));
vi.mock("@/lib/cloud-storage", () => ({ cloudEnabled: false, cloudHoldUps: () => new Map(), cloudUploads: () => new Set(), queueCloud: () => {} }));
vi.mock("@/lib/account-sync", () => ({ flushAccountSync: async () => shared.online }));
vi.mock("@/lib/team-sync", () => ({ flushTeamSync: async () => shared.online }));
vi.mock("@/lib/post-sync", () => ({
  flushPostSync: async () => shared.online,
  postSyncProblem: createSignal(null)[0],
  refusedPosts: createSignal(new Map())[0],
  unsyncedPosts: createSignal(new Set())[0],
}));
vi.mock("@/lib/publishing", () => ({
  requestSend: async (id: string) => {
    shared.handed.push(id);
    return shared.rows;
  },
}));

const { loadWorkspaces } = await import("@/lib/workspaces");
loadWorkspaces("user-1");
const { allPosts, createEvent, hydrateCalendar } = await import("@/components/calendar/store");
const { localDateKey } = await import("@/components/calendar/utils");
const { timeOf } = await import("./save");
const { rememberRows } = await import("./deliveries");
const { sendPost } = await import("./publisher");

const statusOf = (id: string) => allPosts().find((post) => post.id === id)?.status;

const row = (id: string, state: string) => ({ id: `${id}-x`, post_id: id, occurrence: "once", platform: "x", connection_id: "c1", state, error: null, publish_id: null, url: null, attempts: 1, due_at: new Date().toISOString(), updated_at: new Date().toISOString() });

async function scheduled(id: string, change: { at?: Date; repeat?: string } = {}) {
  const when = change.at ?? new Date();
  const problem = await createEvent({ id, allDay: false, calendarId: "posts", day: localDateKey(when), description: "Words", duration: 15, link: "", platforms: ["x"], accounts: {}, repeat: change.repeat ?? "", repeatEnd: "", start: timeOf(when), status: "scheduled", title: id });
  expect(problem).toBeUndefined();
}

beforeEach(async () => {
  shared.idb ??= new FakeIdb();
  shared.online = true;
  shared.handed = [];
  shared.rows = [];
  await hydrateCalendar();
});

describe("Post now that never reached the publisher", () => {
  test("becomes a draft, so it can't go by itself once it syncs", async () => {
    await scheduled("offline");
    shared.online = false;
    await expect(sendPost("offline", "user-1")).resolves.toBe("failed");
    expect(statusOf("offline")).toBe("draft");
    expect(shared.idb.rows("events").find((item) => item.id === "offline")?.status).toBe("draft");
  });

  test("Retry on that draft still hands it over", async () => {
    await scheduled("retried");
    shared.online = false;
    await sendPost("retried", "user-1");
    shared.online = true;
    shared.rows = [row("retried", "sent")];
    await expect(sendPost("retried", "user-1")).resolves.toBe("sent");
    expect(shared.handed).toEqual(["retried"]);
  });

  test("a repeating post keeps going: one failed Post now doesn't end the series", async () => {
    await scheduled("series", { repeat: "every:1:day" });
    shared.online = false;
    await sendPost("series", "user-1");
    expect(statusOf("series")).toBe("scheduled");
  });

  test("a post whose time is still ahead stays scheduled, and goes at that time", async () => {
    await scheduled("later", { at: new Date(Date.now() + 2 * 60 * 60_000) });
    shared.online = false;
    await sendPost("later", "user-1");
    expect(statusOf("later")).toBe("scheduled");
  });

  test("a repeating post stays scheduled for its next runs", async () => {
    await scheduled("series", { repeat: "weekday" });
    shared.online = false;
    await sendPost("series", "user-1");
    expect(statusOf("series")).toBe("scheduled");
  });

  test("one the publisher already has rows for stays as it is", async () => {
    await scheduled("known");
    rememberRows([row("known", "failed") as never]);
    shared.online = false;
    await sendPost("known", "user-1");
    expect(statusOf("known")).toBe("scheduled");
  });
});
