/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A workspace keeps one brand's accounts, account groups, posts, calendar and
// vault apart from another's. The list is saved on the account and cached in
// this browser. The first workspace keeps the storage the app had before
// workspaces, so nothing saved earlier moves.
//
// Workspaces other people shared with the signed-in person sit beside their
// own (lib/team.ts lists them). Each opens like one of theirs, under an id of
// its own here, but its posts and accounts are its owner's: lib/team-sync.ts
// keeps it in step with the owner's account, never with this person's.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";

export type WorkspaceRole = "admin" | "member";

/** Someone asked into a workspace before invites went through the server. Only read, to move them there (lib/team.ts). */
export type WorkspaceMember = {
  email: string;
  role: WorkspaceRole;
  invitedAt: string;
};

/** What the workspace's badge shows. Without one, the default workspace wears the logo and the rest their first letter. */
export type WorkspaceIcon =
  | { type: "letters"; value?: string }
  | { type: "emoji"; value: string }
  /** A small square picture, kept inline as a data URL so it syncs with the rest. */
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

/** Which of an owner's workspaces a request is about, for the services that act for its owner. */
export type TeamScope = { owner: string; workspace: string };

/**
 * A workspace someone shared with the signed-in person. `id` is its id here;
 * `scope` says whose and which it is. Paused while the owner's plan doesn't
 * include a team.
 */
export type SharedWorkspace = Workspace & {
  scope: TeamScope;
  membership: string;
  role: WorkspaceRole;
  ownerName: string;
  ownerEmail: string;
  state: "active" | "paused";
};

/** The id a shared workspace has here. Never one of the person's own: theirs are "default" or a uuid. */
export function sharedIdOf(scope: TeamScope) {
  return `shared-${scope.owner}-${scope.workspace}`;
}

export function isSharedId(id: string) {
  return id.startsWith("shared-");
}

/** The most a logo may weigh once shrunk, so the account copy stays small. */
export const WORKSPACE_IMAGE_MAX = 120_000;

/** Up to two letters, uppercased. Empty means the name's first letter. */
export function cleanInitials(value: string) {
  return [...value.replace(/\s+/g, "")].slice(0, 2).join("").toUpperCase();
}

/** The first character as the eye sees it, so a flag or a family stays whole. */
export function firstGrapheme(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const segment = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next();
  return segment.done ? "" : segment.value.segment;
}

/** An icon from storage or another browser, or undefined when it doesn't hold up. */
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

/** The icon a workspace shows, filling in the default when it never picked one. */
export function workspaceIcon(workspace: Pick<Workspace, "icon"> & { id?: string }): WorkspaceIcon {
  return workspace.icon ?? (workspace.id === DEFAULT_WORKSPACE ? { type: "mark" } : { type: "letters" });
}

type Saved = { active: string; list: Workspace[] };

/** The workspace everything saved before workspaces belongs to. */
export const DEFAULT_WORKSPACE = "default";

const [list, setList] = createSignal<Workspace[]>([]);
const [shared, setShared] = createSignal<SharedWorkspace[]>([]);
const [activeId, setActiveId] = createSignal(DEFAULT_WORKSPACE);
let owner: string | undefined;
/** The person's own workspace open last, which their account keeps while a shared one is open. */
let ownActive = DEFAULT_WORKSPACE;
/** A shared workspace open last visit that this tab didn't know of yet when it loaded: it opens once the server lists it. */
let waitingPick: string | null = null;

const listeners = new Set<() => void>();

function storageKey(userId: string) {
  return `plan.video.workspaces.${userId}`;
}

/** What the first workspace is called until its owner names it. */
const DEFAULT_NAME = "Personal";

/** The signed-in person's first name, which the first workspace was named after before it was "Personal". */
let ownerFirstName = "";
/** Whose first workspace this visit already moved to "Personal". */
let renamedFor: string | undefined;

/**
 * Names the app gave the first workspace, not the person: "Personal", and from
 * before it "My workspace" and the owner's "Cihan's workspace". A first
 * workspace still wearing one of these is called "Personal"; one renamed by
 * hand keeps its name.
 */
export function isAutomaticWorkspaceName(name: string) {
  const first = ownerFirstName.trim();
  return name === DEFAULT_NAME || name === "My workspace" || (!!first && name === cleanName(`${first}'s workspace`));
}

/**
 * A workspace's name as it's shown. The names the app gives are kept in
 * English, as the checks above and the account copy compare them, and shown in
 * the language picked; a name the person gave stays as they wrote it.
 */
export function shownWorkspaceName(name: string): string {
  if (name === DEFAULT_NAME) return t("Personal");
  if (name === "My workspace") return t("My workspace");
  const first = ownerFirstName.trim();
  if (first && name === cleanName(`${first}'s workspace`)) return t("{name}'s workspace", { name: first });
  return name;
}

/** The first workspace, as a new account starts with it. */
export function newDefaultWorkspace(createdAt = new Date().toISOString()): Workspace {
  return { id: DEFAULT_WORKSPACE, name: DEFAULT_NAME, color: "sky", createdAt, members: [] };
}

function firstWorkspace(): Workspace {
  return newDefaultWorkspace();
}

/**
 * Calls the first workspace "Personal" when it still has a name the app gave
 * it before. Once a visit: a tab still open on the app from before names it
 * after its owner again, and this one then leaves that be rather than the two
 * renaming it back and forth through the account. True when it changed.
 */
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

/** The first name on an account: the one set in Account, else the first word of the full or Google name. */
export function firstNameFrom(metadata: Record<string, unknown> | undefined): string {
  const pick = (key: string) => (typeof metadata?.[key] === "string" ? (metadata[key] as string).trim() : "");
  return pick("first_name") || (pick("full_name") || pick("name")).split(/\s+/)[0] || "";
}

/**
 * Tells the workspaces the signed-in person's first name, so a first workspace
 * still named after them the way the app did before can move to "Personal".
 * Call before `loadWorkspaces`, and again when their name changes. Only that
 * person's loaded list is renamed; another account's list is renamed when it loads.
 */
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

/** Points everything at another workspace, or another person's, and tells the stores that keep their own copies. */
function activate(id: string, newPerson = false, { keepPick = false } = {}) {
  if (!isSharedId(id)) ownActive = id;
  // Only a switch says where the person is now: reading the list again in one tab leaves another tab's pick be.
  if (id === activeId() && !newPerson) return;
  if (!keepPick) writeSharedPick(isSharedId(id) ? id : null);
  setActiveId(id);
  for (const listener of listeners) listener();
}

/** The person's own workspaces. Shared ones are `sharedWorkspaces`. */
export function workspaces() {
  return list();
}

/** The workspaces other people shared with the signed-in person. */
export function sharedWorkspaces() {
  return shared();
}

/** The shared workspace with this id here, if it is one. */
export function sharedWorkspace(id: string): SharedWorkspace | undefined {
  return isSharedId(id) ? shared().find((row) => row.id === id) : undefined;
}

/** Whose workspace `id` is, for a shared one; null for the person's own. */
export function scopeOf(id: string): TeamScope | null {
  return sharedWorkspace(id)?.scope ?? null;
}

/** The open workspace's owner and id, when it's shared; null when it's the person's own. */
export function activeScope(): TeamScope | null {
  return scopeOf(activeId());
}

/** The open workspace when it's a shared one. */
export function activeShared(): SharedWorkspace | undefined {
  return sharedWorkspace(activeId());
}

const sharedKey = (userId: string) => `plan.video.shared-workspaces.${userId}`;
const pickKey = (userId: string) => `plan.video.shared-workspace.${userId}`;

/** The shared workspace open last, kept apart from the account's own copy, which never names one. */
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

/**
 * The workspaces shared with `userId`, as the server lists them now. One open
 * that is no longer there, or is paused, gives way to their own. Returns the
 * ones that went, so their copies here can go too.
 */
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
    // Open last visit, before this browser knew of it. Only then: another tab's pick never moves this one.
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
  // On a first load, a shared workspace open last opens again, while it's still shared. Read again
  // later, this tab stays where it is: another tab's pick doesn't move it.
  const picked = userId && newPerson ? readSharedPick(userId) : null;
  const sharedPick = picked && shared().some((row) => row.id === picked && row.state === "active") ? picked : null;
  const stay = !newPerson && sharedWorkspace(activeId())?.state === "active" ? activeId() : null;
  // One this browser doesn't know of yet stays picked, and opens once the list from the server has it.
  waitingPick = !sharedPick && picked ? picked : newPerson ? null : waitingPick;
  activate(sharedPick ?? stay ?? own, newPerson, { keepPick: !!waitingPick });
  // A first workspace still named the way the app named it before ("Cihan's workspace") moves to "Personal".
  if (!rows.length || renameAutomaticDefault()) save();
}

/** Runs `listener` after every switch. Returns the unsubscribe. */
export function onWorkspaceChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The storage key for one workspace. The first workspace keeps the bare key. */
export function storageKeyFor(base: string, userId: string, workspaceId: string) {
  return workspaceId === DEFAULT_WORKSPACE ? `${base}.${userId}` : `${base}.${userId}.${workspaceId}`;
}

export function workspaceKey(base: string, userId: string) {
  loadWorkspaces(userId);
  return storageKeyFor(base, userId, activeWorkspaceId());
}

/** Reads the account copy again. `loadWorkspaces` does nothing when this user is already loaded. */
export function reloadWorkspaces(userId: string | undefined) {
  readWorkspaces(userId);
}

/** The person whose workspaces are loaded. */
export function workspaceOwner() {
  return owner;
}

/** Whether `workspaceId` is open now for `userId`, who is signed in. */
export function isActiveWorkspace(userId: string, workspaceId: string) {
  return userId === owner && workspaceId === activeId();
}

/** The IndexedDB databases each workspace keeps. Deleting a workspace deletes them. */
export const WORKSPACE_DATABASES = ["plan-video-calendar", "plan-video-media", "plan-video-agent-chats", "plan-video-team-copy"];

/**
 * Databases used to be named for the workspace alone, so two accounts on one
 * browser shared the first workspace's posts and media. When only one account
 * had used this browser by then, it keeps them under that name, so nothing it
 * saved moves. Where several had, there's no telling whose they are, and each
 * account starts again from its own copy on the account.
 */
const OLD_DATABASES_KEY = "plan.video.old-databases-owner";
/** A key saved for one person, such as `plan.video.connections.<user id>`. */
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

/**
 * The IndexedDB name for one person's copy of `base` in one workspace. Every
 * account's first workspace has the same id, so its databases are named for
 * the person too. The other workspaces' ids are already one account's own.
 */
export function workspaceDatabaseFor(base: string, userId: string, workspaceId: string) {
  // Several people on one browser can each be in the same shared workspace.
  if (isSharedId(workspaceId)) return `${base}.${userId}.${workspaceId}`;
  if (workspaceId !== DEFAULT_WORKSPACE) return `${base}.${workspaceId}`;
  return userId === oldDatabasesOwner ? base : `${base}.${userId}`;
}

/** The IndexedDB name for the open workspace's copy of `base`. Throws while nobody is signed in. */
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

/** Applies whichever of name, color, icon and shape are given. Returns why it couldn't. */
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

/** Removes a workspace and everything kept for it: accounts, groups, vault, posts and calendars. */
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

/** Drops what this browser kept of a workspace: its lists and its databases. */
function forgetCopies(userId: string, id: string) {
  const suffix = id === DEFAULT_WORKSPACE ? `.${userId}` : `.${userId}.${id}`;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("plan.video.") && key.endsWith(suffix) && key !== storageKey(userId)) localStorage.removeItem(key);
  }
  try {
    for (const base of WORKSPACE_DATABASES) indexedDB.deleteDatabase(workspaceDatabaseFor(base, userId, id));
  } catch {
    // IndexedDB is refused, as in some private windows, so nothing was kept in it.
  }
}

/** Drops this browser's copy of a shared workspace the person left, or was taken out of. */
export function forgetSharedCopy(userId: string, id: string) {
  if (isSharedId(id)) forgetCopies(userId, id);
}

/** Takes the invites kept on a workspace before they went through the server, once they're there. */
export function clearLegacyMembers(id: string) {
  if (!list().some((row) => row.id === id && row.members.length)) return;
  setList((current) => current.map((row) => (row.id === id ? { ...row, members: [] } : row)));
  save();
}
