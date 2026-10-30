/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The words a creator reuses across posts: whole captions, hashtag sets, and
// shorter snippets such as a call to action or a sign-off. Saved on the
// account, one list per workspace.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { msg, t } from "@/lib/i18n";
import { workspaceKey } from "@/lib/workspaces";

export type VaultKind = "caption" | "hashtags" | "snippet";

export type VaultItem = {
  id: string;
  kind: VaultKind;
  title: string;
  body: string;
  pinned: boolean;
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VaultDraft = Pick<VaultItem, "kind" | "title" | "body">;

export const VAULT_KINDS: readonly { id: VaultKind; label: string; singular: string; hint: string }[] = [
  { id: "caption", label: msg({ message: "Captions", context: "posts' text, not video subtitles" }), singular: msg("Caption"), hint: msg("Whole captions you post again, or start from.") },
  { id: "hashtags", label: msg("Hashtags"), singular: msg("Hashtag set"), hint: msg("Groups of hashtags for a topic or a platform.") },
  { id: "snippet", label: msg("Snippets"), singular: msg("Snippet"), hint: msg("Calls to action, sign-offs, links and mentions.") },
];

export function vaultKind(id: VaultKind) {
  return VAULT_KINDS.find((kind) => kind.id === id)!;
}

const KIND_IDS = new Set<string>(VAULT_KINDS.map((kind) => kind.id));

const [items, setItems] = createSignal<VaultItem[]>([]);
/** The item every caption ends with, by id. One per workspace, like the items. */
const [signatureId, setSignatureId] = createSignal<string | null>(null);
/** The storage key the shown items came from: the user's, in the active workspace. */
let loadedKey: string | undefined;

export { items as vaultItems };

const signatureKey = (key: string) => key.replace("plan.video.vault", "plan.video.signature");

/** The vault item set as the signature, while it still exists. */
export function vaultSignature(): VaultItem | null {
  const id = signatureId();
  return (id && items().find((item) => item.id === id)) || null;
}

export function setVaultSignature(id: string | null) {
  if (!loadedKey) return;
  setSignatureId(id);
  try {
    if (id) localStorage.setItem(signatureKey(loadedKey), id);
    else localStorage.removeItem(signatureKey(loadedKey));
  } catch {
    // Storage blocked: the choice holds until the page reloads.
    return;
  }
  queueAccountSync();
}

/** Text with the signature at the end, once. */
export function appendSignature(text: string, signature: string | undefined): string {
  const body = signature?.trim();
  if (!body) return text;
  const base = text.replace(/\s+$/, "");
  if (base.endsWith(body)) return text;
  return base ? `${base}\n\n${body}` : body;
}

function isItem(value: unknown): value is VaultItem {
  if (!value || typeof value !== "object") return false;
  const row = value as VaultItem;
  return typeof row.id === "string" && KIND_IDS.has(row.kind) && typeof row.title === "string" && typeof row.body === "string";
}

/** Reads the account copy again. `loadVault` does nothing when this key is already loaded. */
export function reloadVault(userId: string | undefined) {
  loadedKey = undefined;
  loadVault(userId);
}

/** Reads the active workspace, so a load inside an effect reloads after a switch. */
export function loadVault(userId: string | undefined) {
  // A guest has the demo's (see lib/guest.ts).
  userId = ownerOf(userId);
  if (!userId) {
    loadedKey = undefined;
    setItems([]);
    setSignatureId(null);
    return;
  }
  const key = workspaceKey("plan.video.vault", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    setSignatureId(localStorage.getItem(signatureKey(key)));
  } catch {
    setSignatureId(null);
  }
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setItems(
      Array.isArray(parsed)
        ? parsed.filter(isItem).map((row) => ({ ...row, pinned: !!row.pinned, uses: row.uses || 0, lastUsedAt: row.lastUsedAt ?? null }))
        : [],
    );
  } catch {
    setItems([]);
  }
}

function write(update: (current: VaultItem[]) => VaultItem[]) {
  const key = loadedKey;
  if (!key) return false;
  setItems(update);
  try {
    localStorage.setItem(key, JSON.stringify(items()));
  } catch {
    return false;
  }
  queueAccountSync();
  return true;
}

/** `#a #b`, from `a, #b  a`: one # each, no repeats, spaces between. */
export function normalizeHashtags(text: string): string {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const word = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    tags.push(`#${word}`);
  }
  return tags.join(" ");
}

function clean(draft: VaultDraft): VaultDraft {
  const body = draft.kind === "hashtags" ? normalizeHashtags(draft.body) : draft.body.trim();
  return { kind: draft.kind, title: draft.title.trim() || fallbackTitle(body), body };
}

/** The first line, cut to a title's length. */
export function fallbackTitle(body: string): string {
  const line = body.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return t("Untitled");
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

/** Returns the new item's id, or an error for the user. */
export function createVaultItem(draft: VaultDraft): { id: string } | { error: string } {
  const next = clean(draft);
  if (!next.body) return { error: draft.kind === "hashtags" ? t("Add at least one hashtag.") : t("Write something to keep.") };
  const now = new Date().toISOString();
  const item: VaultItem = { ...next, id: crypto.randomUUID(), pinned: false, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
  if (!write((current) => [item, ...current])) return { error: t("The vault could not be saved in this browser.") };
  return { id: item.id };
}

export function updateVaultItem(id: string, draft: VaultDraft): string | undefined {
  const next = clean(draft);
  if (!next.body) return draft.kind === "hashtags" ? t("Add at least one hashtag.") : t("Write something to keep.");
  const now = new Date().toISOString();
  if (!write((current) => current.map((item) => (item.id === id ? { ...item, ...next, updatedAt: now } : item)))) {
    return t("The vault could not be saved in this browser.");
  }
}

export function duplicateVaultItem(id: string) {
  const source = items().find((item) => item.id === id);
  if (!source) return;
  return createVaultItem({ kind: source.kind, title: t("{name} copy", { name: source.title }), body: source.body });
}

export function deleteVaultItem(id: string) {
  write((current) => current.filter((item) => item.id !== id));
}

export function restoreVaultItem(item: VaultItem) {
  write((current) => (current.some((row) => row.id === item.id) ? current : [item, ...current]));
}

export function toggleVaultPin(id: string) {
  write((current) => current.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)));
}

export function markVaultUsed(id: string) {
  const now = new Date().toISOString();
  write((current) => current.map((item) => (item.id === id ? { ...item, uses: item.uses + 1, lastUsedAt: now } : item)));
}

/** Pinned first, then the ones used or edited most recently. */
export function sortVault(list: readonly VaultItem[]): VaultItem[] {
  const recency = (item: VaultItem) => (item.lastUsedAt && item.lastUsedAt > item.updatedAt ? item.lastUsedAt : item.updatedAt);
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || recency(b).localeCompare(recency(a)));
}

export function searchVault(list: readonly VaultItem[], query: string, kind: VaultKind | "all" = "all"): VaultItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sortVault(
    list.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      const text = `${item.title}\n${item.body}`.toLowerCase();
      return words.every((word) => text.includes(word));
    }),
  );
}

/**
 * Text with an item added at the end. Hashtags already in the text are left
 * out, so a set can be added twice without repeating a tag.
 */
export function insertVaultText(text: string, item: VaultItem): string {
  let body = item.body;
  if (item.kind === "hashtags") {
    const present = new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((tag) => tag.toLowerCase()));
    body = body
      .split(/\s+/)
      .filter((tag) => tag && !present.has(tag.toLowerCase()))
      .join(" ");
  }
  if (!body) return text;
  const base = text.replace(/\s+$/, "");
  return base ? `${base}\n\n${body}` : body;
}

// The New post page opens with a vault item already in its caption when one
// is waiting here.
const [pendingInsert, setPendingInsert] = createSignal<VaultItem | null>(null);

export function queueVaultInsert(item: VaultItem) {
  setPendingInsert(item);
}

export function takeVaultInsert(): VaultItem | null {
  const item = pendingInsert();
  setPendingInsert(null);
  return item;
}
