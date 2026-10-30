/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A post set up once and started from again: where it goes, the caption,
// what each platform gets of its own, and when it goes out. The media is
// left out, since that changes every time. Saved on the account, one list
// per workspace, like the vault.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { PLATFORM_IDS, defaultPlatformSettings, type PlatformId, type PlatformSettings } from "@/lib/social";
import { readChoices, type AccountChoices } from "@/lib/social-connections";
import { keptThread, type ThreadReply } from "@/lib/thread";
import { workspaceKey } from "@/lib/workspaces";

/** `none` leaves the time to the post, `queue` takes the next queue slot, `time` goes out at `time`. */
export type TemplateWhen = "none" | "queue" | "time";

export type PostTemplate = {
  id: string;
  name: string;
  platforms: PlatformId[];
  accounts: AccountChoices;
  caption: string;
  /** Captions a platform has of its own, instead of the shared one. */
  overrides: Partial<Record<PlatformId, string>>;
  settings: PlatformSettings;
  /** Whether the vault signature goes at the end of the caption. */
  signature: boolean;
  /** Follow-ups posted under each post made from it. */
  thread: ThreadReply[];
  when: TemplateWhen;
  /** `HH:MM`, when `when` is `time`. */
  time: string;
  /** How a post made from it repeats, as the calendar keeps it. `""` for once. */
  repeat: string;
  pinned: boolean;
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TemplateDraft = Pick<PostTemplate, "name" | "platforms" | "accounts" | "caption" | "overrides" | "settings" | "signature" | "thread" | "when" | "time" | "repeat">;

const [items, setItems] = createSignal<PostTemplate[]>([]);
/** The storage key the shown templates came from: the user's, in the active workspace. */
let loadedKey: string | undefined;

export { items as postTemplates };

export function emptyTemplate(): TemplateDraft {
  return {
    name: "",
    platforms: [],
    accounts: {},
    caption: "",
    overrides: {},
    settings: defaultPlatformSettings(),
    signature: true,
    thread: [],
    when: "none",
    time: "09:00",
    repeat: "",
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function platformIds(value: unknown): PlatformId[] {
  if (!Array.isArray(value)) return [];
  return PLATFORM_IDS.filter((id) => value.includes(id));
}

/** Saved settings over the defaults, so a template from before a setting was added still has it. */
function readSettings(value: unknown): PlatformSettings {
  const base = defaultPlatformSettings();
  if (!value || typeof value !== "object") return base;
  const saved = value as Partial<Record<keyof PlatformSettings, object>>;
  for (const key of Object.keys(base) as (keyof PlatformSettings)[]) {
    const entry = saved[key];
    if (entry && typeof entry === "object") Object.assign(base[key], entry);
  }
  return base;
}

function readOverrides(value: unknown, platforms: readonly PlatformId[]): PostTemplate["overrides"] {
  if (!value || typeof value !== "object") return {};
  const out: PostTemplate["overrides"] = {};
  for (const id of platforms) {
    const text = (value as Record<string, unknown>)[id];
    if (typeof text === "string") out[id] = text;
  }
  return out;
}

/** A saved thread, without anything that isn't a follow-up. Templates from before threads have none. */
function readThread(value: unknown): ThreadReply[] {
  if (!Array.isArray(value)) return [];
  return keptThread(
    value.filter(
      (reply): reply is ThreadReply => !!reply && typeof reply === "object" && typeof reply.id === "string" && typeof reply.text === "string" && typeof reply.delay === "number",
    ),
  );
}

export function readPostTemplate(value: unknown): PostTemplate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PostTemplate>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const platforms = platformIds(row.platforms);
  const now = new Date(0).toISOString();
  return {
    id: row.id,
    name: row.name || t("Untitled"),
    platforms,
    accounts: readChoices(row.accounts),
    caption: typeof row.caption === "string" ? row.caption : "",
    overrides: readOverrides(row.overrides, platforms),
    settings: readSettings(row.settings),
    signature: row.signature !== false,
    thread: readThread(row.thread),
    when: row.when === "queue" || row.when === "time" ? row.when : "none",
    time: typeof row.time === "string" && TIME.test(row.time) ? row.time : "09:00",
    repeat: typeof row.repeat === "string" ? row.repeat : "",
    pinned: !!row.pinned,
    uses: typeof row.uses === "number" ? row.uses : 0,
    lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
  };
}

/** Reads the account copy again. `loadTemplates` does nothing when this key is already loaded. */
export function reloadTemplates(userId: string | undefined) {
  loadedKey = undefined;
  loadTemplates(userId);
}

/** Reads the active workspace, so a load inside an effect reloads after a switch. */
export function loadTemplates(userId: string | undefined) {
  // A guest has the demo's (see lib/guest.ts).
  userId = ownerOf(userId);
  if (!userId) {
    loadedKey = undefined;
    setItems([]);
    return;
  }
  const key = workspaceKey("plan.video.templates", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setItems(Array.isArray(parsed) ? parsed.map(readPostTemplate).filter((row): row is PostTemplate => !!row) : []);
  } catch {
    setItems([]);
  }
}

function write(update: (current: PostTemplate[]) => PostTemplate[]) {
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

function clean(draft: TemplateDraft): TemplateDraft {
  const platforms = platformIds(draft.platforms);
  const accounts = readChoices(draft.accounts);
  return {
    name: draft.name.trim(),
    platforms,
    accounts: Object.fromEntries(Object.entries(accounts).filter(([id]) => (platforms as string[]).includes(id))),
    caption: draft.caption.replace(/\s+$/, ""),
    overrides: readOverrides(draft.overrides, platforms),
    settings: readSettings(draft.settings),
    signature: draft.signature,
    thread: readThread(draft.thread),
    when: draft.when,
    time: TIME.test(draft.time) ? draft.time : "09:00",
    repeat: draft.when === "time" ? draft.repeat : "",
  };
}

function problem(draft: TemplateDraft): string | undefined {
  if (!draft.name) return t("Give the template a name.");
  if (!draft.platforms.length && !draft.caption.trim()) return t("Pick where it goes or write a caption.");
}

/** Returns the new template's id, or an error for the user. */
export function createTemplate(draft: TemplateDraft): { id: string } | { error: string } {
  const next = clean(draft);
  const error = problem(next);
  if (error) return { error };
  const now = new Date().toISOString();
  const template: PostTemplate = { ...next, id: crypto.randomUUID(), pinned: false, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
  if (!write((current) => [template, ...current])) return { error: t("The template could not be saved in this browser.") };
  return { id: template.id };
}

export function updateTemplate(id: string, draft: TemplateDraft): string | undefined {
  const next = clean(draft);
  const error = problem(next);
  if (error) return error;
  const now = new Date().toISOString();
  if (!write((current) => current.map((item) => (item.id === id ? { ...item, ...next, updatedAt: now } : item)))) {
    return t("The template could not be saved in this browser.");
  }
}

export function duplicateTemplate(id: string) {
  const source = items().find((item) => item.id === id);
  if (!source) return;
  return createTemplate({ ...source, name: t("{name} copy", { name: source.name }) });
}

export function deleteTemplate(id: string) {
  write((current) => current.filter((item) => item.id !== id));
}

export function restoreTemplate(item: PostTemplate) {
  write((current) => (current.some((row) => row.id === item.id) ? current : [item, ...current]));
}

export function toggleTemplatePin(id: string) {
  write((current) => current.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)));
}

export function markTemplateUsed(id: string) {
  const now = new Date().toISOString();
  write((current) => current.map((item) => (item.id === id ? { ...item, uses: item.uses + 1, lastUsedAt: now } : item)));
}

/** Pinned first, then the ones used or edited most recently. */
export function sortTemplates(list: readonly PostTemplate[]): PostTemplate[] {
  const recency = (item: PostTemplate) => (item.lastUsedAt && item.lastUsedAt > item.updatedAt ? item.lastUsedAt : item.updatedAt);
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || recency(b).localeCompare(recency(a)));
}

export function searchTemplates(list: readonly PostTemplate[], query: string): PostTemplate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sortTemplates(
    list.filter((item) => {
      const text = `${item.name}\n${item.caption}\n${item.platforms.join(" ")}`.toLowerCase();
      return words.every((word) => text.includes(word));
    }),
  );
}

// The New post page opens with a template applied when one is waiting here.
const [pendingTemplate, setPendingTemplate] = createSignal<PostTemplate | null>(null);

export function queueTemplate(item: PostTemplate) {
  setPendingTemplate(item);
}

export function takeTemplate(): PostTemplate | null {
  const item = pendingTemplate();
  setPendingTemplate(null);
  return item;
}
