/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ workspace: "one" }));

vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {} }));
vi.mock("@/lib/guest", () => ({ ownerOf: (id: string | undefined) => id }));
vi.mock("@/lib/workspaces", () => ({ workspaceKey: (base: string, user: string) => `${base}.${user}.${scope.workspace}` }));

import { addQueueSlots, clearQueueSlots, firstOpenBySlot, loadQueueSlots, openQueueTimes, queueSlots, reloadQueueSlots, type QueueSlot } from "./queue-slots";
import { clockAt, dayKeyAt } from "./time-zone";

const USER = "user";
const monday: QueueSlot = { id: "monday", weekday: 1, time: "09:00" };
const tuesdayNine: QueueSlot = { id: "tuesday-nine", weekday: 2, time: "09:00" };
const tuesdayTen: QueueSlot = { id: "tuesday-ten", weekday: 2, time: "10:00" };
const from = new Date(2026, 10, 1, 12); // Sunday
const until = new Date(2026, 11, 31);

const openDays = (taken: (day: string, time: string) => boolean) => {
  const list = [monday, tuesdayNine];
  const first = firstOpenBySlot(openQueueTimes(Infinity, { from, until, list, taken }), list);
  const day = (id: string) => first.get(id) && dayKeyAt(first.get(id)!);
  return { monday: day("monday"), tuesday: day("tuesday-nine") };
};

describe("filling the queue", () => {
  it("takes the times on one day in order, then the same times a week later", () => {
    const times = openQueueTimes(4, { from, until, list: [tuesdayNine, tuesdayTen], taken: () => false });
    expect(times.map((at) => `${dayKeyAt(at)} ${clockAt(at)}`)).toEqual(["2026-11-03 09:00", "2026-11-03 10:00", "2026-11-10 09:00", "2026-11-10 10:00"]);
  });

  it("skips a time a post holds", () => {
    const times = openQueueTimes(1, { from, until, list: [tuesdayNine, tuesdayTen], taken: (day, time) => day === "2026-11-03" && time === "09:00" });
    expect(times.map((at) => clockAt(at))).toEqual(["10:00"]);
  });
});

describe("a slot's next open date", () => {
  it("is the coming one when nothing holds it", () => {
    expect(openDays(() => false)).toEqual({ monday: "2026-11-02", tuesday: "2026-11-03" });
  });

  it("moves past each week a post holds", () => {
    const held = new Set(["2026-11-02 09:00", "2026-11-09 09:00"]);
    expect(openDays((day, time) => held.has(`${day} ${time}`))).toEqual({ monday: "2026-11-16", tuesday: "2026-11-03" });
  });

  it("is left out when posts hold every week up to the limit", () => {
    expect(openDays((day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 2)).toEqual({ monday: "2026-11-02", tuesday: undefined });
  });
});

describe("clearing the queue", () => {
  beforeEach(() => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) });
    scope.workspace = "one";
    reloadQueueSlots(USER);
    addQueueSlots(USER, [1, 3], "09:00");
  });

  const shown = () => queueSlots().map((slot) => `${slot.weekday} ${slot.time}`);

  it("undoes, keeping a time added since without doubling one added again", () => {
    const undo = clearQueueSlots(USER);
    expect(shown()).toEqual([]);
    addQueueSlots(USER, [1], "09:00");
    addQueueSlots(USER, [5], "12:00");
    undo();
    expect(shown()).toEqual(["1 09:00", "3 09:00", "5 12:00"]);
  });

  it("leaves another workspace alone when undone after switching", () => {
    const undo = clearQueueSlots(USER);
    scope.workspace = "two";
    loadQueueSlots(USER);
    undo();
    expect(shown()).toEqual([]);
    scope.workspace = "one";
    loadQueueSlots(USER);
    expect(shown()).toEqual([]);
  });
});
