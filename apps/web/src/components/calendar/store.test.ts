/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => void saved.set(key, value),
  removeItem: (key: string) => void saved.delete(key),
});

vi.mock("idb", () => ({ openDB: vi.fn() }));
vi.mock("somoto", () => ({ toast: {} }));
vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {}, waitForAccountSync: async () => {} }));
vi.mock("@/lib/cloud-storage", () => ({ cloudEnabled: () => false, cloudHoldUps: () => [] }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false, ownerOf: (id?: string) => id }));

const { reloadAccountGroups } = await import("@/lib/account-groups");
const { loadSocialConnections } = await import("@/lib/social-connections");
const { workspaceKey } = await import("@/lib/workspaces");
const { accountFilter, goesOutFromPicked, groupFilter, setAccountFilter, setGroupFilter } = await import("./store");

const USER = "user-1";
const X_IN_GROUP = { id: "x-in-group", platform: "x", handle: "brand" };
const X_OUTSIDE = { id: "x-outside", platform: "x", handle: "personal" };
const YOUTUBE_IN_GROUP = { id: "youtube-in-group", platform: "youtube", handle: "brand" };
const GROUP = { id: "brand", name: "Brand", accounts: [X_IN_GROUP.id, YOUTUBE_IN_GROUP.id], createdAt: "2026-11-01T10:00:00.000Z" };

function connect(accounts: object[], groups: object[] = [GROUP]) {
  saved.set(workspaceKey("plan.video.connections", USER), JSON.stringify(accounts));
  saved.set(workspaceKey("plan.video.groups", USER), JSON.stringify(groups));
  loadSocialConnections(undefined);
  loadSocialConnections(USER);
  reloadAccountGroups(USER);
}

describe("the picked group", () => {
  beforeEach(() => {
    connect([X_IN_GROUP, X_OUTSIDE, YOUTUBE_IN_GROUP]);
    setAccountFilter(null);
  });

  it("keeps posts going to any of its accounts", () => {
    setGroupFilter(GROUP.id);
    expect(goesOutFromPicked({ platforms: ["x"], accounts: { x: [X_IN_GROUP.id] } })).toBe(true);
    expect(goesOutFromPicked({ platforms: ["youtube"], accounts: { youtube: [YOUTUBE_IN_GROUP.id] } })).toBe(true);
  });

  it("leaves out a post on the same network from an account outside it", () => {
    setGroupFilter(GROUP.id);
    expect(goesOutFromPicked({ platforms: ["x"], accounts: { x: [X_OUTSIDE.id] } })).toBe(false);
  });

  it("replaces a picked account, and a picked account replaces it", () => {
    setAccountFilter(X_OUTSIDE.id);
    setGroupFilter(GROUP.id);
    expect(accountFilter()).toBeNull();
    expect(groupFilter()?.id).toBe(GROUP.id);

    setAccountFilter(X_OUTSIDE.id);
    expect(groupFilter()).toBeNull();
    expect(accountFilter()).toBe(X_OUTSIDE.id);
  });

  it("shows every post again once none of its accounts is connected", () => {
    setGroupFilter(GROUP.id);
    connect([X_OUTSIDE]);
    expect(groupFilter()).toBeNull();
    expect(goesOutFromPicked({ platforms: ["x"], accounts: { x: [X_OUTSIDE.id] } })).toBe(true);
  });

  it("shows every post again once the group is deleted", () => {
    setGroupFilter(GROUP.id);
    connect([X_IN_GROUP, X_OUTSIDE, YOUTUBE_IN_GROUP], []);
    expect(groupFilter()).toBeNull();
    expect(goesOutFromPicked({ platforms: ["x"], accounts: { x: [X_OUTSIDE.id] } })).toBe(true);
  });
});
