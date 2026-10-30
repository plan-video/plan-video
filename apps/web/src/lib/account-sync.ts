/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Connected accounts, workspaces, calendars, the media library's list and the
// lists around them used to stay in the browser that saved them. This keeps
// one copy on the account and loads it in every browser signed in as that
// person. Posts have a table of their own and sync one at a time
// (lib/post-sync.ts); files are in cloud storage; projects sync on their own.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSignal } from "solid-js";

import { readCalendarSnapshot, writeWorkspaceCalendars, type CalendarRead } from "@/components/calendar/store";
import type { Calendar, StoredEvent } from "@/components/calendar/types";
import { reloadAccountGroups } from "@/lib/account-groups";
import { t } from "@/lib/i18n";
import { readLibrarySnapshot, writeLibrarySnapshot, type LibraryItem } from "@/lib/media-library";
import { bumpNotifications, onAccountEdited, setAccountApplying, setAccountSyncPending, waitForAccountSync } from "@/lib/account-sync-bus";
import { reloadPinterestBoards } from "@/lib/pinterest-boards";
import { reloadPlugs } from "@/lib/plugs";
import { isProjectFolder, projectFoldersKey, reloadProjectFolders, type ProjectFolder } from "@/lib/project-folders";
import { gradePresetsKey, isGradePreset, reloadGradePresets, type GradePreset } from "@/lib/grade-presets";
import { readWorkflow, reloadWorkflows, workflowsKey, type Workflow } from "@/lib/workflows";
import { reloadTemplates } from "@/lib/post-templates";
import { reloadCaptionStyles } from "@/lib/caption-brand";
import { reloadQueueSlots } from "@/lib/queue-slots";
import { reloadSocialConnections, shareableConnections } from "@/lib/social-connections";
import { supabase } from "@/lib/supabase";
import { reloadTimeZone } from "@/lib/time-zone";
import { reloadVault } from "@/lib/vault";
import {
  DEFAULT_WORKSPACE,
  asWorkspaceIcon,
  asWorkspaceShape,
  isAutomaticWorkspaceName,
  newDefaultWorkspace,
  reloadWorkspaces,
  storageKeyFor,
  type Workspace,
  type WorkspaceMember,
} from "@/lib/workspaces";

type Notes = { read: string[]; cleared: string[]; seen: Record<string, number> };

/** One workspace's part of the account. A workspace shared with someone is synced with them on its own (lib/team-sync.ts). */
export type Slice = {
  connections: unknown[];
  groups: unknown[];
  queue: unknown[];
  boards: string[];
  vault: unknown[];
  signatureId: string | null;
  templates: unknown[];
  plugs: unknown[];
  /** Saved caption looks: the brand style. */
  captionStyles: unknown[];
  calendars: Calendar[];
  /** The media library's items whose files are in cloud storage. */
  library: LibraryItem[];
};

type Body = {
  workspaces: { active: string; list: Workspace[] };
  timeZone: string | null;
  notifications: Notes;
  /** The person's project folders: projects are a person's, not a workspace's. */
  projectFolders: ProjectFolder[];
  /** The person's saved colour grades, used across their projects. */
  gradePresets: GradePreset[];
  /** The person's editor workflows, used across their projects. */
  workflows: Workflow[];
  slices: Record<string, Slice>;
};

type Payload = Body & { revision: string };

const EMPTY_NOTES: Notes = { read: [], cleared: [], seen: {} };

/**
 * A slice saved by a tab still running code from before the library synced.
 * It says nothing about the library, which must not read as every item deleted.
 */
const UNKNOWN_LIBRARY: LibraryItem[] = [];
/** Likewise a copy saved by a tab from before project folders synced: it must not read as every folder deleted. */
const UNKNOWN_FOLDERS: ProjectFolder[] = [];
/** And one from before saved grades synced. */
const UNKNOWN_GRADES: GradePreset[] = [];
/** And one from before workflows synced. */
const UNKNOWN_WORKFLOWS: Workflow[] = [];
/** The account's table isn't there, as before its migration, so the account's copy is off for this visit. */
let missing = false;

/** Waits before trying the account again after a failed read or save, longer each time in a row. */
const RETRY_MS = [5_000, 15_000, 60_000, 5 * 60_000];
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

const [syncProblem, setSyncProblem] = createSignal<{ message: string; since: number } | null>(null);

/** Why changes made here aren't reaching the account, and since when, while they aren't. */
export const accountSyncProblem = syncProblem;

let currentUser: string | undefined;
let ready = false;
let dirty = false;
let reconciling = false;
let localRevision = "";
let channel: RealtimeChannel | null = null;
let startedFor: string | undefined;
let stopListening: (() => void) | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

onAccountEdited(() => {
  if (missing || !currentUser) return;
  if (!ready || reconciling) {
    dirty = true;
    return;
  }
  schedule();
});

function schedule() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    if (currentUser) void reconcile(currentUser);
  }, 400);
}

/**
 * Saves this browser's changes to the account now, rather than after the
 * usual pause, for something on the server that reads them next. False when
 * the account couldn't be reached, so the server would read an older copy.
 */
export async function flushAccountSync(): Promise<boolean> {
  const userId = currentUser;
  if (!userId || missing || !supabase) return true;
  await waitForAccountSync();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }
  // A save already running may have started before the latest change.
  for (let waited = 0; reconciling && waited < 15_000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
  return reconcile(userId);
}

/** Tries the account again now, rather than at the next retry. */
export function retryAccountSync() {
  if (currentUser && ready && !reconciling) void reconcile(currentUser);
}

/** Starts the copy for this person. A second call with the same id does nothing. */
export function beginAccountSync(userId: string | undefined) {
  const key = userId ?? "";
  if (startedFor === key) return;
  startedFor = key;
  stopListening?.();
  stopListening = null;
  ready = false;
  dirty = false;
  currentUser = userId;
  failures = 0;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  setSyncProblem(null);
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  if (!userId || !supabase) {
    setAccountSyncPending(Promise.resolve());
    ready = true;
    return;
  }
  const person = userId;
  const onFocus = () => {
    if (ready && !reconciling && !pushTimer) void reconcile(person);
  };
  // A change saved just before the tab is hidden or closed goes now, rather than after the pause the page may not live through.
  const onHide = () => {
    if (document.visibilityState !== "hidden" || !ready || !pushTimer) return;
    clearTimeout(pushTimer);
    pushTimer = undefined;
    void reconcile(person);
  };
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);
  document.addEventListener("visibilitychange", onHide);
  stopListening = () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
    document.removeEventListener("visibilitychange", onHide);
  };
  const promise = run(person);
  setAccountSyncPending(promise);
}

async function run(userId: string) {
  try {
    await reconcile(userId);
  } catch (error) {
    console.error("[account] Could not sync this account", error);
  } finally {
    // Someone else signed in while this ran, and their own run takes it from here.
    if (userId === currentUser) {
      ready = true;
      // Reads the connections again, which hands any login still in this browser to the server.
      reloadSocialConnections(userId);
      subscribe(userId);
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }
}

function subscribe(userId: string) {
  if (!supabase) return;
  channel = supabase
    .channel(`account-state-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "account_state", filter: `user_id=eq.${userId}` },
      (payload) => {
        const next = asPayload((payload.new as { payload?: unknown } | undefined)?.payload);
        if (!next || next.revision === localRevision) return;
        void reconcile(userId);
      },
    )
    .subscribe();
}

/** True when this browser's copy and the account's agree afterwards. */
async function reconcile(userId: string): Promise<boolean> {
  if (!supabase || missing) return false;
  if (reconciling) {
    dirty = true;
    return false;
  }
  reconciling = true;
  try {
    for (let attempt = 1; ; attempt++) {
      const remote = await fetchPayload(userId);
      if (remote === "missing") {
        missing = true;
        return false;
      }
      if (remote === "failed") return failed(userId);
      // Each workspace's posts as read now: what changes here before the merged copy is written back is kept.
      const reads = new Map<string, CalendarRead>();
      const local = await readLocal(userId, reads);
      const baseline = readBaseline(userId);
      const next = canonicalize(choose(remote, local, baseline, readKnown(userId), readKnownWorkspaces(userId)));
      const changedHere = stable(next) !== stable(local);
      const changedThere = !remote || stable(next) !== stable(strip(remote));
      // Another tab in this browser may already have written the account's newer copy here, so nothing
      // changes in storage, but this tab's stores still show the copy before it: they're read again.
      const movedOn = !!remote && !!baseline && remote.revision !== baseline.revision;
      // A post changed here while this ran stays as it is, and is saved by the run this asks for.
      if ((changedHere || movedOn) && (await writeLocal(userId, { ...next, revision: remote?.revision ?? "" }, reads))) dirty = true;
      // This browser's copy now has the account's: a save refused below merges the newer copy against it, not the older one.
      if (remote) remember(userId, withLibrary(remote, baseline ?? local));
      let revision = remote?.revision ?? "";
      if (changedThere) {
        revision = crypto.randomUUID();
        const saved: Payload = { ...next, revision };
        // `base` names the copy this merged with. If the account moved on since, as when a team member
        // saves a shared workspace, the server refuses the save, and this merges with the newer copy.
        const { error } = await supabase.from("account_state").upsert(
          { user_id: userId, payload: { ...saved, base: remote?.revision ?? null }, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
        if (error?.code === "PT409" && attempt < 4) continue;
        if (error) {
          console.error("[account] Could not save account state", error);
          return failed(userId);
        }
        remember(userId, saved);
        return synced(userId, next);
      }
      remember(userId, { ...next, revision });
      return synced(userId, next);
    }
  } catch (error) {
    console.error("[account] Could not sync this account", error);
    return failed(userId);
  } finally {
    reconciling = false;
    if (dirty && ready) {
      dirty = false;
      schedule();
    }
  }
}

function synced(userId: string, body: Body): true {
  failures = 0;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  rememberKnown(userId, body);
  if (syncProblem()) setSyncProblem(null);
  return true;
}

/** A read or save that failed is tried again on its own, soon at first, and on focus or when the connection comes back. */
function failed(userId: string): false {
  failures++;
  const message = navigator.onLine === false ? t("This browser is offline") : t("plan.video can't reach your account right now");
  setSyncProblem((current) => (current?.message === message ? current : { message, since: current?.since ?? Date.now() }));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (currentUser === userId) void reconcile(userId);
  }, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
  return false;
}

function choose(saved: Payload | null, local: Body, baseline: Payload | null, known: Known | null, knownWorkspaces?: Record<string, string>): Body {
  if (!saved) return local;
  const remote = withLibrary(saved, baseline ?? local);
  if (!baseline && !hasContent(local)) return strip(remote);
  if (!baseline) return unionBody(strip(remote), local, known, knownWorkspaces);
  if (remote.revision === baseline.revision) return local;
  return mergeBody(strip(baseline), local, strip(remote));
}

/** A workspace's copy saved by a tab from before the library synced says nothing about it: fills in the one known. */
export function fillLibrary(slice: Slice, known: Slice): Slice {
  return slice.library === UNKNOWN_LIBRARY ? { ...slice, library: known.library } : slice;
}

/** Fills in a library, or project folders, an older tab left out with the last ones known. */
function withLibrary(remote: Payload, known: Body): Payload {
  const slices: Record<string, Slice> = {};
  for (const [id, slice] of Object.entries(remote.slices)) {
    slices[id] = slice.library === UNKNOWN_LIBRARY ? { ...slice, library: known.slices[id]?.library ?? [] } : slice;
  }
  const projectFolders = remote.projectFolders === UNKNOWN_FOLDERS ? known.projectFolders : remote.projectFolders;
  const gradePresets = remote.gradePresets === UNKNOWN_GRADES ? known.gradePresets : remote.gradePresets;
  const workflows = remote.workflows === UNKNOWN_WORKFLOWS ? known.workflows : remote.workflows;
  return { ...remote, projectFolders, gradePresets, workflows, slices };
}

/** The account's copy, null when it has none yet. "failed" is tried again; "missing" means the table isn't there at all. */
async function fetchPayload(userId: string): Promise<Payload | null | "missing" | "failed"> {
  const { data, error } = await supabase!.from("account_state").select("payload").eq("user_id", userId).maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return "missing";
    console.error("[account] Could not read account state", error);
    return "failed";
  }
  if (!data) return null;
  return asPayload((data as { payload: unknown }).payload);
}

/** True when posts changed here since `reads` were taken were kept as they are, so the sync must run again. */
async function writeLocal(userId: string, payload: Payload, reads?: ReadonlyMap<string, CalendarRead>): Promise<boolean> {
  setAccountApplying(true);
  try {
    const body = strip(payload);
    writeJson(`plan.video.workspaces.${userId}`, body.workspaces);
    if (body.timeZone) localStorage.setItem("plan.video.time-zone", body.timeZone);
    else localStorage.removeItem("plan.video.time-zone");
    writeJson(`plan.video.notifications.${userId}`, body.notifications);
    writeJson(projectFoldersKey(userId), body.projectFolders);
    writeJson(gradePresetsKey(userId), body.gradePresets);
    writeJson(workflowsKey(userId), body.workflows);
    let kept = false;
    for (const [workspaceId, slice] of Object.entries(body.slices)) {
      if (await writeSlice(userId, workspaceId, slice, reads?.get(workspaceId))) kept = true;
    }
    // Someone else signed in while this was being written, and what's on screen is theirs.
    if (userId !== currentUser) return kept;
    reloadWorkspaces(userId);
    reloadWorkspaceStores(userId);
    reloadTimeZone();
    reloadProjectFolders(userId);
    reloadGradePresets(userId);
    reloadWorkflows(userId);
    bumpNotifications();
    return kept;
  } finally {
    setAccountApplying(false);
  }
}

/**
 * Writes one workspace's copy into this browser, where its stores read it. Call between setAccountApplying(true) and (false).
 * With `read`, as `readSlice` took it before the merge, posts changed here since are kept; true when any were.
 */
export async function writeSlice(userId: string, workspaceId: string, slice: Slice, read?: CalendarRead): Promise<boolean> {
  writeJson(storageKeyFor("plan.video.connections", userId, workspaceId), slice.connections);
  writeJson(storageKeyFor("plan.video.groups", userId, workspaceId), slice.groups);
  writeJson(storageKeyFor("plan.video.queue", userId, workspaceId), slice.queue);
  writeJson(storageKeyFor("plan.video.pinterest-boards", userId, workspaceId), slice.boards);
  writeJson(storageKeyFor("plan.video.vault", userId, workspaceId), slice.vault);
  const signature = storageKeyFor("plan.video.vault", userId, workspaceId).replace("plan.video.vault", "plan.video.signature");
  if (slice.signatureId) localStorage.setItem(signature, slice.signatureId);
  else localStorage.removeItem(signature);
  writeJson(storageKeyFor("plan.video.templates", userId, workspaceId), slice.templates);
  writeJson(storageKeyFor("plan.video.plugs", userId, workspaceId), slice.plugs);
  writeJson(storageKeyFor("plan.video.caption-styles", userId, workspaceId), slice.captionStyles);
  const kept = await writeWorkspaceCalendars(userId, workspaceId, slice.calendars, read);
  await writeLibrarySnapshot(userId, workspaceId, slice.library);
  return kept;
}

/** Has the open workspace's stores read their copies again, after a write. */
export function reloadWorkspaceStores(userId: string) {
  reloadSocialConnections(userId);
  reloadAccountGroups(userId);
  reloadQueueSlots(userId);
  reloadPinterestBoards(userId);
  reloadVault(userId);
  reloadTemplates(userId);
  reloadPlugs(userId);
  reloadCaptionStyles(userId);
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: this browser keeps the previous copy.
  }
}

/** `reads`, when given, gets each workspace's posts as read, for `writeLocal`. */
async function readLocal(userId: string, reads?: Map<string, CalendarRead>): Promise<Body> {
  const saved = readJson<{ active?: unknown; list?: unknown }>(`plan.video.workspaces.${userId}`);
  const list = Array.isArray(saved?.list) ? saved.list.map(asWorkspace).filter((row): row is Workspace => !!row) : [];
  const workspaces = list.length ? list : [personalWorkspace()];
  const active = typeof saved?.active === "string" && workspaces.some((row) => row.id === saved.active) ? saved.active : workspaces[0]!.id;
  const slices: Record<string, Slice> = {};
  for (const workspace of workspaces) slices[workspace.id] = await readSlice(userId, workspace.id, reads);
  return canonicalize({
    workspaces: { active, list: workspaces },
    timeZone: localStorage.getItem("plan.video.time-zone"),
    notifications: readNotes(userId),
    projectFolders: readArray(projectFoldersKey(userId)).filter(isProjectFolder),
    gradePresets: readArray(gradePresetsKey(userId)).filter(isGradePreset),
    workflows: readWorkflows(readArray(workflowsKey(userId))),
    slices,
  });
}

/** `reads`, when given, gets the workspace's calendars as read, for `writeSlice`. */
export async function readSlice(userId: string, workspaceId: string, reads?: Map<string, CalendarRead>): Promise<Slice> {
  // Logins' tokens go to the publisher's server, never into the account's copy.
  const connections = shareableConnections(readArray(storageKeyFor("plan.video.connections", userId, workspaceId)));
  const groups = readArray(storageKeyFor("plan.video.groups", userId, workspaceId));
  const queue = readArray(storageKeyFor("plan.video.queue", userId, workspaceId));
  const boards = readArray(storageKeyFor("plan.video.pinterest-boards", userId, workspaceId)).filter(
    (name): name is string => typeof name === "string" && !!name,
  );
  const vault = readArray(storageKeyFor("plan.video.vault", userId, workspaceId));
  const signatureKey = storageKeyFor("plan.video.vault", userId, workspaceId).replace("plan.video.vault", "plan.video.signature");
  const signatureId = localStorage.getItem(signatureKey);
  const templates = readArray(storageKeyFor("plan.video.templates", userId, workspaceId));
  const plugs = readArray(storageKeyFor("plan.video.plugs", userId, workspaceId));
  const captionStyles = readArray(storageKeyFor("plan.video.caption-styles", userId, workspaceId));
  const calendar = await readCalendarSnapshot(userId, workspaceId);
  if (!calendar) throw new Error("Could not read posts");
  reads?.set(workspaceId, calendar.read);
  const posts = onePostsCalendar(calendar.calendars, []);
  return {
    connections,
    groups,
    queue,
    boards,
    vault,
    signatureId,
    templates,
    plugs,
    captionStyles,
    calendars: posts.calendars,
    library: await readLibrarySnapshot(userId, workspaceId),
  };
}

/** The automatic Posts calendar uses one id, so two browsers don't each keep their own; its posts follow it (lib/post-sync.ts). */
export function onePostsCalendar(calendars: Calendar[], events: StoredEvent[]) {
  const only = calendars.length === 1 ? calendars[0] : undefined;
  if (!only || only.id === "posts" || only.name !== "Posts") return { calendars, events };
  return {
    calendars: [{ ...only, id: "posts" }],
    events: events.map((event) => (event.calendarId === only.id ? { ...event, calendarId: "posts" } : event)),
  };
}

function readNotes(userId: string): Notes {
  const parsed = readJson<Partial<Notes>>(`plan.video.notifications.${userId}`);
  const seen = parsed?.seen && typeof parsed.seen === "object" ? parsed.seen : {};
  return {
    read: strings(parsed?.read),
    cleared: strings(parsed?.cleared),
    seen: Object.fromEntries(Object.entries(seen).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
  };
}

function readArray(key: string): unknown[] {
  const parsed = readJson<unknown>(key);
  return Array.isArray(parsed) ? parsed : [];
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Kept per tab. One saved before each person had their own posts database was
 * taken against the shared one, and would read a person's new, empty one as
 * every post deleted, so those are left behind.
 */
function baselineKey(userId: string) {
  return `plan.video.account-baseline-2.${userId}`;
}

function readBaseline(userId: string): Payload | null {
  try {
    return asPayload(JSON.parse(sessionStorage.getItem(baselineKey(userId)) ?? "null"));
  } catch {
    return null;
  }
}

function remember(userId: string, payload: Payload) {
  localRevision = payload.revision;
  try {
    sessionStorage.setItem(baselineKey(userId), JSON.stringify(payload));
  } catch {
    // The next visit merges without a baseline, which keeps both sides.
  }
}

/** Stored workflows as they should be, the rest left out. */
function readWorkflows(rows: unknown[]): Workflow[] {
  return rows.map(readWorkflow).filter((row): row is Workflow => row !== null);
}

function strip(payload: Payload): Body {
  return {
    workspaces: payload.workspaces,
    timeZone: payload.timeZone,
    notifications: payload.notifications,
    projectFolders: payload.projectFolders,
    gradePresets: payload.gradePresets,
    workflows: payload.workflows,
    slices: payload.slices,
  };
}

function hasContent(body: Body): boolean {
  if (body.notifications.read.length || body.notifications.cleared.length) return true;
  if (body.projectFolders.length) return true;
  if (body.gradePresets.length) return true;
  if (body.workflows.length) return true;
  if (body.workspaces.list.length > 1) return true;
  if (body.workspaces.list.some((row) => !isAutomaticWorkspaceName(row.name) || row.members.length > 0)) return true;
  return Object.values(body.slices).some(sliceHasContent);
}

/** Whether a workspace's copy holds anything someone made, beyond the calendar every workspace starts with. */
export function sliceHasContent(slice: Slice): boolean {
  return (
    slice.connections.length > 0 ||
    slice.groups.length > 0 ||
    slice.queue.length > 0 ||
    slice.boards.length > 0 ||
    slice.vault.length > 0 ||
    slice.templates.length > 0 ||
    slice.plugs.length > 0 ||
    slice.captionStyles.length > 0 ||
    slice.library.length > 0 ||
    slice.calendars.some((calendar) => calendar.id !== "posts") ||
    !!slice.signatureId
  );
}

function unionBody(remote: Body, local: Body, known: Known | null, knownWorkspaces?: Record<string, string>): Body {
  // A workspace this browser hasn't changed since the account last had it takes the account's version, or stays deleted, like a slice's rows.
  const list = withAccountMembers(unionKnown(remote.workspaces.list, local.workspaces.list, knownWorkspaces), remote.workspaces.list, local.workspaces.list);
  const active = [local.workspaces.active, remote.workspaces.active, list[0]?.id].find((id) => list.some((row) => row.id === id)) ?? DEFAULT_WORKSPACE;
  return {
    workspaces: { active, list: list.length ? list : [personalWorkspace()] },
    timeZone: local.timeZone ?? remote.timeZone,
    notifications: mergeNotes(remote.notifications, local.notifications),
    projectFolders: unionById(remote.projectFolders, local.projectFolders),
    gradePresets: unionById(remote.gradePresets, local.gradePresets),
    workflows: unionById(remote.workflows, local.workflows),
    slices: unionSlices(remote, local, list, known),
  };
}

function mergeBody(base: Body, local: Body, remote: Body): Body {
  const list = withAccountMembers(mergeById(base.workspaces.list, local.workspaces.list, remote.workspaces.list), remote.workspaces.list, local.workspaces.list);
  const wanted = local.workspaces.active !== base.workspaces.active ? local.workspaces.active : remote.workspaces.active;
  const active = list.some((row) => row.id === wanted) ? wanted : (list[0]?.id ?? DEFAULT_WORKSPACE);
  const slices: Record<string, Slice> = {};
  for (const workspace of list) {
    const id = workspace.id;
    slices[id] = mergeSlice(base.slices[id] ?? emptySlice(), local.slices[id] ?? emptySlice(), remote.slices[id] ?? emptySlice());
  }
  return {
    workspaces: { active, list: list.length ? list : [personalWorkspace()] },
    timeZone: local.timeZone !== base.timeZone ? local.timeZone : remote.timeZone,
    notifications: mergeNotes(remote.notifications, local.notifications),
    projectFolders: mergeById(base.projectFolders, local.projectFolders, remote.projectFolders),
    gradePresets: mergeById(base.gradePresets, local.gradePresets, remote.gradePresets),
    workflows: mergeById(base.workflows, local.workflows, remote.workflows),
    slices,
  };
}

/**
 * The members kept on a workspace are invites from before invites went through
 * the server. They're sent once the plan has a team (sendLegacyInvites), and
 * none are added anymore, so a browser can only take them away: one can't put
 * back someone the account no longer has, as a stale tab would otherwise do.
 */
function withAccountMembers(list: Workspace[], remote: readonly Workspace[], local: readonly Workspace[]): Workspace[] {
  return list.map((row) => {
    const account = remote.find((other) => other.id === row.id)?.members ?? [];
    const here = local.find((other) => other.id === row.id);
    const members = here ? account.filter((member) => here.members.some((kept) => kept.email === member.email)) : account;
    return stable(members) === stable(row.members) ? row : { ...row, members };
  });
}

function unionSlices(remote: Body, local: Body, list: Workspace[], known: Known | null): Record<string, Slice> {
  const slices: Record<string, Slice> = {};
  for (const workspace of list) {
    const id = workspace.id;
    slices[id] = unionSlice(remote.slices[id] ?? emptySlice(), local.slices[id] ?? emptySlice(), known?.[id]);
  }
  return slices;
}

/**
 * Both copies' rows, for a copy with no last shared copy to merge against, as
 * in a new tab. With what this browser and the account last agreed on
 * (`known`), a row this browser hasn't changed since takes the account's
 * version, and one the account has deleted since stays deleted: someone else
 * may have changed it, as a team member does. Without, this browser's wins.
 * A row missing here is never deleted from the account this way.
 */
export function unionSlice(remote: Slice, local: Slice, known?: KnownSlice): Slice {
  return {
    connections: unionKnown(idRows(remote.connections), idRows(local.connections), known?.connections),
    groups: unionKnown(idRows(remote.groups), idRows(local.groups), known?.groups),
    queue: unionKnown(idRows(remote.queue), idRows(local.queue), known?.queue),
    boards: mergeBoards(local.boards, remote.boards),
    vault: unionKnown(idRows(remote.vault), idRows(local.vault), known?.vault),
    signatureId: local.signatureId ?? remote.signatureId,
    templates: unionKnown(idRows(remote.templates), idRows(local.templates), known?.templates),
    plugs: unionKnown(idRows(remote.plugs), idRows(local.plugs), known?.plugs),
    captionStyles: unionKnown(idRows(remote.captionStyles), idRows(local.captionStyles), known?.captionStyles),
    calendars: unionKnown(remote.calendars, local.calendars, known?.calendars),
    library: unionKnown(remote.library, local.library, known?.library),
  };
}

function unionKnown<T extends { id: string }>(remote: readonly T[], local: readonly T[], known?: Record<string, string>): T[] {
  if (!known) return unionById(remote, local);
  const rows = new Map(remote.map((row) => [row.id, row]));
  for (const row of local) {
    const was = known[row.id];
    const changedHere = was === undefined || was !== fingerprint(row);
    // Unchanged here since the last copy both had: the account's, or its delete, is the newer.
    if (changedHere) rows.set(row.id, row);
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// What this browser and the account last agreed on, row by row, as short
// fingerprints. Kept in this browser beside its copy, for every tab: a new
// tab has no last copy of its own, and merges against these.

const KNOWN_LISTS = ["connections", "groups", "queue", "vault", "templates", "plugs", "captionStyles", "calendars", "library"] as const;

/** Posts' fingerprints from when the account's copy still had them, kept for post-sync's first run (legacyKnownPosts). */
const LEGACY_LISTS = ["events", "media"] as const;

type KnownSlice = Partial<Record<(typeof KNOWN_LISTS)[number] | (typeof LEGACY_LISTS)[number], Record<string, string>>>;
type Known = Record<string, KnownSlice>;

const knownKey = (userId: string) => `plan.video.account-known.${userId}`;
/** The workspace list's rows, kept apart from the slices', whose keys are workspace ids. */
const knownWorkspacesKey = (userId: string) => `plan.video.account-known-workspaces.${userId}`;

/** FNV-1a of the row as stored. */
function fingerprint(row: unknown): string {
  const text = stable(row);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function rememberKnown(userId: string, body: Body) {
  const before = readKnown(userId);
  const known: Known = {};
  for (const [workspaceId, slice] of Object.entries(body.slices)) {
    const lists: KnownSlice = {};
    for (const list of LEGACY_LISTS) if (before?.[workspaceId]?.[list]) lists[list] = before[workspaceId][list];
    for (const list of KNOWN_LISTS) {
      // An older tab's copy that says nothing of the library leaves it unknown.
      if (list === "library" && slice.library === UNKNOWN_LIBRARY) continue;
      lists[list] = Object.fromEntries(idRows<{ id: string }>(slice[list] as unknown[]).map((row) => [row.id, fingerprint(row)]));
    }
    known[workspaceId] = lists;
  }
  writeJson(knownKey(userId), known);
  writeJson(knownWorkspacesKey(userId), Object.fromEntries(body.workspaces.list.map((row) => [row.id, fingerprint(row)])));
}

function readKnown(userId: string): Known | null {
  const parsed = readJson<unknown>(knownKey(userId));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Known) : null;
}

/** The posts of a workspace as the account's old copy last had them, by fingerprint: what post-sync's first run measures changes here against. */
export function legacyKnownPosts(userId: string, workspaceId: string): Record<string, string> | null {
  return readKnown(userId)?.[workspaceId]?.events ?? null;
}

/** A post's fingerprint as the account's old copy took it. */
export const legacyFingerprint = (event: StoredEvent) => fingerprint(event);

function readKnownWorkspaces(userId: string): Record<string, string> | undefined {
  const parsed = readJson<unknown>(knownWorkspacesKey(userId));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : undefined;
}

export function mergeSlice(base: Slice, local: Slice, remote: Slice): Slice {
  return {
    connections: mergeById(idRows(base.connections), idRows(local.connections), idRows(remote.connections)),
    groups: mergeById(idRows(base.groups), idRows(local.groups), idRows(remote.groups)),
    queue: mergeById(idRows(base.queue), idRows(local.queue), idRows(remote.queue)),
    boards: stable(local.boards) !== stable(base.boards) ? local.boards : remote.boards,
    vault: mergeById(idRows(base.vault), idRows(local.vault), idRows(remote.vault)),
    signatureId: local.signatureId !== base.signatureId ? local.signatureId : remote.signatureId,
    templates: mergeById(idRows(base.templates), idRows(local.templates), idRows(remote.templates)),
    plugs: mergeById(idRows(base.plugs), idRows(local.plugs), idRows(remote.plugs)),
    captionStyles: mergeById(idRows(base.captionStyles), idRows(local.captionStyles), idRows(remote.captionStyles)),
    calendars: mergeById(base.calendars, local.calendars, remote.calendars),
    library: mergeById(base.library, local.library, remote.library),
  };
}

/** `local` wins when both have the id. */
function unionById<T extends { id: string }>(remote: readonly T[], local: readonly T[]): T[] {
  const map = new Map<string, T>();
  for (const item of remote) map.set(item.id, item);
  for (const item of local) map.set(item.id, item);
  return [...map.values()];
}

/**
 * Three-way merge against the last copy both browsers shared. A row only this
 * browser changed is kept. A row only the other browser changed is taken.
 * A row both changed keeps this browser's copy. A delete sticks unless the
 * other browser edited that same row.
 */
function mergeById<T extends { id: string }>(base: readonly T[], local: readonly T[], remote: readonly T[]): T[] {
  const baseBy = new Map(base.map((item) => [item.id, stable(item)]));
  const localBy = new Map(local.map((item) => [item.id, item]));
  const remoteBy = new Map(remote.map((item) => [item.id, item]));
  const ids = new Set([...baseBy.keys(), ...localBy.keys(), ...remoteBy.keys()]);
  const out: T[] = [];
  for (const id of ids) {
    const here = localBy.get(id);
    const there = remoteBy.get(id);
    const before = baseBy.get(id);
    const hereSame = !!here && before !== undefined && stable(here) === before;
    const thereSame = !!there && before !== undefined && stable(there) === before;
    if (here && there) {
      out.push(hereSame && !thereSame ? there : here);
      continue;
    }
    if (here) {
      if (hereSame) continue;
      out.push(here);
      continue;
    }
    if (there && !thereSame) out.push(there);
  }
  return out;
}

function mergeBoards(local: string[], remote: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...local, ...remote]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 8);
}

function mergeNotes(remote: Notes, local: Notes): Notes {
  const seen = { ...remote.seen };
  for (const [id, at] of Object.entries(local.seen)) seen[id] = Math.max(seen[id] ?? 0, at);
  return {
    read: [...new Set([...remote.read, ...local.read])],
    cleared: [...new Set([...remote.cleared, ...local.cleared])],
    seen,
  };
}

function idRows<T extends { id: string }>(rows: unknown[]): T[] {
  return rows.filter((row): row is T => !!row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string");
}

export function emptySlice(): Slice {
  return { connections: [], groups: [], queue: [], boards: [], vault: [], signatureId: null, templates: [], plugs: [], captionStyles: [], calendars: [], library: [] };
}

function personalWorkspace(): Workspace {
  return newDefaultWorkspace(new Date(0).toISOString());
}

function asPayload(value: unknown): Payload | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Payload>;
  if (typeof row.revision !== "string") return null;
  const workspaces = row.workspaces;
  const list = Array.isArray(workspaces?.list) ? workspaces.list.map(asWorkspace).filter((item): item is Workspace => !!item) : [];
  if (!list.length) return null;
  const active = typeof workspaces?.active === "string" && list.some((item) => item.id === workspaces.active) ? workspaces.active : list[0]!.id;
  const slices: Record<string, Slice> = {};
  const rawSlices = row.slices && typeof row.slices === "object" ? row.slices : {};
  for (const workspace of list) slices[workspace.id] = asSlice((rawSlices as Record<string, unknown>)[workspace.id]);
  return canonicalize({
    revision: row.revision,
    workspaces: { active, list },
    timeZone: typeof row.timeZone === "string" ? row.timeZone : null,
    notifications: asNotes(row.notifications),
    projectFolders: Array.isArray(row.projectFolders) ? row.projectFolders.filter(isProjectFolder) : UNKNOWN_FOLDERS,
    gradePresets: Array.isArray(row.gradePresets) ? row.gradePresets.filter(isGradePreset) : UNKNOWN_GRADES,
    workflows: Array.isArray(row.workflows) ? readWorkflows(row.workflows) : UNKNOWN_WORKFLOWS,
    slices,
  });
}

/** A workspace's copy as stored, with anything that doesn't hold up left out. */
export function asSlice(value: unknown): Slice {
  const row = value && typeof value === "object" ? (value as Partial<Slice>) : {};
  return {
    connections: Array.isArray(row.connections) ? row.connections : [],
    groups: Array.isArray(row.groups) ? row.groups : [],
    queue: Array.isArray(row.queue) ? row.queue : [],
    boards: Array.isArray(row.boards) ? row.boards.filter((name): name is string => typeof name === "string") : [],
    vault: Array.isArray(row.vault) ? row.vault : [],
    signatureId: typeof row.signatureId === "string" ? row.signatureId : null,
    templates: Array.isArray(row.templates) ? row.templates : [],
    plugs: Array.isArray(row.plugs) ? row.plugs : [],
    captionStyles: Array.isArray(row.captionStyles) ? row.captionStyles : [],
    calendars: Array.isArray(row.calendars) ? row.calendars.filter(isCalendar) : [],
    library: Array.isArray(row.library) ? row.library.map(asLibraryItem).filter((item): item is LibraryItem => !!item) : UNKNOWN_LIBRARY,
  };
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function asLibraryItem(value: unknown): LibraryItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as LibraryItem;
  const cloud = row.cloud;
  if (typeof row.id !== "string" || !cloud || typeof cloud.key !== "string") return null;
  const kind = row.kind === "image" ? "image" : "video";
  return {
    id: row.id,
    name: typeof row.name === "string" && row.name ? row.name : kind === "image" ? "picture.jpg" : "video.mp4",
    kind,
    type: typeof row.type === "string" && row.type ? row.type : kind === "image" ? "image/jpeg" : "video/mp4",
    size: number(row.size),
    width: number(row.width),
    height: number(row.height),
    duration: number(row.duration),
    fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : row.id,
    lastModified: number(row.lastModified),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
    uses: number(row.uses),
    lastUsedAt: typeof row.lastUsedAt === "string" ? row.lastUsedAt : null,
    cloud: { key: cloud.key, at: typeof cloud.at === "string" ? cloud.at : new Date(0).toISOString() },
    cloudPoster: true,
  };
}

function isCalendar(value: unknown): value is Calendar {
  if (!value || typeof value !== "object") return false;
  const row = value as Calendar;
  return typeof row.id === "string" && typeof row.name === "string" && typeof row.color === "string";
}

function asNotes(value: unknown): Notes {
  if (!value || typeof value !== "object") return EMPTY_NOTES;
  const row = value as Partial<Notes>;
  const seen = row.seen && typeof row.seen === "object" ? row.seen : {};
  return {
    read: strings(row.read),
    cleared: strings(row.cleared),
    seen: Object.fromEntries(Object.entries(seen).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
  };
}

function asWorkspace(value: unknown): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Workspace;
  if (typeof row.id !== "string" || typeof row.name !== "string" || !row.name) return null;
  const icon = asWorkspaceIcon(row.icon);
  const shape = asWorkspaceShape(row.shape);
  return {
    id: row.id,
    name: row.name,
    color: row.color || "sky",
    // Left out when unset, so a browser that never chose one writes the same row.
    ...(icon ? { icon } : {}),
    ...(shape ? { shape } : {}),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(0).toISOString(),
    members: Array.isArray(row.members) ? row.members.filter(isMember) : [],
  };
}

function isMember(value: unknown): value is WorkspaceMember {
  if (!value || typeof value !== "object") return false;
  const row = value as WorkspaceMember;
  return typeof row.email === "string" && (row.role === "admin" || row.role === "member") && typeof row.invitedAt === "string";
}

/** Same rows in the same order on every browser, so a save doesn't bounce forever. */
function canonicalize<T extends Body | Payload>(body: T): T {
  const slices: Record<string, Slice> = {};
  for (const [id, slice] of Object.entries(body.slices)) slices[id] = canonicalSlice(slice);
  return {
    ...body,
    notifications: {
      read: body.notifications.read.slice().sort(),
      cleared: body.notifications.cleared.slice().sort(),
      seen: body.notifications.seen,
    },
    projectFolders: body.projectFolders === UNKNOWN_FOLDERS ? UNKNOWN_FOLDERS : byId(body.projectFolders),
    gradePresets: body.gradePresets === UNKNOWN_GRADES ? UNKNOWN_GRADES : byId(body.gradePresets),
    workflows: body.workflows === UNKNOWN_WORKFLOWS ? UNKNOWN_WORKFLOWS : byId(body.workflows),
    slices,
  };
}

/** One workspace's rows in the same order on every browser. */
export function canonicalSlice(slice: Slice): Slice {
  return {
    ...slice,
    connections: byId(idRows(slice.connections)),
    groups: byId(idRows(slice.groups)),
    queue: byId(idRows(slice.queue)),
    vault: byId(idRows(slice.vault)),
    templates: byId(idRows(slice.templates)),
    plugs: byId(idRows(slice.plugs)),
    captionStyles: byId(idRows(slice.captionStyles)),
    calendars: byId(slice.calendars),
    library: slice.library === UNKNOWN_LIBRARY ? UNKNOWN_LIBRARY : byId(slice.library),
  };
}

function byId<T extends { id: string }>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
