/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {} }));
vi.mock("@/lib/guest", () => ({ ownerOf: (id?: string) => id }));
vi.mock("@/lib/plans", () => ({ accountsLimit: () => undefined }));
vi.mock("@/lib/publishing", () => ({ hasSecrets: () => false, saveLogin: async () => {}, withoutSecrets: (value: unknown) => value }));
vi.mock("@/lib/workspaces", () => ({
  activeScope: () => null,
  activeWorkspaceId: () => "w1",
  storageKeyFor: (base: string, id: string) => `${base}.${id}`,
  workspaceKey: (base: string, id: string) => `${base}.${id}`,
  workspaces: () => [],
}));

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { accountLabel, connectLinkedIn, connectSocial, connectionsFor, disconnectSocial } = await import("./social-connections");

const login = { ticket: "t", expiresAt: 1, scope: "" };
const USER = "u1";

beforeEach(() => {
  for (const account of connectionsFor("linkedin")) disconnectSocial(USER, account.id);
});

it("a person and the Pages they run are separate accounts, and each reconnects only itself", () => {
  expect(connectLinkedIn(USER, { handle: "Sam", personId: "p1", ...login })).toBeNull();
  expect(connectLinkedIn(USER, { handle: "Acme", organizationId: "1", ...login })).toBeNull();
  expect(connectLinkedIn(USER, { handle: "Beta", organizationId: "2", ...login })).toBeNull();
  const ids = connectionsFor("linkedin").map((account) => account.id);
  expect(connectionsFor("linkedin").map((account) => account.handle)).toEqual(["Sam", "Acme", "Beta"]);

  expect(connectLinkedIn(USER, { handle: "Acme Ltd", organizationId: "1", ...login, expiresAt: 2 })).toBeNull();
  expect(connectLinkedIn(USER, { handle: "Samantha", personId: "p1", ...login, expiresAt: 3 })).toBeNull();

  const accounts = connectionsFor("linkedin");
  expect(accounts.map((account) => account.id)).toEqual(ids);
  expect(accounts.map((account) => account.handle)).toEqual(["Samantha", "Acme Ltd", "Beta"]);
  expect(accounts.map((account) => account.linkedin?.expiresAt)).toEqual([3, 2, 1]);
  expect(accounts[1].linkedin).not.toHaveProperty("personId");
  expect(accounts[0].linkedin).not.toHaveProperty("organizationId");
});

it("a Page never takes over an account added by name", () => {
  expect(connectSocial(USER, "linkedin", "Sam")).toBeNull();
  expect(connectLinkedIn(USER, { handle: "Acme", organizationId: "1", ...login })).toBeNull();
  expect(connectionsFor("linkedin").map((account) => account.handle)).toEqual(["Sam", "Acme"]);
  expect(connectLinkedIn(USER, { handle: "Sam L", personId: "p1", ...login })).toBeNull();
  expect(connectionsFor("linkedin").map((account) => account.handle)).toEqual(["Sam L", "Acme"]);
});

it("a Page goes by its own name, and refuses a login that names nobody", () => {
  expect(accountLabel({ platform: "linkedin", handle: "Acme", linkedin: { organizationId: "1", ...login } })).toBe("Acme");
  expect(accountLabel({ platform: "linkedin", handle: "Sam", linkedin: { personId: "p", ...login } })).toBe("@Sam");
  expect(connectLinkedIn(USER, { handle: "Nobody", ...login })).not.toBeNull();
});
