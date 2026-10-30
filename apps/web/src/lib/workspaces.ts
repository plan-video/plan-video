/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The first workspace keeps the storage keys from before workspaces, so nothing saved earlier moves.
// A shared workspace's posts and accounts are its owner's: lib/team-sync.ts keeps it in step with the
// owner's account, never with this person's.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

export type WorkspaceRole = "admin" | "member";

/** Only read, to move old invites to the server (lib/team.ts). */
export type WorkspaceMember = {
  email: string;
  role: WorkspaceRole;
  invitedAt: string;
};

/** Without one, the default workspace wears the logo and the rest their first letter. */
export type WorkspaceIcon =
  | { type: "letters"; value?: string }
  | { type: "emoji"; value: string }
  /** Inline as a data URL so it syncs with the rest. */
  | { type: "image"; value: string }
  | { type: "mark" };

export type WorkspaceShape = "rounded" | "circle";

export type Workspace = {
  id: string;
  name: string;
  color: string;
  icon?: WorkspaceIcon;
  shape?: WorkspaceShape;
  createdAt: string;
  members: WorkspaceMember[];
};

export type TeamScope = { owner: string; workspace: string };

/** `id` is its id here; `scope` says whose and which it is. Paused while the owner's plan has no team. */
export type SharedWorkspace = Workspace & {
  scope: TeamScope;
  membership: string;
  role: WorkspaceRole;
  ownerName: string;
  ownerEmail: string;
  state: "active" | "paused";
};

/** Never one of the person's own: theirs are "default" or a uuid. */
export function sharedIdOf(scope: TeamScope) {
  return `shared-${scope.owner}-${scope.workspace}`;
}

export function isSharedId(id: string) {
  return id.startsWith("shared-");
}

/** Kept small because it rides in the account copy. */
export const WORKSPACE_IMAGE_MAX = 120_000;

/** Empty means the name's first letter. */
export function cleanInitials(value: string) {
  return [...value.replace(/\s+/g, "")].slice(0, 2).join("").toUpperCase();
}

/** By grapheme, so a flag or a family emoji stays whole. */
export function firstGrapheme(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const segment = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next();
  return segment.done ? "" : segment.value.segment;
}

export function asWorkspaceIcon(value: unknown): WorkspaceIcon | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { type?: unknown; value?: unknown };
  const text = typeof row.value === "string" ? row.value : "";
  if (row.type === "mark") return { type: "mark" };
  if (row.type === "letters") return text ? { type: "letters", value: cleanInitials(text) } : { type: "letters" };
  if (row.type === "emoji" && firstGrapheme(text)) return { type: "emoji", value: firstGrapheme(text) };
  if (row.type === "image" && text.startsWith("data:image/") && text.length <= WORKSPACE_IMAGE_MAX) return { type: "image", value: text };
  return undefined;
}

export function asWorkspaceShape(value: unknown): WorkspaceShape | undefined {
  return value === "circle" || value === "rounded" ? value : undefined;
}

export function workspaceIcon(workspace: Pick<Workspace, "icon"> & { id?: string }): WorkspaceIcon {
  return workspace.icon ?? (workspace.id === DEFAULT_WORKSPACE ? { type: "mark" } : { type: "letters" });
}

type Saved = { active: string; list: Workspace[] };

export const DEFAULT_WORKSPACE = "default";

const [list, setList] = createSignal<Workspace[]>([]);
const [shared, setShared] = createSignal<SharedWorkspace[]>([]);
const [activeId, setActiveId] = createSignal(DEFAULT_WORKSPACE);
let owner: string | undefined;
/** Kept by the account while a shared one is open. */
let ownActive = DEFAULT_WORKSPACE;
/** A shared workspace open last visit that this tab didn't know of yet: it opens once the server lists it. */
let waitingPick: string | null = null;

const listeners = new Set<() => void>();

function storageKey(userId: string) {
  return `plan.video.workspaces.${userId}`;
}

const DEFAULT_NAME = "Personal";

let ownerFirstName = "";
/** Once per visit, so an old tab and this one don't rename it back and forth. */
let renamedFor: string | undefined;

/** Names the app gave the first workspace, older ones included; one renamed by hand keeps its name. */
export function isAutomaticWorkspaceName(name: string) {
  const first = ownerFirstName.trim();
  return name === DEFAULT_NAME || name === "My workspace" || (!!first && name === cleanName(`${first}'s workspace`));
}

/** App-given names stay English in storage (the checks compare them) and are shown translated. */
export function shownWorkspaceName(name: string): string {
  if (name === DEFAULT_NAME) return t("Personal");
  if (name === "My workspace") return t("My workspace");
  const first = ownerFirstName.trim();
  if (first && name === cleanName(`${first}'s workspace`)) return t("{name}'s workspace", { name: first });
  return name;
}

export function newDefaultWorkspace(createdAt = new Date().toISOString()): Workspace {
  return { id: DEFAULT_WORKSPACE, name: DEFAULT_NAME, color: "sky", createdAt, members: [] };
}

function firstWorkspace(): Workspace {
  return newDefaultWorkspace();
}

/** True when it changed. */
function renameAutomaticDefault(): boolean {
  if (!owner || renamedFor === owner) return false;
  const stale = list().some((row) => row.id === DEFAULT_WORKSPACE && row.name !== DEFAULT_NAME && isAutomaticWorkspaceName(row.name));
  // Another workspace already called that keeps it; two can't share a name.
  const taken = list().some((row) => row.id !== DEFAULT_WORKSPACE && row.name.toLowerCase() === DEFAULT_NAME.toLowerCase());
  if (!stale || taken) return false;
  renamedFor = owner;
  setList((current) => current.map((row) => (row.id === DEFAULT_WORKSPACE ? { ...row, name: DEFAULT_NAME } : row)));
  return true;
}

export function firstNameFrom(metadata: Record<string, unknown> | undefined): string {
  const pick = (key: string) => (typeof metadata?.[key] === "string" ? (metadata[key] as string).trim() : "");
  return pick("first_name") || (pick("full_name") || pick("name")).split(/\s+/)[0] || "";
}

/** Call before `loadWorkspaces`, and again when the name changes. */
export function setWorkspaceOwnerName(userId: string | undefined, firstName: string) {
  const next = firstName.trim();
  if (next === ownerFirstName) return;
  ownerFirstName = next;
  if (userId && owner === userId && renameAutomaticDefault()) save();
}

function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const row = value as Workspace;
  return typeof row.id === "string" && typeof row.name === "string" && row.name.length > 0;
}

function save() {
  if (!owner) return;
  const saved: Saved = { active: ownActive, list: list() };
  try {
    localStorage.setItem(storageKey(owner), JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the switch still holds for this session.
  }
  queueAccountSync();
}

function activate(id: string, newPerson = false, { keepPick = false } = {}) {
  if (!isSharedId(id)) ownActive = id;
  // Only a switch says where the person is now: reading the list again in one tab leaves another tab's pick be.
  if (id === activeId() && !newPerson) return;
  if (!keepPick) writeSharedPick(isSharedId(id) ? id : null);
  setActiveId(id);
  for (const listener of listeners) listener();
}

export function workspaces() {
  return list();
}

export function sharedWorkspaces() {
  return shared();
}

export function sharedWorkspace(id: string): SharedWorkspace | undefined {
  return isSharedId(id) ? shared().find((row) => row.id === id) : undefined;
}

export function scopeOf(id: string): TeamScope | null {
  return sharedWorkspace(id)?.scope ?? null;
}

export function activeScope(): TeamScope | null {
  return scopeOf(activeId());
}

export function activeShared(): SharedWorkspace | undefined {
  return sharedWorkspace(activeId());
}

const sharedKey = (userId: string) => `plan.video.shared-workspaces.${userId}`;
const pickKey = (userId: string) => `plan.video.shared-workspace.${userId}`;

/** Kept apart from the account's own copy, which never names one. */
function readSharedPick(userId: string): string | null {
  try {
    return localStorage.getItem(pickKey(userId));
  } catch {
    return null;
  }
}

function writeSharedPick(id: string | null) {
  if (!owner) return;
  try {
    if (id) localStorage.setItem(pickKey(owner), id);
    else localStorage.removeItem(pickKey(owner));
  } catch {
    // The pick holds for this visit.
  }
}

function readSharedCache(userId: string): SharedWorkspace[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(sharedKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((row): row is SharedWorkspace => isWorkspace(row) && !!(row as SharedWorkspace).scope) : [];
  } catch {
    return [];
  }
}

/** One open that's gone or paused gives way to their own. Returns the ones that went. */
export function setSharedWorkspaces(userId: string, rows: SharedWorkspace[]): SharedWorkspace[] {
  if (userId !== owner) return [];
  const gone = shared().filter((row) => !rows.some((next) => next.id === row.id));
  setShared(rows);
  try {
    localStorage.setItem(sharedKey(userId), JSON.stringify(rows));
  } catch {
    // Read from the server again next visit.
  }
  const open = activeId();
  const picked = waitingPick;
  waitingPick = null;
  if (isSharedId(open)) {
    if (!rows.some((row) => row.id === open && row.state === "active")) activate(list().some((row) => row.id === ownActive) ? ownActive : (list()[0]?.id ?? DEFAULT_WORKSPACE));
  } else if (picked && rows.some((row) => row.id === picked && row.state === "active")) {
    // Only then: another tab's pick never moves this one.
    activate(picked);
  }
  return gone;
}

/** Reading this tracks it, so an effect that loads per-workspace data reloads on a switch. */
export function activeWorkspaceId() {
  return activeId();
}

export function activeWorkspace(): Workspace {
  const id = activeId();
  return list().find((workspace) => workspace.id === id) ?? sharedWorkspace(id) ?? list()[0] ?? firstWorkspace();
}

export function loadWorkspaces(userId: string | undefined) {
  if (owner !== userId) readWorkspaces(userId);
}

function readWorkspaces(userId: string | undefined) {
  // Everyone's first workspace has the same id, so the stores start again for a new person, not only a new workspace.
  const newPerson = owner !== userId;
  owner = userId;
  let saved: Partial<Saved> = {};
  if (userId) {
    try {
      const raw = localStorage.getItem(storageKey(userId));
      saved = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    } catch {
      saved = {};
    }
  }
  const rows = Array.isArray(saved.list)
    ? saved.list.filter(isWorkspace).map((row) => ({
        ...row,
        color: row.color || "sky",
        icon: asWorkspaceIcon(row.icon),
        shape: asWorkspaceShape(row.shape),
        members: Array.isArray(row.members) ? row.members : [],
      }))
    : [];
  const next = rows.length ? rows : [firstWorkspace()];
  setList(next);
  if (newPerson) setShared(userId ? readSharedCache(userId) : []);
  const own = next.some((row) => row.id === saved.active) ? saved.active! : next[0]!.id;
  ownActive = own;
  // Only on a first load: later, another tab's pick doesn't move this one.
  const picked = userId && newPerson ? readSharedPick(userId) : null;
  const sharedPick = picked && shared().some((row) => row.id === picked && row.state === "active") ? picked : null;
  const stay = !newPerson && sharedWorkspace(activeId())?.state === "active" ? activeId() : null;
  // One this browser doesn't know of yet stays picked, and opens once the server's list has it.
  waitingPick = !sharedPick && picked ? picked : newPerson ? null : waitingPick;
  activate(sharedPick ?? stay ?? own, newPerson, { keepPick: !!waitingPick });
  if (!rows.length || renameAutomaticDefault()) save();
}

export function onWorkspaceChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The first workspace keeps the bare key. */
export function storageKeyFor(base: string, userId: string, workspaceId: string) {
  return workspaceId === DEFAULT_WORKSPACE ? `${base}.${userId}` : `${base}.${userId}.${workspaceId}`;
}

export function workspaceKey(base: string, userId: string) {
  loadWorkspaces(userId);
  return storageKeyFor(base, userId, activeWorkspaceId());
}

/** `loadWorkspaces` does nothing when this user is already loaded. */
export function reloadWorkspaces(userId: string | undefined) {
  readWorkspaces(userId);
}

export function workspaceOwner() {
  return owner;
}

export function isActiveWorkspace(userId: string, workspaceId: string) {
  return userId === owner && workspaceId === activeId();
}

/** Deleting a workspace deletes them. */
export const WORKSPACE_DATABASES = ["plan-video-calendar", "plan-video-media", "plan-video-agent-chats", "plan-video-team-copy"];

/**
 * Database names once ignored the account. With one old account on this browser it keeps them;
 * with several, there's no telling whose they are, and each starts again from its account copy.
 */
const OLD_DATABASES_KEY = "plan.video.old-databases-owner";
const PERSON_KEY = /^plan\.video\.[\w-]+\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.|$)/;

function settleOldDatabasesOwner(): string | null {
  try {
    const settled = localStorage.getItem(OLD_DATABASES_KEY);
    if (settled !== null) return settled || null;
    const people = new Set<string>();
    for (const key of Object.keys(localStorage)) {
      const id = PERSON_KEY.exec(key)?.[1];
      if (id) people.add(id);
    }
    const only = people.size === 1 ? [...people][0]! : "";
    try {
      localStorage.setItem(OLD_DATABASES_KEY, only);
    } catch {
      // The same keys give the same answer next time.
    }
    return only || null;
  } catch {
    return null;
  }
}

/** Settled as this file loads, before anyone new has saved anything here. */
const oldDatabasesOwner = settleOldDatabasesOwner();

/** Every account's first workspace has the same id, so its databases are named for the person too. */
export function workspaceDatabaseFor(base: string, userId: string, workspaceId: string) {
  // Several people on one browser can each be in the same shared workspace.
  if (isSharedId(workspaceId)) return `${base}.${userId}.${workspaceId}`;
  if (workspaceId !== DEFAULT_WORKSPACE) return `${base}.${workspaceId}`;
  return userId === oldDatabasesOwner ? base : `${base}.${userId}`;
}

/** Throws while nobody is signed in. */
export function workspaceDatabase(base: string) {
  if (!owner) throw new Error("Sign in to open your workspace.");
  return workspaceDatabaseFor(base, owner, activeWorkspaceId());
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function createWorkspace({ name, color }: { name: string; color: string }): { id: string } | { error: string } {
  const clean = cleanName(name);
  if (!owner) return { error: t("Sign in to add a workspace.") };
  if (!clean) return { error: t("Give the workspace a name.") };
  if (list().some((row) => row.name.toLowerCase() === clean.toLowerCase())) return { error: t("A workspace already has that name.") };
  const workspace: Workspace = { id: crypto.randomUUID(), name: clean, color, createdAt: new Date().toISOString(), members: [] };
  setList((current) => [...current, workspace]);
  activate(workspace.id);
  save();
  return { id: workspace.id };
}

export function switchWorkspace(id: string) {
  if (sharedWorkspace(id)?.state === "active") return activate(id);
  if (!list().some((row) => row.id === id)) return;
  activate(id);
  save();
}

export type WorkspaceChanges = Partial<Pick<Workspace, "name" | "color" | "icon" | "shape">>;

/** Returns why it couldn't. */
export function updateWorkspace(id: string, changes: WorkspaceChanges): string | undefined {
  const next: WorkspaceChanges = { ...changes };
  if (changes.name !== undefined) {
    const clean = cleanName(changes.name);
    if (!clean) return t("Give the workspace a name.");
    if (list().some((row) => row.id !== id && row.name.toLowerCase() === clean.toLowerCase())) return t("A workspace already has that name.");
    next.name = clean;
  }
  if ("icon" in changes && changes.icon !== undefined) {
    const icon = asWorkspaceIcon(changes.icon);
    if (!icon) return changes.icon.type === "image" ? t("That picture is too large. Try a smaller one.") : t("That icon can't be used.");
    next.icon = icon;
  }
  setList((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  save();
}

export async function deleteWorkspace(id: string): Promise<string | undefined> {
  const userId = owner;
  if (!userId) return t("Sign in to manage workspaces.");
  if (!list().some((row) => row.id === id)) return t("Only the workspace's owner can delete it.");
  if (list().length <= 1) return t("Keep at least one workspace.");
  const remaining = list().filter((row) => row.id !== id);
  setList(remaining);
  if (activeId() === id) activate(remaining[0]!.id);
  save();
  forgetCopies(userId, id);
  // Everyone it was shared with leaves it too.
  void supabase?.rpc("forget_workspace_team", { workspace: id }).then(({ error }) => {
    if (error && !/forget_workspace_team/.test(error.message)) console.error("[workspaces] Could not take the team out of the deleted workspace", error);
  });
}

function forgetCopies(userId: string, id: string) {
  const suffix = id === DEFAULT_WORKSPACE ? `.${userId}` : `.${userId}.${id}`;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("plan.video.") && key.endsWith(suffix) && key !== storageKey(userId)) localStorage.removeItem(key);
  }
  try {
    for (const base of WORKSPACE_DATABASES) indexedDB.deleteDatabase(workspaceDatabaseFor(base, userId, id));
  } catch {
    // IndexedDB is refused in some private windows, so nothing was kept in it.
  }
}

export function forgetSharedCopy(userId: string, id: string) {
  if (isSharedId(id)) forgetCopies(userId, id);
}

export function clearLegacyMembers(id: string) {
  if (!list().some((row) => row.id === id && row.members.length)) return;
  setList((current) => current.map((row) => (row.id === id ? { ...row, members: [] } : row)));
  save();
}
