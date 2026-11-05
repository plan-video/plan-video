/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, test, vi } from "vitest";

import { FakeIdb } from "@/lib/fake-idb";

import type { AccountMedia } from "./store";
import type { StoredEvent } from "./types";

const shared = vi.hoisted(() => ({ idb: null as unknown as FakeIdb }));

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
  cloudEnabled: true,
  cloudHoldUps: () => new Map(),
  cloudUploads: () => new Set(),
  queueCloud: () => {},
  cloudReadUrl: async ({ id }: { id: string }) => `https://files.test/${id}`,
}));

const USER = "user-1";
const { DEFAULT_WORKSPACE, loadWorkspaces } = await import("@/lib/workspaces");
loadWorkspaces(USER);
const { postFilesFetched, readCalendarSnapshot, writeWorkspacePosts } = await import("./store");

const post = (id: string, files: string[]) =>
  ({ id, title: id, description: null, day: "2099-01-05", start: "10:00", allDay: false, duration: 15, calendarId: "posts", createdAt: "2026-11-05T08:00:00.000Z", link: null, platforms: ["x"], recurrence: null, recurrenceExceptions: [], status: "scheduled", files }) as StoredEvent;

const listing = (id: string): AccountMedia => ({ id, name: `${id}.mp4`, type: "video/mp4", lastModified: 1, cloud: { key: `posts/u/${id}`, at: "2026-11-05T08:00:00Z" } });

const write = (events: StoredEvent[], media: AccountMedia[], read?: Parameters<typeof writeWorkspacePosts>[3]) => writeWorkspacePosts(USER, DEFAULT_WORKSPACE, { events, media }, read);

const filesHere = () => shared.idb.rows("media").map((row) => row.id);

const asked: string[] = [];
let answer: (url: string) => Promise<Response>;

beforeEach(() => {
  shared.idb ??= new FakeIdb();
  shared.idb.stores.clear();
  shared.idb.failWrite = null;
  asked.length = 0;
  answer = async () => new Response("video");
  vi.stubGlobal("fetch", (url: string) => {
    asked.push(url.slice(url.lastIndexOf("/") + 1));
    return answer(url);
  });
});

describe("a post's files from another device", () => {
  test("a sync's write doesn't wait for them", async () => {
    let arrive = (_: Response) => {};
    answer = () => new Promise((resolve) => (arrive = resolve));
    await write([post("p1", ["p1_a"])], [listing("p1_a")]);
    expect(shared.idb.rows("events").map((row) => row.id)).toEqual(["p1"]);
    expect(filesHere()).toEqual([]);
    while (!asked.length) await new Promise((resolve) => setImmediate(resolve));
    arrive(new Response("video"));
    await postFilesFetched();
    expect(filesHere()).toEqual(["p1_a"]);
  });

  test("each is kept as it arrives, so one that fails loses none before it", async () => {
    answer = async (url) => (url.endsWith("p2_b") ? new Response(null, { status: 500 }) : new Response("video"));
    await write([post("p1", ["p1_a"]), post("p2", ["p2_b"]), post("p3", ["p3_c"])], ["p1_a", "p2_b", "p3_c"].map(listing));
    await postFilesFetched();
    expect(filesHere().sort()).toEqual(["p1_a", "p3_c"]);
    asked.length = 0;
    answer = async () => new Response("video");
    await write([post("p1", ["p1_a"]), post("p2", ["p2_b"]), post("p3", ["p3_c"])], ["p1_a", "p2_b", "p3_c"].map(listing));
    await postFilesFetched();
    expect(asked).toEqual(["p2_b"]);
    expect(filesHere().sort()).toEqual(["p1_a", "p2_b", "p3_c"]);
  });

  test("with no room left it stops, keeps what it has, and a later sync goes on", async () => {
    shared.idb.failWrite = (store, value) => (store === "media" && (value as { id: string }).id === "p2_b" ? new Error("The quota has been exceeded.") : undefined);
    const events = [post("p1", ["p1_a"]), post("p2", ["p2_b"]), post("p3", ["p3_c"])];
    await write(events, ["p1_a", "p2_b", "p3_c"].map(listing));
    await postFilesFetched();
    expect(filesHere()).toEqual(["p1_a"]);
    expect(asked).toEqual(["p1_a", "p2_b"]);
    shared.idb.failWrite = null;
    await write(events, ["p1_a", "p2_b", "p3_c"].map(listing));
    await postFilesFetched();
    expect(filesHere().sort()).toEqual(["p1_a", "p2_b", "p3_c"]);
  });

  test("a post deleted while its file was on the way doesn't keep it", async () => {
    let arrive = (_: Response) => {};
    answer = () => new Promise((resolve) => (arrive = resolve));
    await write([post("p1", ["p1_a"])], [listing("p1_a")]);
    while (!asked.length) await new Promise((resolve) => setImmediate(resolve));
    shared.idb.stores.get("events")?.delete("p1");
    arrive(new Response("video"));
    await postFilesFetched();
    expect(filesHere()).toEqual([]);
  });

  test("a file deleted here since the sync read this browser's copy isn't fetched back", async () => {
    await write([post("p1", ["p1_a"])], [listing("p1_a")]);
    await postFilesFetched();
    const snapshot = await readCalendarSnapshot(USER, DEFAULT_WORKSPACE);
    shared.idb.stores.get("media")?.delete("p1_a");
    asked.length = 0;
    await write([post("p1", ["p1_a"])], [listing("p1_a")], snapshot!.read);
    await postFilesFetched();
    expect(asked).toEqual([]);
    expect(filesHere()).toEqual([]);
  });
});
