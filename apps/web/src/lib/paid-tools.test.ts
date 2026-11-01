/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ scope: null as null | { owner: string; workspace: string }, guest: false }));

vi.mock("@/lib/account-sync-bus", () => ({ queueAccountSync: () => {} }));
vi.mock("@/lib/guest", () => ({ ownerOf: (id?: string) => id, inGuestMode: () => state.guest }));
vi.mock("@/lib/workspaces", () => ({ activeScope: () => state.scope, workspaceKey: (base: string, id: string) => `${base}.${id}` }));
vi.mock("@/lib/social-connections", () => ({ readChoices: () => ({}) }));

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { FREE_SCHEDULED_PER_ACCOUNT, setScheduledLimit } = await import("./plans");
const { allowedExport, paidToolsLocked } = await import("./paid-tools");
const { createTemplate, duplicateTemplate, emptyTemplate, loadTemplates, postTemplates, restoreTemplate, updateTemplate } = await import("./post-templates");
const { createVaultItem, duplicateVaultItem, loadVault, updateVaultItem, vaultItems } = await import("./vault");

const onFree = () => setScheduledLimit(FREE_SCHEDULED_PER_ACCOUNT);
const onPaid = () => setScheduledLimit(undefined);
const template = (name = "Launch") => ({ ...emptyTemplate(), name, caption: "Out now" });
const note = { kind: "caption" as const, title: "Sign-off", body: "See you tomorrow" };

beforeEach(() => {
  state.scope = null;
  state.guest = false;
  stored.clear();
  onPaid();
  loadTemplates("u1");
  loadVault("u1");
});

describe("what locks", () => {
  it("is open until the plan is known, then only on Free", () => {
    expect(paidToolsLocked()).toBe(false);
    onFree();
    expect(paidToolsLocked()).toBe(true);
    onPaid();
    expect(paidToolsLocked()).toBe(false);
  });

  it("stays open in a shared workspace, which is on its owner's plan", () => {
    onFree();
    state.scope = { owner: "o1", workspace: "w1" };
    expect(paidToolsLocked()).toBe(false);
  });
});

describe("templates", () => {
  it("can't be added or copied on Free", () => {
    const made = createTemplate(template());
    if ("error" in made) throw new Error(made.error);
    const count = postTemplates().length;
    onFree();
    expect(createTemplate(template("Another"))).toHaveProperty("error");
    expect(duplicateTemplate(made.id)).toHaveProperty("error");
    expect(postTemplates()).toHaveLength(count);
  });

  it("made before a downgrade can still be changed and brought back", () => {
    const made = createTemplate(template());
    if ("error" in made) throw new Error(made.error);
    const kept = postTemplates().find((item) => item.id === made.id)!;
    onFree();
    expect(updateTemplate(made.id, template("Renamed"))).toBeUndefined();
    expect(postTemplates().find((item) => item.id === made.id)?.name).toBe("Renamed");
    restoreTemplate(kept);
    expect(postTemplates().some((item) => item.id === made.id)).toBe(true);
  });

  it("can be added on Free in a shared workspace", () => {
    onFree();
    state.scope = { owner: "o1", workspace: "w1" };
    expect(createTemplate(template())).toHaveProperty("id");
  });
});

describe("the Vault", () => {
  it("can't take new items on Free", () => {
    const made = createVaultItem(note);
    if ("error" in made) throw new Error(made.error);
    const count = vaultItems().length;
    onFree();
    expect(createVaultItem({ ...note, title: "Another" })).toHaveProperty("error");
    expect(duplicateVaultItem(made.id)).toHaveProperty("error");
    expect(vaultItems()).toHaveLength(count);
  });

  it("keeps what's there after a downgrade, and it can still be changed", () => {
    const made = createVaultItem(note);
    if ("error" in made) throw new Error(made.error);
    onFree();
    expect(updateVaultItem(made.id, { ...note, title: "Renamed" })).toBeUndefined();
    expect(vaultItems().find((item) => item.id === made.id)?.title).toBe("Renamed");
  });
});

describe("export", () => {
  const at = (resolution: number) => ({ format: "mp4", video: { resolution, fps: 60, bitrate: 64e6 } });

  it("stops at 1080p on Free and keeps the frame rate", () => {
    onFree();
    expect(allowedExport(at(2160))?.video).toEqual({ resolution: 1080, fps: 60, bitrate: 64e6 });
    expect(allowedExport(at(1440))?.video?.resolution).toBe(1080);
  });

  it("leaves 1080p and below alone on Free", () => {
    onFree();
    expect(allowedExport(at(1080))?.video?.resolution).toBe(1080);
    expect(allowedExport(at(720))?.video?.resolution).toBe(720);
  });

  it("keeps 4K on a paid plan", () => {
    expect(allowedExport(at(2160))?.video?.resolution).toBe(2160);
  });

  it("holds a guest to 1080p", () => {
    state.guest = true;
    expect(allowedExport(at(2160))?.video?.resolution).toBe(1080);
  });

  it("doesn't lift the cap in a shared workspace, since projects are each person's own", () => {
    onFree();
    state.scope = { owner: "o1", workspace: "w1" };
    expect(allowedExport(at(2160))?.video?.resolution).toBe(1080);
  });
});
