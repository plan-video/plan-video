/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { socialConnections, type AccountChoices, type SocialConnection } from "@/lib/social-connections";
import { workspaceKey } from "@/lib/workspaces";

export type AccountGroup = {
  id: string;
  name: string;
  /** Any number per platform. */
  accounts: string[];
  createdAt: string;
};

const [groups, setGroups] = createSignal<AccountGroup[]>([]);
let loadedKey: string | undefined;

export { groups as accountGroups };

function isGroup(value: unknown): value is AccountGroup {
  if (!value || typeof value !== "object") return false;
  const row = value as AccountGroup;
  return typeof row.id === "string" && typeof row.name === "string" && Array.isArray(row.accounts);
}

/** `loadAccountGroups` does nothing when this key is already loaded. */
export function reloadAccountGroups(userId: string | undefined) {
  loadedKey = undefined;
  loadAccountGroups(userId);
}

/** Reads the active workspace, so calling this in an effect reloads after a switch. */
export function loadAccountGroups(userId: string | undefined) {
  // A guest has the demo's (see lib/guest.ts).
  userId = ownerOf(userId);
  if (!userId) {
    loadedKey = undefined;
    setGroups([]);
    return;
  }
  const key = workspaceKey("plan.video.groups", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setGroups(Array.isArray(parsed) ? parsed.filter(isGroup) : []);
  } catch {
    setGroups([]);
  }
}

function write(update: (current: AccountGroup[]) => AccountGroup[]) {
  if (!loadedKey) return;
  setGroups(update);
  try {
    localStorage.setItem(loadedKey, JSON.stringify(groups()));
  } catch {
    // Storage full or blocked: the change holds until the page reloads.
    return;
  }
  queueAccountSync();
}

/** Only those still connected, in the order they were connected. */
export function groupAccounts(group: AccountGroup): SocialConnection[] {
  const ids = new Set(group.accounts);
  return socialConnections().filter((account) => ids.has(account.id));
}

export function groupSelection(group: AccountGroup): { platforms: string[]; accounts: AccountChoices } {
  const accounts: Record<string, string[]> = {};
  for (const account of groupAccounts(group)) (accounts[account.platform] ??= []).push(account.id);
  return { platforms: Object.keys(accounts), accounts };
}

function connectedOnly(ids: readonly string[]): string[] {
  const connected = new Set(socialConnections().map((row) => row.id));
  return [...new Set(ids)].filter((id) => connected.has(id));
}

function validate(name: string, accounts: readonly string[], except?: string): string | { name: string; accounts: string[] } {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!clean) return t("Give the group a name.");
  if (groups().some((group) => group.id !== except && group.name.toLowerCase() === clean.toLowerCase())) return t("A group already has that name.");
  const picked = connectedOnly(accounts);
  if (!picked.length) return t("Pick at least one account.");
  return { name: clean, accounts: picked };
}

export function createAccountGroup(userId: string, draft: { name: string; accounts: readonly string[] }): string | undefined {
  loadAccountGroups(userId);
  const result = validate(draft.name, draft.accounts);
  if (typeof result === "string") return result;
  write((current) => [...current, { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...result }]);
}

export function updateAccountGroup(userId: string, id: string, draft: { name: string; accounts: readonly string[] }): string | undefined {
  loadAccountGroups(userId);
  const result = validate(draft.name, draft.accounts, id);
  if (typeof result === "string") return result;
  write((current) => current.map((group) => (group.id === id ? { ...group, ...result } : group)));
}

export function deleteAccountGroup(userId: string, id: string) {
  loadAccountGroups(userId);
  write((current) => current.filter((group) => group.id !== id));
}

export function restoreAccountGroup(userId: string, group: AccountGroup, index: number) {
  loadAccountGroups(userId);
  write((current) => (current.some((row) => row.id === group.id) ? current : [...current.slice(0, index), group, ...current.slice(index)]));
}
