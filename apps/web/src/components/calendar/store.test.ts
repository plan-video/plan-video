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
const person = { approves: true, mustAsk: false };
vi.mock("@/lib/approval-state", async (actual) => ({
  ...(await actual<typeof import("@/lib/approval-state")>()),
  canApprove: () => person.approves,
  mustAskForApproval: () => person.mustAsk,
}));

const { reloadAccountGroups } = await import("@/lib/account-groups");
const { loadSocialConnections } = await import("@/lib/social-connections");
const { workspaceKey } = await import("@/lib/workspaces");
const { accountFilter, goesOutFromPicked, groupFilter, setAccountFilter, setGroupFilter, withApprovalRules } = await import("./store");
type StoredEvent = import("./types").StoredEvent;

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

describe("scheduling a post that needs approval", () => {
  const AT = "2026-11-26T12:00:00.000Z";
  const post = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
    allDay: false,
    calendarId: "posts",
    createdAt: AT,
    day: "2026-11-30",
    description: "Hello",
    duration: 30,
    id: "p1",
    link: null,
    platforms: ["x"],
    recurrence: null,
    recurrenceExceptions: [],
    start: "09:00",
    status: "scheduled",
    title: "Hello",
    ...overrides,
  });
  const pending = { state: "pending" as const, at: AT, by: "Sam" };

  beforeEach(() => {
    person.approves = true;
    person.mustAsk = false;
  });

  it("approves it when an owner or admin schedules it, so it doesn't sit waiting past its time", () => {
    const next = withApprovalRules(post({ status: "draft", approval: pending }), post({ approval: pending }), AT);
    expect(next.status).toBe("scheduled");
    expect(next.approval).toEqual({ state: "approved", via: "team", at: AT });
  });

  it("keeps a member's post waiting when they schedule one that waits", () => {
    person.approves = false;
    const next = withApprovalRules(post({ status: "draft", approval: pending }), post({ approval: pending }), AT);
    expect(next.status).toBe("draft");
    expect(next.approval).toEqual(pending);
  });

  it("holds a member's new or changed post for approval where members need it", () => {
    person.approves = false;
    person.mustAsk = true;
    const made = withApprovalRules(undefined, post(), AT);
    expect(made).toMatchObject({ status: "draft", approval: { state: "pending", at: AT }, sendFrom: AT });

    const changed = withApprovalRules(post(), post({ description: "Changed" }), AT);
    expect(changed).toMatchObject({ status: "draft", approval: { state: "pending" } });
  });

  it("leaves a member's scheduled post alone when only its sends changed", () => {
    person.approves = false;
    person.mustAsk = true;
    const going = post({ deliveries: { x: { state: "sending", attempts: 1, at: AT } }, sendFrom: AT, timeZone: "Europe/Amsterdam" });
    expect(withApprovalRules(post(), going, AT)).toBe(going);
  });

  it("lets members schedule as before where members don't need approval", () => {
    person.approves = false;
    const next = post();
    expect(withApprovalRules(undefined, next, AT)).toBe(next);
  });
});
