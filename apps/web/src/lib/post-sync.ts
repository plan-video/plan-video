/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keeps each workspace's posts in this browser in step with the posts table
// (supabase/migrations/20261026090000_posts.sql), one post at a time, by the
// rules in lib/post-sync-core.ts. The person's own workspaces and the ones
// shared with them sync the same way: the table's rules let each person
// reach only the workspaces they're in.
//
// A workspace is read again when this browser changes one of its posts, when
// another browser does (Realtime on posts), when the tab comes back into view
// or online, and every minute while it's in view, in case a live change was
// missed. Every signed-in tab syncs, so a post an AI agent makes in a tab that
// never opened the dashboard reaches the account too.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSignal } from "solid-js";

import { everyFileOf, readCalendarSnapshot, readPostSync, writePostSync, writeWorkspacePosts, type CalendarRead } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";
import { legacyFingerprint, legacyKnownPosts, onePostsCalendar } from "@/lib/account-sync";
import { onAccountEdited, setAccountApplying, setPostSyncPending } from "@/lib/account-sync-bus";
import { t } from "@/lib/i18n";
import { changedSince, syncPosts, type PostData, type PostRow, type Sent, type SyncIO } from "@/lib/post-sync-core";
import { POST_COLUMNS, readPostRows } from "@/lib/post-rows";
import { supabase } from "@/lib/supabase";
import { readTeamCopyPosts } from "@/lib/team-sync";
import { activeWorkspaceId, onWorkspaceChange, sharedWorkspaces, workspaces } from "@/lib/workspaces";

/** One workspace's posts: whose and which on the server, and its id in this browser. */
type Scope = { key: string; local: string; owner: string; workspace: string; name: string; shared: boolean };

const COLUMNS = POST_COLUMNS;
const PUSH_MS = 400;
const LIVE_MS = 300;
const POLL_MS = 60_000;
/** Waits before trying again after a run failed, longer each time in a row. */
const RETRY_MS = [5_000, 15_000, 60_000, 5 * 60_000];

const [problem, setProblem] = createSignal<{ message: string; since: number } | null>(null);
const [unsynced, setUnsynced] = createSignal<ReadonlySet<string>>(new Set());
const [refused, setRefused] = createSignal<ReadonlyMap<string, string>>(new Map());

/** Why changes made here aren't reaching the server, and since when, while they aren't. */
export const postSyncProblem = problem;
/** Posts changed here that the server doesn't have yet: the publisher sends from the server's. */
export const unsyncedPosts = unsynced;
/** Posts the server turned down, and why, until they change. */
export const refusedPosts = refused;

let person: string | undefined;
let lastRead = 0;
/** Each workspace's own trouble: its runs failed in a row, its next try, and why. One workspace syncing fine leaves another's alone. */
const failures = new Map<string, number>();
const retries = new Map<string, ReturnType<typeof setTimeout>>();
const problems = new Map<string, { message: string; since: number }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<boolean>>();
const again = new Set<string>();
/** Each post this tab wrote, with the time of the change it made, so the live echo of that write isn't read again. */
const wrote = new Map<string, string>();
/** Unsynced and refused posts by workspace, merged into the signals above. */
const unsyncedBy = new Map<string, Set<string>>();
const refusedBy = new Map<string, Map<string, string>>();
const channels = new Map<string, RealtimeChannel>();
let channelSerial = 0;

// ---------------------------------------------------------------------------
// Which workspaces

function scopes(): Scope[] {
  const userId = person;
  if (!userId) return [];
  const own = workspaces().map((row) => ({ key: `${userId}|${row.id}`, local: row.id, owner: userId, workspace: row.id, name: row.name, shared: false }));
  const shared = sharedWorkspaces()
    .filter((row) => row.state === "active")
    .map((row) => ({ key: `${row.scope.owner}|${row.scope.workspace}`, local: row.id, owner: row.scope.owner, workspace: row.scope.workspace, name: row.name, shared: true }));
  return [...own, ...shared];
}

const activeScope = () => scopes().find((scope) => scope.local === activeWorkspaceId());

// ---------------------------------------------------------------------------
// When to sync

/** Starts keeping this person's posts in step, in this tab. A second call for the same person does nothing. */
export function beginPostSync(userId: string | undefined) {
  if (person === userId) return;
  person = userId;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  again.clear();
  wrote.clear();
  unsyncedBy.clear();
  refusedBy.clear();
  for (const timer of retries.values()) clearTimeout(timer);
  retries.clear();
  failures.clear();
  problems.clear();
  publish();
  follow();
  const open = activeScope();
  const first = open ? syncScope(open) : Promise.resolve(true);
  setPostSyncPending(first.then(() => undefined));
  if (userId) {
    // The others, one at a time, after the open one: a change a closed tab didn't get to save goes now.
    void first.then(async () => {
      for (const scope of scopes()) if (person === userId && scope.key !== open?.key) await syncScope(scope);
    });
  }
}

onWorkspaceChange(() => {
  follow();
  const open = activeScope();
  setPostSyncPending(open ? syncScope(open).then(() => undefined) : Promise.resolve());
});

onAccountEdited(() => {
  const open = activeScope();
  if (person && open) schedule(open, PUSH_MS);
});

if (typeof window !== "undefined") {
  const now = () => {
    const open = activeScope();
    if (person && open && !timers.has(open.key)) schedule(open, 0);
  };
  window.addEventListener("focus", now);
  window.addEventListener("online", now);
  // A change saved just before the tab is hidden or closed goes now, rather than after a pause the page may not live through.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    for (const [key, timer] of timers) {
      clearTimeout(timer);
      timers.delete(key);
      const scope = scopes().find((item) => item.key === key);
      if (scope) void syncScope(scope);
    }
  });
  setInterval(() => {
    if (document.visibilityState === "visible" && Date.now() - lastRead > POLL_MS / 2) now();
  }, POLL_MS);
}

function schedule(scope: Scope, delay: number) {
  clearTimeout(timers.get(scope.key));
  timers.set(
    scope.key,
    setTimeout(() => {
      timers.delete(scope.key);
      void syncScope(scope);
    }, delay),
  );
}

/** Hears every change to the posts of the person's own workspaces, and of each owner who shared one: the table's rules pass on only the ones they may see. */
function follow() {
  const wanted = new Set(person && supabase ? scopes().map((scope) => scope.owner) : []);
  for (const [owner, channel] of channels) {
    if (wanted.has(owner)) continue;
    void supabase?.removeChannel(channel);
    channels.delete(owner);
  }
  for (const owner of wanted) {
    if (channels.has(owner)) continue;
    const channel = supabase!
      .channel(`posts-${owner}-${++channelSerial}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `owner_id=eq.${owner}` }, (payload) => {
        const row = payload.new as { id?: string; workspace_id?: string; updated_at?: string } | undefined;
        if (!row?.id || !row.workspace_id) return;
        // This tab's own write, coming back. Times are compared as moments: the live message and the API may write them differently.
        const mine = wrote.get(`${owner}|${row.workspace_id}|${row.id}`);
        if (mine && row.updated_at && Date.parse(mine) === Date.parse(row.updated_at)) return;
        const scope = scopes().find((item) => item.owner === owner && item.workspace === row.workspace_id);
        if (scope) schedule(scope, LIVE_MS);
      })
      .subscribe((status) => {
        // Back after a dropped connection: read again, in case something changed meanwhile.
        const open = activeScope();
        if (status === "SUBSCRIBED" && open?.owner === owner && Date.now() - lastRead > 5_000) schedule(open, 0);
      });
    channels.set(owner, channel);
  }
}

/**
 * Saves this browser's changes to the open workspace's posts now, for
 * something on the server that reads them next, as Post now. With `postId`,
 * says whether that post reached the server, whatever another post's trouble;
 * without, whether the workspace's posts did.
 */
export async function flushPostSync(postId?: string): Promise<boolean> {
  const open = activeScope();
  if (!open || !person || !supabase) return true;
  clearTimeout(timers.get(open.key));
  timers.delete(open.key);
  // A run already going may have read the posts before the latest change: it runs once more, which this waits for.
  const ok = await syncScope(open);
  return postId ? !problems.has(open.key) && !unsynced().has(postId) : ok;
}

/** Brings the person's own workspaces' posts in step now, as before one of them is deleted. False when any couldn't be. */
export async function flushAllPosts(): Promise<boolean> {
  let ok = true;
  for (const scope of scopes()) if (!scope.shared && !(await syncScope(scope))) ok = false;
  return ok;
}

/** Tries again now, rather than at the next retry: every workspace in trouble. */
export function retryPostSync() {
  for (const scope of scopes()) if (problems.has(scope.key) || scope.key === activeScope()?.key) void syncScope(scope);
}

/** One workspace in step. Asked again while it runs, it runs once more after. True when both sides agree. */
function syncScope(scope: Scope): Promise<boolean> {
  const userId = person;
  if (!userId || !supabase) return Promise.resolve(true);
  const current = running.get(scope.key);
  if (current) {
    // It runs once more when it ends, with what changed meanwhile.
    again.add(scope.key);
    return current;
  }
  const work = (async () => {
    let ok = false;
    try {
      let runs = 0;
      do {
        again.delete(scope.key);
        ok = await locked(scope, () => run(userId, scope));
      } while (again.has(scope.key) && person === userId && ++runs < 5);
    } finally {
      running.delete(scope.key);
    }
    return ok;
  })();
  running.set(scope.key, work);
  return work;
}

/** One tab of this browser at a time works on a workspace's posts: they share its database. */
function locked<T>(scope: Scope, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? (locks.request(`plan.video.posts.${scope.key}`, work) as Promise<T>) : work();
}

// ---------------------------------------------------------------------------
// One run

async function run(userId: string, scope: Scope): Promise<boolean> {
  lastRead = Date.now();
  try {
    const result = await syncPosts(io(userId, scope));
    if (person !== userId) return false;
    if (result.again) again.add(scope.key);
    note(scope, result.unsynced, result.refused);
    settled(scope);
    return result.ok;
  } catch (error) {
    // Offline, or a workspace this person can't reach just now (a team paused): tried again later, not a fault.
    if ((error as { unreachable?: boolean })?.unreachable || /Failed to fetch|NetworkError|Load failed/i.test(String((error as Error)?.message))) {
      console.warn("[posts] Could not reach the server", (error as Error).message);
    } else console.error("[posts] Could not sync the posts", error);
    return failed(userId, scope);
  }
}

function note(scope: Scope, unsyncedHere: ReadonlySet<string>, refusedHere: ReadonlyMap<string, string>) {
  unsyncedBy.set(scope.key, new Set(unsyncedHere));
  refusedBy.set(scope.key, new Map(refusedHere));
  publish();
}

function publish() {
  setUnsynced(new Set([...unsyncedBy.values()].flatMap((ids) => [...ids])));
  setRefused(new Map([...refusedBy.values()].flatMap((reasons) => [...reasons])));
  // The workspace in trouble longest says why; it's shown since its trouble began.
  const oldest = [...problems.values()].sort((a, b) => a.since - b.since)[0];
  setProblem((current) => (!oldest ? null : current?.message === oldest.message && current.since === oldest.since ? current : oldest));
}

/** A run that reached the server: this workspace's trouble is over, whatever another's. */
function settled(scope: Scope) {
  failures.delete(scope.key);
  clearTimeout(retries.get(scope.key));
  retries.delete(scope.key);
  if (problems.delete(scope.key)) publish();
}

/** Tried again on its own, soon at first; meanwhile the posts changed here that the server lacks are named. */
async function failed(userId: string, scope: Scope): Promise<false> {
  const count = (failures.get(scope.key) ?? 0) + 1;
  failures.set(scope.key, count);
  const message = navigator.onLine === false ? t("This browser is offline") : scope.shared ? t("plan.video can't reach {workspace} right now", { workspace: scope.name }) : t("plan.video can't reach your account right now");
  const before = problems.get(scope.key);
  problems.set(scope.key, { message, since: before?.since ?? Date.now() });
  publish();
  try {
    const [snapshot, state] = await Promise.all([readCalendarSnapshot(userId, scope.local), readPostSync(userId, scope.local)]);
    if (snapshot) note(scope, changedSince(snapshot.events, snapshot.media, state.bases, everyFileOf), refusedBy.get(scope.key) ?? new Map());
  } catch {
    // Unreadable here too: nothing more to name.
  }
  clearTimeout(retries.get(scope.key));
  retries.set(
    scope.key,
    setTimeout(() => {
      retries.delete(scope.key);
      if (person === userId) void syncScope(scope);
    }, RETRY_MS[Math.min(count, RETRY_MS.length) - 1]),
  );
  return false;
}

// ---------------------------------------------------------------------------
// This browser and the server, as the rules see them

/** Postgres's codes for a write the table's rules turn down: a file of another workspace, a post that doesn't hold up, too large. */
const REFUSED_CODES = new Set(["42501", "23514", "22001", "54000"]);

type Problem = { code?: string; message?: string } | null;

/**
 * Whether the server turned the post itself down, for what's in it: kept
 * until the post changes. One the access rules turned away (a team paused, a
 * workspace left) is a failed run instead, tried again later.
 */
const REFUSED = { has: (code: string, error?: Problem) => REFUSED_CODES.has(code) && !/row-level security/i.test(error?.message ?? "") };

function fail(error: Problem): never {
  throw Object.assign(new Error(error?.message || "The server didn't answer."), { code: error?.code });
}

function io(userId: string, scope: Scope): SyncIO<CalendarRead> {
  const db = supabase!;
  const own = { owner_id: scope.owner, workspace_id: scope.workspace };
  // Noted the moment the server answers: the live echo of the write can arrive before the run ends.
  const mine = (id: string, at: string | null | undefined) => {
    if (at) wrote.set(`${scope.owner}|${scope.workspace}|${id}`, at);
  };
  return {
    async readLocal() {
      const snapshot = await readCalendarSnapshot(userId, scope.local);
      if (!snapshot) throw new Error("Could not read posts");
      // The automatic Posts calendar's one id (see account-sync's onePostsCalendar) reaches the posts in it too.
      return { events: onePostsCalendar(snapshot.calendars, snapshot.events).events, media: snapshot.media, read: snapshot.read };
    },
    async writeLocal(events, media, read) {
      setAccountApplying(true);
      try {
        return await writeWorkspacePosts(userId, scope.local, { events, media }, read);
      } finally {
        setAccountApplying(false);
      }
    },
    readState: () => readPostSync(userId, scope.local),
    writeState: (cursor, bases) => writePostSync(userId, scope.local, cursor, bases),
    fetchRows: (since) => readPostRows(db, scope.owner, scope.workspace, since),
    async fetchRow(id) {
      const { data, error } = await db.from("posts").select(COLUMNS).match({ ...own, id }).maybeSingle();
      if (error) fail(error);
      return (data as unknown as PostRow) ?? null;
    },
    async insert(id, data): Promise<Sent> {
      const { data: made, error } = await db.from("posts").insert({ ...own, id, data }).select(COLUMNS).maybeSingle();
      if (error?.code === "23505") return { exists: true };
      if (error && REFUSED.has(error.code ?? "", error)) return { refused: error.message };
      if (error) fail(error);
      mine(id, (made as unknown as PostRow | null)?.updated_at);
      return { ok: made as unknown as PostRow };
    },
    async update(id, version, values): Promise<Sent> {
      const change = "data" in values ? { data: values.data as PostData, deleted_at: null } : { deleted_at: new Date().toISOString() };
      const { data: changed, error } = await db.from("posts").update(change).match({ ...own, id, version }).select(COLUMNS);
      if (error && REFUSED.has(error.code ?? "", error)) return { refused: error.message };
      if (error) fail(error);
      const [row] = (changed ?? []) as unknown as PostRow[];
      mine(id, row?.updated_at);
      return row ? { ok: row } : { moved: true };
    },
    async fetchThumbnails(ids) {
      const found = new Map<string, string>();
      for (let index = 0; index < ids.length; index += 100) {
        const { data, error } = await db.from("post_thumbnails").select("post_id,thumbnail").eq("owner_id", scope.owner).in("post_id", ids.slice(index, index + 100));
        if (error) fail(error);
        for (const row of (data ?? []) as { post_id: string; thumbnail: string }[]) found.set(row.post_id, row.thumbnail);
      }
      return found;
    },
    async saveThumbnail(id, thumbnail) {
      if (!thumbnail) {
        const { error } = await db.from("post_thumbnails").delete().match({ owner_id: scope.owner, post_id: id });
        if (error) fail(error);
        // The post's time moved to the removal's: read back, so the tab knows the change for its own.
        const { data, error: unread } = await db.from("posts").select("thumbnail_at").match({ ...own, id }).maybeSingle();
        if (unread) fail(unread);
        const at = (data as { thumbnail_at?: string | null } | null)?.thumbnail_at ?? null;
        mine(id, at);
        return at;
      }
      const { data, error } = await db
        .from("post_thumbnails")
        .upsert({ owner_id: scope.owner, post_id: id, thumbnail }, { onConflict: "owner_id,post_id" })
        .select("updated_at")
        .maybeSingle();
      // Its post isn't on the server (deleted, or turned down): nothing to keep the picture with.
      if (error?.code === "23503" || (error && REFUSED.has(error.code ?? "", error)) || /row-level security/i.test(error?.message ?? "")) return "gone";
      if (error) fail(error);
      const at = (data as { updated_at?: string } | null)?.updated_at ?? null;
      mine(id, at);
      return at;
    },
    async legacyKnown() {
      if (!scope.shared) return legacyKnownPosts(userId, scope.local);
      // A shared workspace's: team-sync's last copy, from before posts moved.
      const posts = await readTeamCopyPosts(userId, scope.local);
      return posts ? Object.fromEntries(posts.map((event) => [event.id, legacyFingerprint(event)])) : null;
    },
    legacyFingerprint: (event: StoredEvent) => legacyFingerprint(event),
    filesOf: everyFileOf,
  };
}
