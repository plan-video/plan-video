/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, test, vi } from "vitest";

import { FakeIdb } from "@/lib/fake-idb";

const shared = vi.hoisted(() => ({ idb: null as unknown as FakeIdb, uploads: [] as string[] }));

const saved = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  removeItem: (key: string) => void saved.delete(key),
});

vi.mock("idb", () => ({ openDB: async () => shared.idb.open() }));
vi.mock("somoto", () => ({ toast: { error: () => {} } }));
vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {}, waitForAccountSync: async () => {} }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false, ownerOf: (id?: string) => id }));
vi.mock("@/lib/cloud-storage", () => ({
  cloudEnabled: false,
  cloudHoldUps: () => new Map(),
  cloudUploads: () => new Set(),
  queueCloud: (name: string) => void shared.uploads.push(name),
}));

const { loadWorkspaces } = await import("@/lib/workspaces");
loadWorkspaces("user-1");
const { allPosts, hydrateCalendar, saving } = await import("@/components/calendar/store");
const { savePosts } = await import("./save");

const FULL = () => Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });

const planned = (id: string) => ({
  id,
  title: "With a video",
  caption: "Words",
  platforms: ["x" as const],
  when: new Date("2099-01-05T10:00:00Z"),
  status: "scheduled" as const,
  files: { shared: [new File(["video"], "video.mp4", { type: "video/mp4" })] },
});

const settled = async () => {
  while (saving()) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(async () => {
  shared.idb ??= new FakeIdb();
  shared.idb.failWrite = null;
  shared.uploads = [];
  await hydrateCalendar();
});

describe("a post this browser couldn't save", () => {
  test("a file there's no room for saves nothing, and says so", async () => {
    shared.idb.failWrite = (store) => (store === "media" ? FULL() : undefined);
    await expect(savePosts([planned("no-room")])).resolves.toMatch(/couldn't save/);
    await settled();
    expect(shared.idb.rows("events").some((row) => row.id === "no-room")).toBe(false);
    expect(allPosts().some((post) => post.id === "no-room")).toBe(false);
    expect(shared.uploads).toEqual([]);
  });

  test("a post that couldn't be written says so, and doesn't stay on the calendar", async () => {
    shared.idb.failWrite = (store) => (store === "events" ? FULL() : undefined);
    await expect(savePosts([planned("not-written")])).resolves.toMatch(/couldn't save/);
    await settled();
    expect(allPosts().some((post) => post.id === "not-written")).toBe(false);
    expect(shared.uploads).toEqual([]);
  });

  test("saved after all, the same post goes through with its file and no copy", async () => {
    shared.idb.failWrite = (store) => (store === "events" ? FULL() : undefined);
    const again = planned("second-try");
    await savePosts([again]);
    await settled();
    shared.idb.failWrite = null;
    await expect(savePosts([again])).resolves.toBeUndefined();
    await settled();
    const post = shared.idb.rows("events").filter((row) => row.id === "second-try");
    expect(post).toHaveLength(1);
    const [file] = post[0]!.files as string[];
    expect(shared.idb.rows("media").some((row) => row.id === file)).toBe(true);
    expect(shared.uploads).toContain(`posts:${file}`);
    expect(allPosts().filter((item) => item.id === "second-try")).toHaveLength(1);
  });
});
