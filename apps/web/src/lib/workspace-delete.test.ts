/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, test, vi } from "vitest";

const steps: string[] = [];
let flushes: boolean[] = [];

vi.mock("@/components/calendar/store", () => ({ everyFileOf: () => [], readCalendarSnapshot: async () => ({ events: [], media: [] }) }));
vi.mock("@/lib/account-sync", () => ({
  flushAccountSync: async () => {
    steps.push("flush");
    return flushes.shift() ?? true;
  },
  readSlice: async () => ({ connections: [], library: [] }),
}));
vi.mock("@/lib/cloud-storage", () => ({ deleteFromCloud: async () => {}, queueCloud: () => {} }));
vi.mock("@/lib/guest", () => ({ inGuestMode: () => false }));
vi.mock("@/lib/i18n", () => ({ t: (text: string) => text }));
vi.mock("@/lib/media-library", () => ({ posterId: (id: string) => id }));
vi.mock("@/lib/publishing", () => ({ forgetLogin: async () => {} }));
vi.mock("@/lib/post-sync", () => ({ flushAllPosts: async () => true }));
vi.mock("@/lib/workspace-leftovers", () => ({ leftoversOf: () => ({ logins: [], postFiles: [], libraryFiles: [] }) }));
vi.mock("@/lib/workspaces", () => ({
  deleteWorkspace: async () => {
    steps.push("delete");
  },
  workspaces: () => [],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async () => {
      steps.push("forget");
      return { error: null };
    },
  },
}));

const { deleteWorkspaceEverywhere } = await import("./workspace-delete");

beforeEach(() => {
  steps.length = 0;
  flushes = [];
});

describe("deleting a workspace", () => {
  test("clears it from the server only after the account has saved without it", async () => {
    await deleteWorkspaceEverywhere("u1", "w1");
    expect(steps).toEqual(["flush", "delete", "flush", "forget"]);
  });

  test("tries the save again rather than clearing it while the account still lists it", async () => {
    flushes = [true, false, true];
    await deleteWorkspaceEverywhere("u1", "w1");
    expect(steps).toEqual(["flush", "delete", "flush", "flush", "forget"]);
  });
});
