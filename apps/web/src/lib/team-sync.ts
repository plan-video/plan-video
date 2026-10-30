/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Shared workspaces' lists merge against the last copy both sides had. The server lets
// people reach only workspaces they're in and refuses a save over a copy that changed
// since it was read, so two people's edits merge rather than one replacing the other.
// Posts sync on their own (lib/post-sync.ts).

import type { RealtimeChannel } from "@supabase/supabase-js";
import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";

import {
  asSlice,
  canonicalSlice,
  fillLibrary,
  mergeSlice,
  readSlice,
  reloadWorkspaceStores,
  sliceHasContent,
  stable,
  unionSlice,
  writeSlice,
  type Slice,
} from "@/lib/account-sync";
import { onAccountEdited, setAccountApplying, setTeamSyncPending } from "@/lib/account-sync-bus";
import type { CalendarRead } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { refreshTeam, refreshTeamSoon } from "@/lib/team";
import { activeShared, isActiveWorkspace, onWorkspaceChange, sharedWorkspace, sharedWorkspaces, workspaceDatabaseFor, type SharedWorkspace } from "@/lib/workspaces";

/** The last copy both sides had, at the owner's revision then. */
type Copy = { revision: string; slice: Slice };

const RETRY_MS = [5_000, 15_000, 60_000, 5 * 60_000];
/** Read again this often in case a live update was missed. */
const POLL_MS = 60_000;
const PUSH_MS = 400;

const [problem, setProblem] = createSignal<{ message: string; since: number } | null>(null);

export const teamSyncProblem = problem;

let person: string | undefined;
let channel: RealtimeChannel | null = null;
let channelFor = "";
/** A topic per subscription: one made again under the topic of one still closing can miss changes. */
let channels = 0;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastRead = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<boolean>>();
const again = new Set<string>();
/** So the echo of a save isn't read again. */
const seen = new Map<string, string>();
/** Another tab can write a newer copy into the shared storage; this tab's stores are read again all the same. */
const shown = new Map<string, string>();

const COPY_BASE = "plan-video-team-copy";

async function withCopies<T>(userId: string, id: string, work: (database: IDBPDatabase) => Promise<T>): Promise<T> {
  const database = await openDB(workspaceDatabaseFor(COPY_BASE, userId, id), 1, {
    upgrade(created) {
      created.createObjectStore("copy");
    },
  });
  try {
    return await work(database);
  } finally {
    database.close();
  }
}

async function readCopy(userId: string, id: string): Promise<Copy | null> {
  try {
    const found = (await withCopies(userId, id, (database) => database.get("copy", "last"))) as Copy | undefined;
    return found && typeof found.revision === "string" ? { revision: found.revision, slice: asSlice(found.slice) } : null;
  } catch {
    return null;
  }
}

async function keepCopy(userId: string, id: string, copy: Copy) {
  try {
    await withCopies(userId, id, async (database) => {
      // A copy from before the posts table keeps its posts for post-sync's first run (readTeamCopyPosts).
      const before = (await database.get("copy", "last")) as { slice?: { events?: unknown }; posts?: unknown } | undefined;
      const posts = before?.posts ?? before?.slice?.events;
      await database.put("copy", Array.isArray(posts) ? { ...copy, posts } : copy, "last");
    });
  } catch {
    // Without it, the next merge keeps both sides' rows.
  }
}

/** Posts as last agreed before they moved to their own table, for post-sync's first run. */
export async function readTeamCopyPosts(userId: string, id: string): Promise<StoredEvent[] | null> {
  try {
    const found = (await withCopies(userId, id, (database) => database.get("copy", "last"))) as { slice?: { events?: unknown }; posts?: unknown } | undefined;
    const posts = found?.posts ?? found?.slice?.events;
    return Array.isArray(posts) ? (posts as StoredEvent[]) : null;
  } catch {
    return null;
  }
}

/** Does nothing when already running for this person. */
export function beginTeamSync(userId: string | undefined) {
  if (person === userId) return;
  person = userId;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  again.clear();
  seen.clear();
  shown.clear();
  failures = 0;
  clearTimeout(retryTimer);
  setProblem(null);
  opened();
  // Unsaved changes a closed tab left in other shared workspaces go now, one at a time;
  // only ones with a copy here can have any.
  if (userId) {
    const rest = sharedWorkspaces().filter((row) => row.state === "active" && row.id !== activeShared()?.id);
    void (async () => {
      for (const row of rest) if (person === userId && (await readCopy(userId, row.id))) await syncShared(row.id);
    })();
  }
}

/** The open shared workspace is read before its posts show. */
function opened() {
  follow();
  const open = person ? activeShared() : undefined;
  setTeamSyncPending(open ? syncShared(open.id).then(() => undefined) : Promise.resolve());
}

onWorkspaceChange(() => {
  if (problem() && !activeShared()) setProblem(null);
  opened();
});

onAccountEdited(() => {
  const open = activeShared();
  if (person && open) schedule(open.id);
});

if (typeof window !== "undefined") {
  const now = () => {
    const open = activeShared();
    if (person && open && !timers.has(open.id)) schedule(open.id, 0);
  };
  window.addEventListener("focus", now);
  window.addEventListener("online", now);
  // A change saved just before the tab is hidden or closed goes now, rather than after a pause the page may not live through.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    for (const [id, timer] of timers) {
      clearTimeout(timer);
      timers.delete(id);
      void syncShared(id);
    }
  });
  setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - lastRead > POLL_MS / 2) now();
  }, POLL_MS);
}

function schedule(id: string, delay = PUSH_MS) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void syncShared(id);
    }, delay),
  );
}

function follow() {
  const open = person ? activeShared() : undefined;
  const key = open ? `${person}:${open.scope.owner}` : "";
  if (key === channelFor) return;
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  channelFor = key;
  if (!open || !supabase) return;
  const owner = open.scope.owner;
  channel = supabase
    .channel(`team-workspace-${key}-${++channels}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "workspace_versions", filter: `owner_id=eq.${owner}` }, (payload) => {
      const row = payload.new as { workspace_id?: string; revision?: string } | undefined;
      const current = activeShared();
      if (!current || current.scope.owner !== owner || row?.workspace_id !== current.scope.workspace) return;
      // Renamed or given another picture: the shared list has it, even when posts didn't change.
      refreshTeamSoon();
      if (row.revision && row.revision === seen.get(current.id)) return;
      schedule(current.id, 0);
    })
    .subscribe((status) => {
      // Back after a dropped connection: read again in case something changed meanwhile.
      const current = activeShared();
      if (status === "SUBSCRIBED" && current && Date.now() - lastRead > 5_000) schedule(current.id, 0);
    });
}

/** For "Post now", which the publisher reads next. */
export async function flushTeamSync(): Promise<boolean> {
  const open = activeShared();
  if (!open || !person) return true;
  clearTimeout(timers.get(open.id));
  timers.delete(open.id);
  return syncShared(open.id);
}

export function retryTeamSync() {
  const open = activeShared();
  if (open) void syncShared(open.id);
}

/** Asked again while running, it runs once more after. True when both sides agree. */
export function syncShared(id: string): Promise<boolean> {
  const userId = person;
  const share = sharedWorkspace(id);
  if (!userId || !share || share.state !== "active" || !supabase) return Promise.resolve(true);
  const current = running.get(id);
  if (current) {
    again.add(id);
    return current;
  }
  const work = (async () => {
    let ok = false;
    try {
      do {
        again.delete(id);
        ok = await reconcile(userId, share);
      } while (again.has(id) && person === userId);
    } finally {
      running.delete(id);
    }
    return ok;
  })();
  running.set(id, work);
  return work;
}

function choose(remote: Copy, local: Slice, last: Copy | null): Slice {
  // Never in step here: a copy with nothing made in it takes the owner's, and one with work in it keeps both sides' rows.
  if (!last) return sliceHasContent(local) ? unionSlice(remote.slice, local) : remote.slice;
  if (last.revision === remote.revision) return local;
  return mergeSlice(last.slice, local, remote.slice);
}

// A cleared or recreated library database reads as everything deleted, which must never
// reach the owner's account.
function lostLocally(local: Slice, last: Copy | null, remote: Copy): Slice {
  if (!last) return local;
  if (!local.library.length && last.slice.library.length) return { ...local, library: remote.slice.library };
  return local;
}

async function reconcile(userId: string, share: SharedWorkspace): Promise<boolean> {
  const { owner, workspace } = share.scope;
  let adopt = false;
  try {
    for (let attempt = 1; attempt <= 4; attempt++) {
      lastRead = Date.now();
      const read = await supabase!.rpc("team_workspace", { owner, workspace });
      if (read.error) return await refused(userId, share, read.error);
      if (person !== userId) return false;
      const last = await readCopy(userId, share.id);
      // Posts as read now, so ones changed here before the write-back are kept.
      const reads = new Map<string, CalendarRead>();
      const stored = canonicalSlice(await readSlice(userId, share.id, reads));
      const found = read.data as { revision?: unknown; slice?: unknown };
      const remote: Copy = { revision: String(found.revision ?? ""), slice: canonicalSlice(fillLibrary(asSlice(found.slice), last?.slice ?? stored)) };
      const local = lostLocally(stored, last, remote);
      // Asked to: the server left something out of the last save, so its copy is the one to keep.
      let next = adopt ? remote.slice : canonicalSlice(choose(remote, local, last));
      // A member's copy can't change the workspace's accounts: the server keeps the owner's, and so does this.
      if (sharedWorkspace(share.id)?.role === "member") next = { ...next, connections: remote.slice.connections };
      if (person !== userId) return false;
      const stale = shown.has(share.id) && shown.get(share.id) !== remote.revision;
      // A post changed here while this ran stays as it is, and is saved by the run this asks for.
      if ((stable(next) !== stable(stored) || stale) && (await apply(userId, share.id, next, reads.get(share.id)))) again.add(share.id);
      shown.set(share.id, remote.revision);
      // This browser's copy now has the owner's: a save refused below merges the newer copy against it, not the older one.
      await keepCopy(userId, share.id, remote);
      if (stable(next) === stable(remote.slice)) {
        seen.set(share.id, remote.revision);
        return settled();
      }
      const saved = await supabase!.rpc("save_team_workspace", { owner, workspace, slice: next, base: remote.revision });
      if (saved.error) return await refused(userId, share, saved.error);
      const answer = saved.data as { conflict?: boolean; revision?: unknown; same?: boolean } | null;
      // Someone saved the owner's account since it was read: merge with theirs and try again.
      if (answer?.conflict) continue;
      const revision = String(answer?.revision ?? "");
      seen.set(share.id, revision);
      shown.set(share.id, revision);
      if (answer?.same === false) {
        // Something here wasn't the workspace's to save, and was left out: read the copy as saved and keep that.
        adopt = true;
        continue;
      }
      await keepCopy(userId, share.id, { revision, slice: next });
      return settled();
    }
    return await failed(userId, share);
  } catch (error) {
    console.error("[team] Could not sync the shared workspace", error);
    return await failed(userId, share);
  }
}

/** True when posts changed here since `read` were kept as they are. */
async function apply(userId: string, id: string, slice: Slice, read?: CalendarRead): Promise<boolean> {
  setAccountApplying(true);
  try {
    const kept = await writeSlice(userId, id, slice, read);
    if (isActiveWorkspace(userId, id)) reloadWorkspaceStores(userId);
    return kept;
  } finally {
    setAccountApplying(false);
  }
}

function settled(): true {
  failures = 0;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  if (problem()) setProblem(null);
  return true;
}

/** Reading the shared list again closes a workspace the person left or that's gone. */
async function refused(userId: string, share: SharedWorkspace, error: { code?: string; message?: string }): Promise<false> {
  if (error.code === "42501" || error.code === "P0002") {
    void refreshTeam();
    return false;
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(error.message ?? "")) console.warn("[team] Could not reach the shared workspace", error.message);
  else console.error("[team] The shared workspace refused the sync", error);
  return failed(userId, share);
}

async function failed(userId: string, share: SharedWorkspace): Promise<false> {
  failures++;
  const message = navigator.onLine === false ? t("This browser is offline") : t("plan.video can't reach {workspace} right now", { workspace: share.name });
  setProblem((current) => (current?.message === message ? current : { message, since: current?.since ?? Date.now() }));
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (person === userId && activeShared()?.id === share.id) void syncShared(share.id);
  }, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
  return false;
}
