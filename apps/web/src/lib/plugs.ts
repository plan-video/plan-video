/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Rules that act on a post after it goes out: once it has enough likes,
// repost it, or reply under it with a plug. One of each per account. Saved on
// the account, one list per workspace; the publisher carries them out on the
// server (services/publisher/plugs.mjs).

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { BLUESKY_TEXT_LIMIT, blueskyLength } from "@/lib/bluesky";
import { ownerOf } from "@/lib/guest";
import { msg, t } from "@/lib/i18n";
import { workspaceKey } from "@/lib/workspaces";

export type PlugKind = "auto-repost" | "auto-plug";

export type PlugDefinition = {
  id: PlugKind;
  title: string;
  description: string;
  /** Whether the plug has a message to post. */
  message: boolean;
};

export const PLUGS: Record<PlugKind, PlugDefinition> = {
  "auto-repost": {
    id: "auto-repost",
    title: msg("Auto repost"),
    description: msg("When a post reaches a set number of likes, repost it so more people see it."),
    message: false,
  },
  "auto-plug": {
    id: "auto-plug",
    title: msg("Auto plug"),
    description: msg("When a post reaches a set number of likes, reply under it with a plug, so your followers get a notification about what you're promoting."),
    message: true,
  },
};

/**
 * The plugs each network runs. A network joins once plan.video posts to it and
 * can read a post's likes, with its steps in services/publisher/plugs.mjs: X is next.
 * LinkedIn doesn't let apps read likes, and Threads has no reposting.
 */
export const PLUGS_BY_PLATFORM: Partial<Record<string, readonly PlugKind[]>> = {
  bluesky: ["auto-repost", "auto-plug"],
};

/** The longest plug reply each network takes, and how it counts. */
const REPLY_LIMITS: Partial<Record<string, { max: number; length(text: string): number }>> = {
  bluesky: { max: BLUESKY_TEXT_LIMIT, length: blueskyLength },
};

export const PLUG_PLATFORMS = Object.keys(PLUGS_BY_PLATFORM);

/** How often a post is checked after it goes out, and how many times (lib/plug-timing.ts, free of the browser for the build). */
export { PLUG_CHECK_HOURS, PLUG_CHECKS } from "./plug-timing";

export type PlugSetting = {
  /** `accountId:kind`, so an account has one of each and two browsers agree on it. */
  id: string;
  accountId: string;
  kind: PlugKind;
  likes: number;
  message: string;
  activated: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PlugDraft = { likes: string; message: string };

const [items, setItems] = createSignal<PlugSetting[]>([]);
/** The storage key the shown plugs came from: the user's, in the active workspace. */
let loadedKey: string | undefined;

export { items as plugSettings };

export const plugId = (accountId: string, kind: PlugKind) => `${accountId}:${kind}`;

export function plugFor(accountId: string, kind: PlugKind): PlugSetting | undefined {
  return items().find((item) => item.id === plugId(accountId, kind));
}

function readPlug(value: unknown): PlugSetting | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PlugSetting>;
  if (typeof row.accountId !== "string" || (row.kind !== "auto-repost" && row.kind !== "auto-plug")) return null;
  const now = new Date(0).toISOString();
  return {
    id: plugId(row.accountId, row.kind),
    accountId: row.accountId,
    kind: row.kind,
    likes: typeof row.likes === "number" && row.likes > 0 ? Math.floor(row.likes) : 1,
    message: typeof row.message === "string" ? row.message : "",
    activated: row.activated !== false,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
  };
}

/** Reads the account copy again. `loadPlugs` does nothing when this key is already loaded. */
export function reloadPlugs(userId: string | undefined) {
  loadedKey = undefined;
  loadPlugs(userId);
}

/** Reads the active workspace, so a load inside an effect reloads after a switch. */
export function loadPlugs(userId: string | undefined) {
  // A guest has the demo's (see lib/guest.ts).
  userId = ownerOf(userId);
  if (!userId) {
    loadedKey = undefined;
    setItems([]);
    return;
  }
  const key = workspaceKey("plan.video.plugs", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setItems(Array.isArray(parsed) ? parsed.map(readPlug).filter((row): row is PlugSetting => !!row) : []);
  } catch {
    setItems([]);
  }
}

function write(update: (current: PlugSetting[]) => PlugSetting[]) {
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

/** What is wrong with the fields, by field, or nothing. */
export function plugProblems(kind: PlugKind, draft: PlugDraft, platform: string): Partial<Record<keyof PlugDraft, string>> {
  const problems: Partial<Record<keyof PlugDraft, string>> = {};
  if (!/^\d+$/.test(draft.likes.trim()) || Number(draft.likes) < 1) problems.likes = t("Enter a whole number of likes, 1 or more.");
  const limit = REPLY_LIMITS[platform];
  if (PLUGS[kind].message && draft.message.trim().length < 3) problems.message = t("Write at least 3 characters.");
  else if (PLUGS[kind].message && limit && limit.length(draft.message.trim()) > limit.max) problems.message = t("Keep it to {count, plural, one {# character} other {# characters}}.", { count: limit.max });
  return problems;
}

/** Saves the plug and turns it on. Returns an error for the user. */
export function savePlug(accountId: string, platform: string, kind: PlugKind, draft: PlugDraft): string | undefined {
  if (Object.keys(plugProblems(kind, draft, platform)).length) return t("Check the fields above.");
  const now = new Date().toISOString();
  const id = plugId(accountId, kind);
  // A new plug starts on. An edit leaves it on or off as it was.
  const activated = plugFor(accountId, kind)?.activated ?? true;
  const fields = { likes: Number(draft.likes), message: PLUGS[kind].message ? draft.message.trim() : "", activated, updatedAt: now };
  const saved = write((current) =>
    current.some((item) => item.id === id)
      ? current.map((item) => (item.id === id ? { ...item, ...fields } : item))
      : [...current, { id, accountId, kind, createdAt: now, ...fields }],
  );
  if (!saved) return t("The plug could not be saved in this browser.");
}

export function setPlugActivated(id: string, activated: boolean) {
  const now = new Date().toISOString();
  write((current) => current.map((item) => (item.id === id ? { ...item, activated, updatedAt: now } : item)));
}
