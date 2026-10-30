/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { openDB, type DBSchema } from "idb";
import { createSignal } from "solid-js";
import { toast } from "somoto";
import { queueAccountSync, waitForAccountSync } from "@/lib/account-sync-bus";
import {
  cloudEnabled,
  CloudError,
  cloudHoldUps,
  cloudReadUrl,
  deleteFromCloud,
  isSentCopy,
  queueCloud,
  settleInCloud,
  uploadToCloud,
  type CloudCopy,
} from "@/lib/cloud-storage";
import { inGuestMode } from "@/lib/guest";
import { msg, t } from "@/lib/i18n";
import { accountsFor, accountsForPlatforms, readChoices, socialConnections, type AccountChoices } from "@/lib/social-connections";
import { scheduledLimit } from "@/lib/plans";
import { convertWallClock, dayKeyAt, deviceTimeZone, momentOf, timeZone } from "@/lib/time-zone";
import { activeScope, isActiveWorkspace, onWorkspaceChange, scopeOf, workspaceDatabase, workspaceDatabaseFor, type TeamScope } from "@/lib/workspaces";
import {
  daysBetween,
  getMonthDays,
  getWeekDays,
  isDateKey,
  isWeekdayName,
  matchesRecurrence,
  newId,
  normalizeColor,
  normalizePlatforms,
  occurrenceId,
  parseRecurrence,
  recurrenceAfterMove,
  resolveRepeatEnd,
  shiftDay,
  WEEKDAY_NAMES,
} from "./utils";
import type { Base } from "@/lib/post-sync-core";
import type { TikTokPostSettings, YouTubePostSettings } from "@/lib/social";
import type {
  Calendar,
  CalendarEvent,
  Delivery,
  EventDraft,
  PostStatus,
  PostStatusFilter,
  StoredEvent,
} from "./types";

// The calendar keeps its own database so the projects one stays untouched.

interface CalendarDB extends DBSchema {
  calendars: { key: string; value: Calendar };
  events: { key: string; value: StoredEvent };
  media: { key: string; value: { id: string; file: File; cloud?: CloudCopy } };
  /** Kept beside the posts, so a database cleared or remade loses both and rereads the server's. */
  syncBases: { key: string; value: Base };
  syncState: { key: string; value: string };
}

const DB_BASE = "plan-video-calendar";
const DB_VERSION = 3;

let dbPromise: Promise<import("idb").IDBPDatabase<CalendarDB>> | null = null;

function upgradeCalendarDb(database: import("idb").IDBPDatabase<CalendarDB>, oldVersion: number) {
  if (oldVersion < 1) {
    database.createObjectStore("calendars", { keyPath: "id" });
    database.createObjectStore("events", { keyPath: "id" });
  }
  if (oldVersion < 2) database.createObjectStore("media", { keyPath: "id" });
  if (oldVersion < 3) {
    database.createObjectStore("syncBases");
    database.createObjectStore("syncState");
  }
}

function db() {
  dbPromise ??= openDB<CalendarDB>(workspaceDatabase(DB_BASE), DB_VERSION, {
    upgrade: upgradeCalendarDb,
    // Another tab is opening a newer version: let it, and reopen on the next read.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
      dbPromise = null;
    },
  });
  return dbPromise;
}

async function withWorkspaceDb<T>(
  userId: string,
  workspaceId: string,
  work: (database: import("idb").IDBPDatabase<CalendarDB>) => Promise<T>,
): Promise<T> {
  if (dbPromise && isActiveWorkspace(userId, workspaceId)) return work(await db());
  const database = await openDB<CalendarDB>(workspaceDatabaseFor(DB_BASE, userId, workspaceId), DB_VERSION, {
    upgrade: upgradeCalendarDb,
    // Another tab opening a newer version waits for this one only as long as it runs.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
    },
  });
  try {
    return await work(database);
  } finally {
    database.close();
  }
}

export type AccountMedia = {
  id: string;
  name: string;
  type: string;
  lastModified: number;
  cloud?: CloudCopy;
};

const [calendars, setCalendars] = createSignal<Calendar[]>([]);
/** Each post in the zone it was written in; read them through `shown`. */
const [storedEvents, setStoredEvents] = createSignal<StoredEvent[]>([]);
const [loaded, setLoaded] = createSignal(false);
const [loadError, setLoadError] = createSignal<string | null>(null);
const [pendingSaves, setPendingSaves] = createSignal(0);

export { calendars, loaded, loadError };
export const saving = () => pendingSaves() > 0;

const [hiddenCalendars, setHiddenCalendars] = createSignal<ReadonlySet<string>>(new Set());
const [statusFilter, setStatusFilter] = createSignal<PostStatusFilter>("all");
const [pickedAccount, setAccountFilter] = createSignal<string | null>(null);

export { hiddenCalendars, setAccountFilter, setStatusFilter, statusFilter };

export function accountFilter() {
  const id = pickedAccount();
  return id && socialConnections().some((item) => item.id === id) ? id : null;
}

export function goesOutFromPicked(post: { platforms: readonly string[]; accounts?: AccountChoices }) {
  const id = accountFilter();
  if (!id) return true;
  const account = socialConnections().find((item) => item.id === id);
  if (!account || !post.platforms.includes(account.platform)) return false;
  return accountsFor(account.platform, post.accounts).some((item) => item.id === id);
}

export function toggleCalendar(id: string) {
  setHiddenCalendars((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

let hydrating: Promise<void> | null = null;
/** Bumped on a workspace switch, so a read from the last workspace's database lands nowhere. */
let generation = 0;
/** Bumped when the account copy rewrites the active workspace's posts, so a read that overlapped it is done again. */
let accountWrites = 0;

const SYNC_WAIT_MS = 3000;

export function hydrateCalendar() {
  hydrating ??= (async () => {
    const run = generation;
    await Promise.race([waitForAccountSync(), new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_MS))]);
    if (run !== generation) return;
    try {
      const database = await db();
      if (run !== generation) return;
      let found: Calendar[];
      let events: StoredEvent[];
      for (;;) {
        const writes = accountWrites;
        found = await database.getAll("calendars");
        events = await database.getAll("events");
        if (run !== generation) return;
        if (found.length === 0) {
          const first: Calendar = { color: "sky", createdAt: new Date().toISOString(), id: "posts", name: msg("Posts") };
          await database.put("calendars", first);
          if (run !== generation) return;
          found = [first];
          queueAccountSync();
        }
        if (writes === accountWrites) break;
      }
      events = events.map(interrupted);
      setCalendars(found.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      setStoredEvents(events);
      void pruneMedia(new Set(events.flatMap(everyFileOf)), run)
        .then(() => backUpPostMedia(events, run))
        .catch(() => undefined);
    } catch (e) {
      if (run === generation) setLoadError((e as Error).message || msg("The calendar could not be opened."));
    } finally {
      if (run === generation) setLoaded(true);
    }
  })();
  return hydrating;
}

onWorkspaceChange(() => {
  const reopen = hydrating !== null;
  const previous = dbPromise;
  generation++;
  dbPromise = null;
  hydrating = null;
  setCalendars([]);
  setStoredEvents([]);
  setHiddenCalendars(new Set<string>());
  setLoadError(null);
  setLoaded(false);
  void previous?.then((database) => database.close()).catch(() => undefined);
  if (reopen) void hydrateCalendar();
});

const PAGE_CLOSED = msg("The page closed before it finished.");

/** Sending stops with the page, so a post still sending when it closed didn't finish. */
function interrupted(event: StoredEvent): StoredEvent {
  const deliveries = event.deliveries ?? {};
  if (!Object.values(deliveries).some((delivery) => delivery?.state === "sending")) return event;
  const next: StoredEvent = {
    ...event,
    deliveries: Object.fromEntries(
      Object.entries(deliveries).map(([platform, delivery]) => [
        platform,
        delivery?.state === "sending" ? { ...delivery, state: "failed", error: PAGE_CLOSED } : delivery,
      ]),
    ),
  };
  // This failure is only for this page. The account copy keeps "sending", so another browser's upload is left alone.
  void persist((database) => database.put("events", next), { sync: false, rows: [`event:${next.id}`] });
  return next;
}

/** A local "page closed" failure is still sending in the account copy. */
function forAccount(event: StoredEvent): StoredEvent {
  const deliveries = event.deliveries ?? {};
  let changed = false;
  const next: NonNullable<StoredEvent["deliveries"]> = {};
  for (const [platform, delivery] of Object.entries(deliveries)) {
    if (delivery?.state === "failed" && delivery.error === PAGE_CLOSED) {
      const { error: _error, ...rest } = delivery;
      next[platform] = { ...rest, state: "sending" };
      changed = true;
    } else next[platform] = delivery;
  }
  return changed ? { ...event, deliveries: next } : event;
}

/** Media is kept past a delete so Undo can bring the post back whole. It goes on the next load. */
async function pruneMedia(kept: ReadonlySet<string>, run: number) {
  // A shared workspace's files are in its owner's cloud storage.
  const team = activeScope();
  const database = await db();
  const ids = await database.getAllKeys("media");
  if (run !== generation) return;
  const gone = ids.filter((id) => !kept.has(id));
  if (!gone.length) return;
  const tx = database.transaction("media", "readwrite");
  await Promise.all([...gone.map((id) => tx.store.delete(id)), tx.done]);
  queueCloud(`posts-delete:${gone.join(",")}`, () => deleteFromCloud("posts", gone, team));
  queueAccountSync();
}

// Cloud storage deletes a waiting post's copy 70 days after upload, so renew it before then.
const RENEW_AFTER_MS = 50 * 24 * 60 * 60 * 1000;

const needsCopy = (cloud: CloudCopy | undefined) =>
  !cloud || isSentCopy(cloud) || Date.now() - Date.parse(cloud.at) > RENEW_AFTER_MS;

type MediaRecord = CalendarDB["media"]["value"];

async function backUpPostMedia(events: readonly StoredEvent[], run: number) {
  if (!cloudEnabled || run !== generation) return;
  const posted = new Set(events.filter((event) => event.status === "posted").flatMap(everyFileOf));
  const sent: string[] = [];
  for (const record of await (await db()).getAll("media")) {
    if (!posted.has(record.id)) {
      if (needsCopy(record.cloud)) backUpFile(record.id, run);
    } else if (!isSentCopy(record.cloud)) sent.push(record.id);
  }
  keepSent(sent, run);
}

const wentOut = (id: string) => storedEvents().some((event) => event.status === "posted" && everyFileOf(event).includes(id));

async function saveCopy(record: MediaRecord, cloud: CloudCopy, run: number) {
  const database = await db();
  const latest = await database.get("media", record.id);
  const same = latest && latest.file.size === record.file.size && latest.file.lastModified === record.file.lastModified && latest.file.name === record.file.name;
  if (run === generation && same) {
    await database.put("media", { ...latest, cloud });
    queueAccountSync();
  }
}

function backUpFile(id: string, run = generation) {
  queueCloud(`posts:${id}`, async () => {
    if (run !== generation) return;
    const team = activeScope();
    if (wentOut(id)) return keepSent([id], run);
    const record = await (await db()).get("media", id);
    if (!record || !needsCopy(record.cloud)) return;
    await saveCopy(record, await uploadToCloud({ purpose: "posts", id }, record.file, { team }), run);
  });
}

/** Files in the post history no longer count against the plan. */
function keepSent(ids: readonly string[], run = generation) {
  if (!cloudEnabled || !ids.length) return;
  queueCloud(`posts-sent:${ids.join(",")}`, async () => {
    if (run !== generation) return;
    const team = activeScope();
    const database = await db();
    const records: MediaRecord[] = [];
    for (const id of ids) {
      const record = await database.get("media", id);
      if (record?.file && wentOut(id) && !isSentCopy(record.cloud)) records.push(record);
    }
    const byId = new Map(records.map((record) => [record.id, record]));
    const { sent, missing } = await settleInCloud(
      records.filter((record) => record.cloud).map((record) => ({ id: record.id, size: record.file.size })),
      team,
    );
    const at = new Date().toISOString();
    for (const { id, key } of sent) {
      const record = byId.get(id);
      if (record) await saveCopy(record, { key, at }, run);
    }
    const gone = new Set(missing);
    for (const record of records) {
      if (record.cloud && !gone.has(record.id)) continue;
      if (run !== generation) return;
      try {
        await saveCopy(record, await uploadToCloud({ purpose: "posts", id: record.id }, record.file, { sent: true, team }), run);
      } catch (error) {
        // One file refused, say a picture over the size limit, doesn't hold up the rest.
        if (!(error instanceof CloudError) || error.status !== 400) throw error;
      }
    }
  });
}

/** Unsaved on-screen rows (`event:<id>` / `calendar:<id>`) with saves in flight; a sync's write leaves them as shown. */
const unsaved = new Map<string, number>();

async function persist(
  work: (database: import("idb").IDBPDatabase<CalendarDB>) => Promise<unknown>,
  options?: { sync?: boolean; rows?: readonly string[] },
) {
  const rows = options?.rows ?? [];
  for (const row of rows) unsaved.set(row, (unsaved.get(row) ?? 0) + 1);
  setPendingSaves((count) => count + 1);
  try {
    await work(await db());
    if (options?.sync !== false) queueAccountSync();
  } catch (e) {
    toast.error(t("Could not save the calendar"), { description: (e as Error).message });
  } finally {
    for (const row of rows) {
      const left = (unsaved.get(row) ?? 1) - 1;
      if (left > 0) unsaved.set(row, left);
      else unsaved.delete(row);
    }
    setPendingSaves((count) => count - 1);
  }
}

function withUnsaved<T extends { id: string }>(kind: "event" | "calendar", onScreen: readonly T[], rows: readonly T[]): T[] {
  const pending = (id: string) => unsaved.has(`${kind}:${id}`);
  return [...rows.filter((row) => !pending(row.id)), ...onScreen.filter((row) => pending(row.id))];
}

/** Rows as a sync read them, so writing the merged copy back can tell what changed here meanwhile. */
export type CalendarRead = { calendars: Map<string, string>; events: Map<string, string>; media: Map<string, string> };

const rowMark = (row: unknown) => JSON.stringify(row) ?? "";
const mediaMark = (record: MediaRecord) =>
  JSON.stringify([record.file?.name, record.file?.size, record.file?.lastModified, record.file?.type, record.cloud ?? null]);

export async function readCalendarSnapshot(userId: string, workspaceId: string) {
  try {
    return await withWorkspaceDb(userId, workspaceId, async (database) => {
      const [foundCalendars, events, media] = await Promise.all([database.getAll("calendars"), database.getAll("events"), database.getAll("media")]);
      const read: CalendarRead = {
        calendars: new Map(foundCalendars.map((calendar) => [calendar.id, rowMark(calendar)])),
        events: new Map(events.map((event) => [event.id, rowMark(event)])),
        media: new Map(media.map((record) => [record.id, mediaMark(record)])),
      };
      return {
        calendars: foundCalendars,
        events: events.map(forAccount),
        media: media.map((record) => ({
          id: record.id,
          name: record.file?.name || "video.mp4",
          type: record.file?.type || "video/mp4",
          lastModified: record.file?.lastModified || 0,
          ...(record.cloud ? { cloud: record.cloud } : {}),
        })),
        read,
      };
    });
  } catch {
    return null;
  }
}

/** Rows changed, made or deleted here since `read` stay that way; the sync runs again to send them. */
function overwrite<T extends { id: string }>(stored: readonly T[], incoming: readonly T[], read: ReadonlyMap<string, string> | undefined) {
  const now = new Map(stored.map((row) => [row.id, row]));
  const wanted = new Map(incoming.map((row) => [row.id, row]));
  const put: T[] = [];
  const remove: string[] = [];
  const rows: T[] = [];
  const keptIds = new Set<string>();
  for (const id of new Set([...now.keys(), ...wanted.keys()])) {
    const here = now.get(id);
    const there = wanted.get(id);
    const was = read?.get(id);
    const changedHere = !!read && (here ? was !== rowMark(here) : was !== undefined);
    if (changedHere) {
      if (here) rows.push(here);
      if (here ? !there || rowMark(there) !== rowMark(here) : !!there) keptIds.add(id);
    } else if (there) {
      put.push(there);
      rows.push(there);
    } else remove.push(id);
  }
  return { put, remove, rows, kept: keptIds.size > 0, keptIds };
}

async function fileFromCloud(item: AccountMedia, team: TeamScope | null): Promise<File | null> {
  if (!item.cloud || !cloudEnabled) return null;
  try {
    const url = await cloudReadUrl({ purpose: "posts", id: item.id }, team);
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], item.name, { type: item.type || blob.type || "video/mp4", lastModified: item.lastModified || Date.now() });
  } catch {
    return null;
  }
}

export async function writeWorkspaceCalendars(userId: string, workspaceId: string, incoming: Calendar[], read?: CalendarRead): Promise<boolean> {
  return withWorkspaceDb(userId, workspaceId, async (database) => {
    const tx = database.transaction("calendars", "readwrite");
    const rows = overwrite(await tx.store.getAll(), incoming, read?.calendars);
    await Promise.all([...rows.remove.map((id) => tx.store.delete(id)), ...rows.put.map((calendar) => tx.store.put(calendar)), tx.done]);
    if (isActiveWorkspace(userId, workspaceId)) {
      accountWrites++;
      if (loaded()) setCalendars(withUnsaved("calendar", calendars(), rows.rows).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "")));
    }
    return rows.kept;
  });
}

/** No file a post here still lists is deleted (see `overwrite` for changed rows). */
export async function writeWorkspacePosts(
  userId: string,
  workspaceId: string,
  posts: { events: StoredEvent[]; media: AccountMedia[] },
  read?: CalendarRead,
): Promise<Set<string>> {
  return withWorkspaceDb(userId, workspaceId, async (database) => {
    const tx = database.transaction("events", "readwrite");
    const eventRows = overwrite(await tx.store.getAll(), posts.events, read?.events);
    await Promise.all([...eventRows.remove.map((id) => tx.store.delete(id)), ...eventRows.put.map((event) => tx.store.put(event)), tx.done]);
    const kept = eventRows.keptIds;

    // Show the posts now; their videos can take a while to download.
    if (isActiveWorkspace(userId, workspaceId)) {
      accountWrites++;
      if (loaded()) setStoredEvents(withUnsaved("event", storedEvents(), eventRows.rows));
    }

    const existing = await database.getAll("media");
    const had = new Map(existing.map((record) => [record.id, record]));
    const downloads = new Map<string, File>();
    for (const item of posts.media) {
      // Deleted here since the sync read this browser's copy: not fetched back.
      if (had.get(item.id)?.file || (read?.media.has(item.id) && !had.has(item.id))) continue;
      const file = await fileFromCloud(item, scopeOf(workspaceId));
      if (file) downloads.set(item.id, file);
    }
    // Read again in the write: files can be added here, or get their cloud copy, while the videos download.
    const mediaTx = database.transaction(["events", "media"], "readwrite");
    const mediaStore = mediaTx.objectStore("media");
    const [postsNow, records] = await Promise.all([mediaTx.objectStore("events").getAll(), mediaStore.getAll()]);
    const listed = new Set(postsNow.flatMap(everyFileOf));
    const present = new Set(records.map((record) => record.id));
    const wanted = new Map(posts.media.map((item) => [item.id, item]));
    const changedHere = (record: MediaRecord) => !!read && read.media.get(record.id) !== mediaMark(record);
    const writes: Promise<unknown>[] = [];
    for (const record of records) {
      const item = wanted.get(record.id);
      if (changedHere(record)) continue;
      if (!item) {
        if (!listed.has(record.id)) writes.push(mediaStore.delete(record.id));
        continue;
      }
      const file = record.file ?? downloads.get(item.id);
      if (file) writes.push(mediaStore.put({ ...record, file, cloud: item.cloud ?? record.cloud }));
    }
    for (const item of posts.media) {
      // Deleted here meanwhile, or since the sync read this browser's copy: stays deleted.
      if (present.has(item.id) || had.has(item.id) || read?.media.has(item.id)) continue;
      const file = downloads.get(item.id);
      if (file) writes.push(mediaStore.put({ id: item.id, file, ...(item.cloud ? { cloud: item.cloud } : {}) }));
    }
    await Promise.all([...writes, mediaTx.done]);
    return kept;
  });
}

export async function writeWorkspaceCalendar(
  userId: string,
  workspaceId: string,
  slice: { calendars: Calendar[]; events: StoredEvent[]; media: AccountMedia[] },
  read?: CalendarRead,
): Promise<boolean> {
  const calendarsKept = await writeWorkspaceCalendars(userId, workspaceId, slice.calendars, read);
  const postsKept = await writeWorkspacePosts(userId, workspaceId, slice, read);
  return calendarsKept || postsKept.size > 0;
}

export async function readPostSync(userId: string, workspaceId: string): Promise<{ cursor: string | null; bases: Map<string, Base> }> {
  return withWorkspaceDb(userId, workspaceId, async (database) => {
    const tx = database.transaction(["syncBases", "syncState"], "readonly");
    const [keys, values, cursor] = await Promise.all([tx.objectStore("syncBases").getAllKeys(), tx.objectStore("syncBases").getAll(), tx.objectStore("syncState").get("cursor")]);
    await tx.done;
    return { cursor: cursor ?? null, bases: new Map(keys.map((key, index) => [String(key), values[index]!])) };
  });
}

export async function writePostSync(userId: string, workspaceId: string, cursor: string | null, bases: ReadonlyMap<string, Base | null>): Promise<void> {
  await withWorkspaceDb(userId, workspaceId, async (database) => {
    const tx = database.transaction(["syncBases", "syncState"], "readwrite");
    const store = tx.objectStore("syncBases");
    const writes: Promise<unknown>[] = [...bases].map(([id, base]) => (base ? store.put(base, id) : store.delete(id)));
    if (cursor) writes.push(tx.objectStore("syncState").put(cursor, "cursor"));
    await Promise.all([...writes, tx.done]);
  });
}

function inZone(event: StoredEvent, zone: string): StoredEvent {
  const from = event.timeZone ?? deviceTimeZone();
  if (from === zone) return event.timeZone ? event : { ...event, timeZone: zone };
  if (event.allDay) return { ...event, timeZone: zone };
  const moved = convertWallClock(event.day, event.start, from, zone);
  return { ...shiftSeries(event, daysBetween(event.day, moved.day)), day: moved.day, start: moved.time, timeZone: zone };
}

function shiftSeries(event: StoredEvent, shift: number): StoredEvent {
  if (!shift) return event;
  const weekday = (WEEKDAY_NAMES as readonly string[]).indexOf(event.recurrence ?? "");
  return {
    ...event,
    recurrence: weekday === -1 ? event.recurrence : WEEKDAY_NAMES[(((weekday + shift) % 7) + 7) % 7],
    recurrenceExceptions: event.recurrenceExceptions.map((day) => shiftDay(day, shift)),
    recurrenceEnd: event.recurrenceEnd ? shiftDay(event.recurrenceEnd, shift) : event.recurrenceEnd,
  };
}

const shownCopies = new WeakMap<StoredEvent, StoredEvent>();
const savedCopies = new WeakMap<StoredEvent, StoredEvent>();

/**
 * The saved post must keep the zone it was written in: the publisher keys a
 * repeating post's runs by their day there, so another zone would give a run
 * that already went out a new day, and it would go out again.
 */
function shown(event: StoredEvent): StoredEvent {
  const zone = timeZone();
  let copy = shownCopies.get(event);
  if (copy?.timeZone !== zone) {
    copy = inZone(event, zone);
    shownCopies.set(event, copy);
    savedCopies.set(copy, event);
  }
  return copy;
}

function savedOver(input: StoredEvent & { timeZone: string }, saved: StoredEvent): StoredEvent {
  const zone = saved.timeZone ?? deviceTimeZone();
  const seen = inZone(saved, input.timeZone);
  if (input.day !== seen.day || input.start !== seen.start || input.allDay !== seen.allDay) return inZone(input, zone);
  // The same one keeps its saved day and time, and the rest moves back as far as it was shown moved.
  return { ...shiftSeries(input, daysBetween(seen.day, saved.day)), day: saved.day, start: saved.start, timeZone: zone };
}

function putEvent(input: StoredEvent) {
  const written = { ...input, timeZone: input.timeZone ?? timeZone() };
  const saved = storedEvents().find((event) => event.id === input.id);
  const next = saved ? savedOver(written, saved) : written;
  setStoredEvents((current) =>
    current.some((event) => event.id === next.id)
      ? current.map((event) => (event.id === next.id ? next : event))
      : [next, ...current],
  );
  void persist((database) => database.put("events", next), { rows: [`event:${next.id}`] });
}

function findEvent(id: string) {
  const saved = storedEvents().find((event) => event.id === id);
  return saved && shown(saved);
}

// These read signals: calling them in a memo or JSX tracks every post and calendar change.

function calendarColor(id: string) {
  return calendars().find((calendar) => calendar.id === id)?.color ?? "sky";
}

function toCalendarEvent(event: StoredEvent, day: string): CalendarEvent {
  const waiting = waitingOf(event);
  return {
    allDay: event.allDay,
    calendarId: event.calendarId,
    color: calendarColor(event.calendarId),
    day,
    description: event.description,
    duration: event.duration,
    id: event.id,
    link: event.link,
    platforms: event.platforms,
    accounts: readChoices(event.accounts),
    projectId: event.projectId ?? null,
    recurrence: event.recurrence,
    recurrenceEnd: event.recurrence ? (event.recurrenceEnd ?? null) : null,
    paused: !!event.recurrence && !!event.paused,
    recurring: false,
    sourceId: event.id,
    start: event.start,
    status: event.status,
    delivery: deliveryOf(event),
    ...(waiting ? { waiting } : {}),
    title: event.title,
    ...(event.thumbnail ? { thumbnail: event.thumbnail } : {}),
  };
}

function deliveryOf(event: StoredEvent): CalendarEvent["delivery"] {
  const states = Object.values(event.deliveries ?? {}).map((delivery) => delivery?.state);
  if (states.includes("sending")) return "sending";
  return states.includes("failed") && event.status !== "posted" ? "failed" : null;
}

export function waitingOf(event: StoredEvent): string | undefined {
  const sending = Object.values(event.deliveries ?? {}).filter((delivery) => delivery?.state === "sending");
  return sending.length && sending.every((delivery) => delivery?.waiting) ? sending[0]!.waiting : undefined;
}

function expandEvent(event: StoredEvent, days: string[]): CalendarEvent[] {
  if (!event.recurrence) return days.includes(event.day) ? [toCalendarEvent(event, event.day)] : [];

  const end = event.recurrenceEnd;
  return days.flatMap((day) =>
    day >= event.day &&
    (!end || day <= end) &&
    matchesRecurrence(event.recurrence, day, event.day) &&
    !event.recurrenceExceptions.includes(day)
      ? [{ ...toCalendarEvent(event, day), id: occurrenceId(event.id, day), recurring: true, firstDay: event.day }]
      : [],
  );
}

export function allPosts(): readonly StoredEvent[] {
  return storedEvents().map(shown);
}

export function postAsEvent(post: StoredEvent): CalendarEvent {
  return { ...toCalendarEvent(post, post.day), recurring: !!post.recurrence, firstDay: post.day };
}

export function timeHasPassed(post: StoredEvent) {
  return !post.recurrence && hasPassed(post.day, post.start, post.allDay);
}

export function uploadProblem(id: string): string | undefined {
  for (const [name, problem] of cloudHoldUps()) {
    if (name === `posts:${id}` || name.startsWith(`posts:${id}_`)) return problem;
  }
}

export function eventsInDays(days: string[], includeFollowingDay = false): CalendarEvent[] {
  const last = days.at(-1);
  const eventDays = includeFollowingDay && last ? [...days, shiftDay(last, 1)] : days;
  return storedEvents().flatMap((event) => expandEvent(shown(event), eventDays));
}

export function isEventVisible(event: CalendarEvent) {
  if (!goesOutFromPicked(event)) return false;
  const status = statusFilter();
  if (status === "failed") return event.delivery === "failed";
  return status === "all" || event.status === status;
}

export function weekRange(date: string) {
  const days = getWeekDays(date);
  return { days, events: eventsInDays(days, true) };
}

export function monthRange(date: string) {
  const days = getMonthDays(date);
  return { days, events: eventsInDays(days) };
}

// Each writer returns an error message for the user, or nothing.

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const POSTED_LOCKED = msg("Posted posts stay as they went out. Post again to make a copy you can change.");

function validDuration(duration: number) {
  return Number.isFinite(duration) && duration >= 15 && duration <= 24 * 60;
}

const PASSED = msg("That time has passed. Pick a later one.");

/** A post moved to the minute it is now goes now, rather than counting as passed. */
const NOW_GRACE_MS = 60_000;

function hasPassed(day: string, start: string, allDay: boolean) {
  return (momentOf(day, allDay ? "00:00" : start)?.getTime() ?? 0) < Date.now() - NOW_GRACE_MS;
}

/** Posts due sooner than this skip the Free plan's limit, so "Post now" always works. */
const GOING_OUT_MS = 5 * 60_000;

const SCHEDULED_LIMIT = msg("On the Free plan, each account can have 10 scheduled posts waiting at a time. Upgrade for unlimited posts.");

/** Must match isDayKey in services/publisher/schedule.mjs. */
const isDayKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime());

function waitingFrom(post: StoredEvent): string[] {
  if (post.status !== "scheduled" || post.paused) return [];
  const over = post.recurrence
    ? isDayKey(post.recurrenceEnd) && post.recurrenceEnd < dayKeyAt(Date.now())
    : (momentOf(post.day, post.allDay ? "00:00" : post.start)?.getTime() ?? 0) < Date.now() + GOING_OUT_MS;
  if (over) return [];
  return [...new Set(post.platforms.flatMap((platform) => accountsFor(platform, post.accounts).map((account) => account.id)))];
}

/** Only accounts it newly waits on count, so a post already waiting can still be changed. */
function overScheduledLimit(next: StoredEvent, before?: StoredEvent, events: readonly StoredEvent[] = storedEvents()): string | undefined {
  // A shared workspace is on its owner's plan, and a team comes with plans that schedule without a limit.
  const limit = activeScope() ? undefined : scheduledLimit();
  if (limit === undefined) return;
  const had = before ? waitingFrom(before) : [];
  const added = waitingFrom(next).filter((id) => !had.includes(id));
  if (!added.length) return;
  const others = events.filter((post) => post.id !== next.id).map(waitingFrom);
  if (added.some((id) => others.filter((ids) => ids.includes(id)).length >= limit)) return SCHEDULED_LIMIT;
}

function retimed(before: StoredEvent, next: StoredEvent) {
  return (
    next.day !== before.day ||
    next.start !== before.start ||
    next.allDay !== before.allDay ||
    next.recurrence !== before.recurrence ||
    (next.recurrenceEnd ?? null) !== (before.recurrenceEnd ?? null) ||
    next.status !== before.status ||
    !!next.paused !== !!before.paused
  );
}

/** A retimed post gets its time now: the publisher won't send a run due before that, so nothing past goes out at once. */
function putRetimed(before: StoredEvent, next: StoredEvent) {
  putEvent(retimed(before, next) ? { ...next, sendFrom: new Date().toISOString() } : next);
}

/** Must read the caption as services/publisher/networks/text.mjs does. */
function sharedWords(post: Pick<StoredEvent, "description">): string {
  return (post.description ?? "").trim();
}

/** Words written for a network. A copy of the shared ones isn't: it would keep the old words once the caption changes. */
const isOwn = (words: string | undefined, shared: string): words is string => !!words?.trim() && words.trim() !== shared;

export function ownCaptions(post: StoredEvent): Partial<Record<string, string>> {
  const shared = sharedWords(post);
  const own: Partial<Record<string, string>> = {};
  for (const platform of post.platforms) {
    const words = platform === "youtube" ? post.youtube?.description : post.captions?.[platform];
    if (isOwn(words, shared)) own[platform] = words;
  }
  return own;
}

/** Only words that differ from the shared ones are kept, so other networks follow caption changes. */
function withOwnCaptions(post: StoredEvent, own: Partial<Record<string, string>>): StoredEvent {
  const shared = sharedWords(post);
  const captions: Partial<Record<string, string>> = {};
  for (const platform of post.platforms) {
    const words = own[platform];
    if (platform !== "youtube" && isOwn(words, shared)) captions[platform] = words;
  }
  const next: StoredEvent = { ...post, captions };
  if (!Object.keys(captions).length) delete next.captions;
  if (next.youtube) {
    const words = own.youtube;
    next.youtube = { ...next.youtube, description: post.platforms.includes("youtube") && isOwn(words, shared) ? words : "" };
  }
  return next;
}

function eventFromDraft(draft: EventDraft): { next: StoredEvent; before?: StoredEvent } | string {
  const title = draft.title.trim();
  if (!title) return msg("Add a title before saving the post.");
  if (!isDateKey(draft.day) || (!draft.allDay && !timePattern.test(draft.start))) return msg("Choose a valid date and time.");
  if (!draft.allDay && !validDuration(draft.duration)) return msg("Choose a valid duration.");

  const calendar = calendars().find((item) => item.id === draft.calendarId) ?? calendars()[0];
  if (!calendar) return msg("Create a calendar before adding posts.");

  const recurrence = parseRecurrence(draft.repeat) ? draft.repeat : null;
  const recurrenceEnd = recurrence ? resolveRepeatEnd(draft.repeatEnd, recurrence, draft.day) : null;
  if (recurrenceEnd && recurrenceEnd < draft.day) return msg("Pick an end on or after the first post.");
  const before = draft.id ? findEvent(draft.id) : undefined;
  // YouTube keeps a description only when it was given words of its own.
  const next = withOwnCaptions({
    allDay: draft.allDay,
    calendarId: calendar.id,
    createdAt: before?.createdAt ?? new Date().toISOString(),
    day: draft.day,
    description: draft.description.trim() || null,
    duration: draft.allDay ? 24 * 60 : draft.duration,
    id: draft.id ?? newId(),
    link: draft.link.trim() || null,
    platforms: normalizePlatforms(draft.platforms),
    accounts: accountsForPlatforms(normalizePlatforms(draft.platforms), draft.accounts, { keepRemoved: true }),
    projectId: draft.projectId || null,
    coverTime: typeof draft.coverTime === "number" && Number.isFinite(draft.coverTime) ? draft.coverTime : null,
    ...((draft.files ?? before?.files) ? { files: draft.files ?? before?.files } : {}),
    ...((draft.files ? draft.ownFiles : before?.ownFiles) ? { ownFiles: draft.files ? draft.ownFiles : before?.ownFiles } : {}),
    ...(draft.tiktok ? { tiktok: draft.tiktok } : {}),
    ...(draft.youtube ? { youtube: draft.youtube } : {}),
    ...(draft.instagram ? { instagram: draft.instagram } : {}),
    ...(draft.x ? { x: draft.x } : {}),
    ...(draft.pinterest ? { pinterest: draft.pinterest } : {}),
    ...(draft.story ? { story: true } : {}),
    ...((draft.thread ?? before?.thread)?.length ? { thread: draft.thread ?? before?.thread } : {}),
    recurrence,
    recurrenceExceptions: before && before.recurrence === recurrence && before.day === draft.day ? before.recurrenceExceptions : [],
    recurrenceEnd,
    ...(recurrence && before?.paused ? { paused: true } : {}),
    ...(before?.deliveries ? { deliveries: before.deliveries } : {}),
    ...(before?.thumbnail ? { thumbnail: before.thumbnail } : {}),
    sendFrom: new Date().toISOString(),
    start: draft.allDay ? "00:00" : draft.start,
    status: draft.status,
    title,
  }, { youtube: draft.youtube?.description });
  return { next, before };
}

export function createEvent(draft: EventDraft): string | undefined {
  const made = eventFromDraft(draft);
  if (typeof made === "string") return made;
  const overLimit = overScheduledLimit(made.next, made.before);
  if (overLimit) return overLimit;
  putEvent(made.next);
}

/** The plan's limit counts the whole batch, so a batch that passes saves whole rather than stopping partway. */
export function checkEvents(drafts: readonly EventDraft[]): string | undefined {
  let events = storedEvents();
  for (const draft of drafts) {
    const made = eventFromDraft(draft);
    if (typeof made === "string") return made;
    const overLimit = overScheduledLimit(made.next, made.before, events);
    if (overLimit) return overLimit;
    events = [made.next, ...events.filter((post) => post.id !== made.next.id)];
  }
}

export type PostPatch = {
  title?: string;
  description?: string;
  platforms?: string[];
  accounts?: EventDraft["accounts"];
  day?: string;
  start?: string;
  allDay?: boolean;
  status?: PostStatus;
  link?: string;
  tiktok?: TikTokPostSettings | null;
  youtube?: YouTubePostSettings | null;
  captions?: Partial<Record<string, string>>;
  /** `null` or empty removes them. */
  thread?: StoredEvent["thread"] | null;
  repeat?: string | null;
  repeatEnd?: string | null;
};

/** `null` clears a setting; omitting it keeps it. Posted posts are left alone. */
export function revisePost(id: string, patch: PostPatch): string | undefined {
  const existing = findEvent(id);
  if (!existing) return msg("This post no longer exists.");
  if (existing.status === "posted") return POSTED_LOCKED;
  if (patch.status === "posted") return msg("Publishing marks a post as posted. Save it as a draft or scheduled first.");

  const allDay = patch.allDay ?? existing.allDay;
  const day = patch.day ?? existing.day;
  const start = allDay ? "00:00" : (patch.start ?? existing.start);
  const title = (patch.title ?? existing.title).trim();
  if (!title) return msg("Add a title before saving the post.");
  if (!isDateKey(day) || (!allDay && !timePattern.test(start))) return msg("Choose a valid date and time.");

  const platforms = patch.platforms ? normalizePlatforms(patch.platforms) : existing.platforms;
  const accounts = accountsForPlatforms(platforms, patch.accounts ?? existing.accounts ?? {}, { keepRemoved: true });
  const repeat = patch.repeat === undefined ? (existing.recurrence ?? "") : (patch.repeat ?? "");
  const recurrence = parseRecurrence(repeat) ? repeat : null;
  // A post keeps its end as a bare day; the picker's form of it is `on:<day>`.
  const repeatEnd =
    patch.repeatEnd === undefined ? (existing.recurrenceEnd ? `on:${existing.recurrenceEnd}` : "") : (patch.repeatEnd ?? "");
  const recurrenceEnd = recurrence ? resolveRepeatEnd(repeatEnd || undefined, recurrence, day) : null;
  if (recurrenceEnd && recurrenceEnd < day) return msg("Pick an end on or after the first post.");

  const tiktok = patch.tiktok === undefined ? existing.tiktok : (patch.tiktok ?? undefined);
  const youtube = patch.youtube === undefined ? existing.youtube : (patch.youtube ?? undefined);
  const dayChanged = day !== existing.day;
  const repeatChanged = recurrence !== existing.recurrence;

  const next: StoredEvent = {
    ...existing,
    allDay,
    day,
    start,
    title,
    description: patch.description !== undefined ? patch.description.trim() || null : existing.description,
    duration: allDay ? 24 * 60 : existing.allDay ? 15 : existing.duration,
    link: patch.link !== undefined ? patch.link.trim() || null : existing.link,
    platforms,
    accounts,
    recurrence,
    recurrenceEnd,
    recurrenceExceptions: dayChanged || repeatChanged ? [] : existing.recurrenceExceptions,
    status: patch.status ?? existing.status,
  };
  if (tiktok) next.tiktok = tiktok;
  else delete next.tiktok;
  if (youtube) next.youtube = youtube;
  else delete next.youtube;
  const thread = patch.thread === undefined ? existing.thread : (patch.thread ?? undefined);
  if (thread?.length) next.thread = thread;
  else delete next.thread;
  const revised = withOwnCaptions(next, patch.captions ?? ownCaptions(existing));
  const overLimit = overScheduledLimit(revised, existing);
  if (overLimit) return overLimit;
  putRetimed(existing, revised);
}

export function updateEvent(sourceId: string, draft: EventDraft): string | undefined {
  const existing = findEvent(sourceId);
  if (!existing) return msg("This post no longer exists.");
  const title = draft.title.trim();
  if (!title || (!draft.allDay && !timePattern.test(draft.start))) return msg("Add a title and a valid start time.");
  if (!draft.allDay && !validDuration(draft.duration)) return msg("Choose a valid duration.");
  const toYouTube = normalizePlatforms(draft.platforms).includes("youtube");
  if (toYouTube && [...title].length > 100) return msg("Keep the title to 100 characters for YouTube.");

  const next = withOwnCaptions({
    ...existing,
    allDay: draft.allDay,
    description: draft.description.trim() || null,
    duration: draft.allDay ? 24 * 60 : draft.duration,
    link: draft.link.trim() || null,
    platforms: normalizePlatforms(draft.platforms),
    accounts: accountsForPlatforms(normalizePlatforms(draft.platforms), draft.accounts, { keepRemoved: true }),
    start: draft.allDay ? "00:00" : draft.start,
    status: draft.status,
    title,
    // The form shows YouTube's own title as the post's, so YouTube goes out with it as edited.
    ...(toYouTube && existing.youtube?.title ? { youtube: { ...existing.youtube, title } } : {}),
  }, draft.captions ?? ownCaptions(existing));
  // Given a time that has passed, a scheduled post would go out at once.
  if (retimed(existing, next) && next.status === "scheduled" && !next.recurrence && hasPassed(next.day, next.start, next.allDay)) return PASSED;
  const overLimit = overScheduledLimit(next, existing);
  if (overLimit) return overLimit;
  putRetimed(existing, next);
}

export function setEventStatus(sourceId: string, status: PostStatus): string | undefined {
  const existing = findEvent(sourceId);
  if (!existing || existing.status === status) return;
  const overLimit = overScheduledLimit({ ...existing, status }, existing);
  if (overLimit) return overLimit;
  putRetimed(existing, { ...existing, status });
  if (status === "posted") keepSent(everyFileOf(existing));
}

export function setDelivery(sourceId: string, platform: string, delivery: Delivery, status?: PostStatus) {
  const existing = findEvent(sourceId);
  if (!existing) return;
  putEvent({ ...existing, status: status ?? existing.status, deliveries: { ...existing.deliveries, [platform]: delivery } });
  if (status === "posted" && existing.status !== "posted") keepSent(everyFileOf(existing));
}

export function setPostCaptions(sourceId: string, captions: Partial<Record<string, string | undefined>>) {
  const existing = findEvent(sourceId);
  if (!existing) return;
  const shared = sharedWords(existing);
  const next = { ...existing.captions };
  for (const [platform, text] of Object.entries(captions)) {
    if (text === undefined) continue;
    if (isOwn(text, shared)) next[platform] = text;
    else delete next[platform];
  }
  if (JSON.stringify(next) === JSON.stringify(existing.captions ?? {})) return;
  putEvent({ ...existing, captions: Object.keys(next).length ? next : undefined });
}

// File ids are `<post id>_<random>`, or the post's own id for posts saved before
// they could carry several. The post lists its files so the publisher waits for every one.

export type PostFiles = {
  shared: readonly File[];
  own?: Partial<Record<string, readonly File[]>>;
  thread?: Partial<Record<string, readonly File[]>>;
};

export type FilesPlan = {
  files: string[];
  ownFiles?: Partial<Record<string, string[]>>;
  threadFiles?: Partial<Record<string, string[]>>;
  write: { id: string; file: File }[];
  drop: string[];
};

export function postFileIds(post: Pick<StoredEvent, "id" | "files" | "ownFiles">, platform?: string): string[] {
  return (platform ? post.ownFiles?.[platform] : undefined) ?? post.files ?? [post.id];
}

export function everyFileOf(post: Pick<StoredEvent, "id" | "files" | "ownFiles" | "thread">): string[] {
  return [
    ...new Set([
      ...(post.files ?? [post.id]),
      ...Object.values(post.ownFiles ?? {}).flatMap((ids) => ids ?? []),
      ...(post.thread ?? []).flatMap((reply) => reply.files ?? []),
    ]),
  ];
}

const threadFilesOf = (post: Pick<StoredEvent, "thread">) =>
  Object.fromEntries((post.thread ?? []).flatMap((reply) => (reply.files?.length ? [[reply.id, reply.files]] : [])));

const isFileOf = (postId: string, id: string) => id === postId || (id.startsWith(`${postId}_`) && /^[A-Za-z0-9]{1,32}$/.test(id.slice(postId.length + 1)));

const sameFile = (a: File, b: File) => a === b || (a.name === b.name && a.size === b.size && a.lastModified === b.lastModified);

export const fileKindOf = (file: File): "video" | "image" => (file.type.startsWith("image/") ? "image" : "video");

/** A new file gets an id never used before, so a pending delete of an old file can't take it. */
export async function planPostFiles(postId: string, files: PostFiles): Promise<FilesPlan> {
  const database = await db();
  const had = new Map<string, File>();
  for (const key of await database.getAllKeys("media")) {
    const file = isFileOf(postId, key) ? (await database.get("media", key))?.file : undefined;
    if (file) had.set(key, file);
  }
  const unique: File[] = [];
  for (const file of [...files.shared, ...Object.values(files.own ?? {}).flatMap((list) => list ?? []), ...Object.values(files.thread ?? {}).flatMap((list) => list ?? [])]) {
    if (!unique.some((known) => sameFile(known, file))) unique.push(file);
  }
  const ids = new Map<File, string>();
  const write: FilesPlan["write"] = [];
  for (const file of unique) {
    const kept = [...had].find(([id, known]) => sameFile(known, file) && ![...ids.values()].includes(id))?.[0];
    const id = kept ?? `${postId}_${newId().replace(/-/g, "").slice(0, 12)}`;
    ids.set(file, id);
    if (!kept) write.push({ id, file });
  }
  const idOf = (file: File) => ids.get(unique.find((known) => sameFile(known, file))!)!;
  const own = Object.entries(files.own ?? {}).flatMap(([platform, list]) => (list ? [[platform, list.map(idOf)] as const] : []));
  const listed = findEvent(postId);
  // Planned without its thread's, as when an agent swaps the post's media, the follow-ups keep theirs.
  const thread = files.thread
    ? Object.entries(files.thread).flatMap(([reply, list]) => (list?.length ? [[reply, list.map(idOf)] as const] : []))
    : Object.entries(listed ? threadFilesOf(listed) : {});
  const used = new Set([...ids.values(), ...(files.thread ? [] : thread.flatMap(([, list]) => list))]);
  const drop = [...new Set([...had.keys(), ...(listed ? everyFileOf(listed) : [])])].filter((id) => !used.has(id));
  return {
    files: files.shared.map(idOf),
    ...(own.length ? { ownFiles: Object.fromEntries(own) } : {}),
    ...(thread.length ? { threadFiles: Object.fromEntries(thread) } : {}),
    write,
    drop,
  };
}

export const withThreadFiles = <T extends { id: string; files?: string[] }>(thread: readonly T[] | undefined, plan: Pick<FilesPlan, "threadFiles">): T[] | undefined =>
  thread?.map((reply) => {
    const { files: _old, ...rest } = reply;
    const files = plan.threadFiles?.[reply.id];
    return (files?.length ? { ...rest, files } : rest) as T;
  });

const sameLists = (post: StoredEvent, plan: FilesPlan) =>
  JSON.stringify(post.files ?? null) === JSON.stringify(plan.files) &&
  JSON.stringify(post.ownFiles ?? null) === JSON.stringify(plan.ownFiles ?? null) &&
  JSON.stringify(threadFilesOf(post)) === JSON.stringify(plan.threadFiles ?? {});

export async function keepPostFiles(postId: string, plan: FilesPlan) {
  const team = activeScope();
  await persist(async (database) => {
    const tx = database.transaction("media", "readwrite");
    await Promise.all([...plan.write.map((item) => tx.store.put(item)), ...plan.drop.map((id) => tx.store.delete(id)), tx.done]);
  });
  const post = findEvent(postId);
  if (post && !sameLists(post, plan)) {
    const next: StoredEvent = { ...post, files: plan.files, ownFiles: plan.ownFiles, thread: withThreadFiles(post.thread, plan) };
    if (!plan.ownFiles) delete next.ownFiles;
    if (!next.thread) delete next.thread;
    putEvent(next);
  }
  for (const { id } of plan.write) backUpFile(id);
  // A guest's files never went to cloud storage.
  if (!plan.drop.length || !cloudEnabled || inGuestMode()) return;
  // Gone now, and again after any upload of them still running, which would put them back.
  await deleteFromCloud("posts", plan.drop, team).catch((error) => console.error("[posts] Could not delete the post's old files", error));
  queueCloud(`posts-delete:${plan.drop.join(",")}`, () => deleteFromCloud("posts", plan.drop, team));
}

export async function setPostFiles(postId: string, files: PostFiles) {
  await keepPostFiles(postId, await planPostFiles(postId, files));
}

export async function ensurePostInCloud(id: string): Promise<boolean> {
  const post = findEvent(id);
  if (!cloudEnabled || !post) return true;
  const team = activeScope();
  const database = await db();
  for (const fileId of everyFileOf(post)) {
    const record = await database.get("media", fileId);
    if (!record?.file || (record.cloud && (isSentCopy(record.cloud) || !needsCopy(record.cloud)))) continue;
    try {
      await saveCopy(record, await uploadToCloud({ purpose: "posts", id: fileId }, record.file, { team }), generation);
    } catch (error) {
      console.error("[posts] Could not upload the post's file", error);
      return false;
    }
  }
  return true;
}

export async function postFile(id: string): Promise<File | undefined> {
  return (await (await db()).get("media", id))?.file;
}

export async function postFiles(post: Pick<StoredEvent, "id" | "files" | "ownFiles">, platform?: string): Promise<File[]> {
  const found = await Promise.all(postFileIds(post, platform).map(postFile));
  return found.filter((file): file is File => !!file);
}

/** Null when storage has none; undefined when it couldn't be asked. */
async function fetchPostFile(id: string): Promise<File | null | undefined> {
  // Guest mode's demo posts go out with the site's own footage.
  if (inGuestMode() && id.startsWith("demo-")) return (await import("@/lib/guest-demo")).demoFile(id);
  if (!cloudEnabled) return null;
  try {
    const response = await fetch(await cloudReadUrl({ purpose: "posts", id }, activeScope()));
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const type = blob.type || "video/mp4";
    const name = type === "image/png" ? "picture.png" : type.startsWith("image/") ? "picture.jpg" : type === "video/quicktime" ? "video.mov" : "video.mp4";
    return new File([blob], name, { type, lastModified: Date.now() });
  } catch {
    return undefined;
  }
}

/** A file that can't be fetched is an error, so the post is never opened and saved again without it. */
export async function loadPostFiles(post: StoredEvent): Promise<{ shared: File[]; own: Partial<Record<string, File[]>>; thread: Partial<Record<string, File[]>> }> {
  const read = new Map<string, Promise<File | null | undefined>>();
  const fileOf = async (id: string) => {
    if (!read.has(id)) read.set(id, postFile(id).then((file) => file ?? fetchPostFile(id)));
    return read.get(id)!;
  };
  const load = async (ids: readonly string[]) => {
    const files = await Promise.all(ids.map(fileOf));
    // A post from before posts listed their files may simply have none, when storage says so.
    if (files.some((file) => file === undefined || (file === null && post.files))) {
      throw new Error(msg("Some of its media isn't in this browser, and cloud storage didn't send it. Check the connection and try again."));
    }
    return files.filter((file): file is File => !!file);
  };
  const own: Partial<Record<string, File[]>> = {};
  for (const [platform, ids] of Object.entries(post.ownFiles ?? {})) if (ids) own[platform] = await load(ids);
  const thread: Partial<Record<string, File[]>> = {};
  for (const reply of post.thread ?? []) if (reply.files?.length) thread[reply.id] = await load(reply.files);
  return { shared: await load(postFileIds(post)), own, thread };
}

export type PostFileState = { id: string; kind: "video" | "image"; inCloud: boolean };

export async function postFileStates(post: Pick<StoredEvent, "id" | "files" | "ownFiles">, platform?: string): Promise<PostFileState[]> {
  const database = await db();
  const states: PostFileState[] = [];
  for (const id of postFileIds(post, platform)) {
    const record = await database.get("media", id);
    if (record?.file) states.push({ id, kind: fileKindOf(record.file), inCloud: !!record.cloud });
  }
  return states;
}

/** Posted posts take one too: it isn't part of what went out. */
export function setPostThumbnail(id: string, thumbnail: string) {
  const existing = findEvent(id);
  if (!existing || existing.thumbnail === thumbnail) return;
  putEvent({ ...existing, thumbnail });
}

/** `from`: the moved occurrence's day, for a repeating post. */
export function moveEvent({ day, from, sourceId, start }: { day: string; from?: string; sourceId: string; start: string }): string | undefined {
  const existing = findEvent(sourceId);
  if (!existing) return msg("This post no longer exists.");
  if (existing.status === "posted") return POSTED_LOCKED;
  if (!existing.allDay && !timePattern.test(start)) return msg("Choose a valid time.");
  if (!isDateKey(day)) return msg("Choose a valid date.");
  // Dropped on a time that has passed, a scheduled post would go out at once.
  if (existing.status === "scheduled" && !existing.paused && hasPassed(day, start, existing.allDay)) return PASSED;

  if (existing.recurrence && existing.recurrence !== "weekday" && !isWeekdayName(existing.recurrence)) {
    // Counted from its first day, the whole series moves as far as the
    // dragged occurrence did, and so do its skipped days.
    const shift = daysBetween(from ?? existing.day, day);
    putRetimed(existing, {
      ...existing,
      day: shiftDay(existing.day, shift),
      recurrenceExceptions: existing.recurrenceExceptions.map((skipped) => shiftDay(skipped, shift)),
      recurrenceEnd: existing.recurrenceEnd ? shiftDay(existing.recurrenceEnd, shift) : existing.recurrenceEnd,
      start: existing.allDay ? "00:00" : start,
    });
    return;
  }

  if (existing.recurrence) {
    // A weekday series keeps its days, so only the time moves; a weekly one
    // follows the occurrence to its new weekday.
    const recurrence = recurrenceAfterMove(existing.recurrence, day);
    putRetimed(existing, {
      ...existing,
      day: recurrence === "weekday" ? existing.day : day < existing.day ? day : existing.day,
      recurrence,
      start: existing.allDay ? "00:00" : start,
    });
    return;
  }

  putRetimed(existing, { ...existing, day, start: existing.allDay ? "00:00" : start });
}

export function resizeEvent(sourceId: string, duration: number): string | undefined {
  const existing = findEvent(sourceId);
  if (!existing) return msg("This post no longer exists.");
  if (existing.status === "posted") return POSTED_LOCKED;
  if (existing.allDay) return msg("All-day posts do not resize.");
  if (!validDuration(duration)) return msg("Choose a valid duration.");
  putEvent({ ...existing, duration });
}

export function deleteEvent({ day, scope = "series", sourceId }: { day?: string; scope?: "occurrence" | "series"; sourceId: string }) {
  const existing = findEvent(sourceId);
  if (!existing) return msg("This post no longer exists.");

  if (scope === "occurrence" && day && existing.recurrence) {
    if (!existing.recurrenceExceptions.includes(day)) {
      putEvent({ ...existing, recurrenceExceptions: [...existing.recurrenceExceptions, day].sort() });
    }
    return;
  }

  setStoredEvents((current) => current.filter((event) => event.id !== sourceId));
  void persist((database) => database.delete("events", sourceId), { rows: [`event:${sourceId}`] });
}

export function setSeriesPaused(sourceId: string, paused: boolean): string | undefined {
  const existing = findEvent(sourceId);
  if (!existing) return msg("This post no longer exists.");
  if (!existing.recurrence) return msg("Only repeating posts pause.");
  // Resumed, it goes out from its next run on: runs that came due while it was paused stay skipped.
  if (!!existing.paused === paused) return;
  const overLimit = overScheduledLimit({ ...existing, paused }, existing);
  if (overLimit) return overLimit;
  putRetimed(existing, { ...existing, paused });
}

export function setSeriesEnd(sourceId: string, end: string | null): string | undefined {
  const existing = findEvent(sourceId);
  if (!existing) return msg("This post no longer exists.");
  if (!existing.recurrence) return msg("Only repeating posts have an end.");
  if (end !== null && (!isDateKey(end) || end < existing.day)) return msg("Pick an end on or after the first post.");
  const overLimit = overScheduledLimit({ ...existing, recurrenceEnd: end }, existing);
  if (overLimit) return overLimit;
  putRetimed(existing, { ...existing, recurrenceEnd: end });
}

export function restoreEvent(post: StoredEvent) {
  if (findEvent(post.id)) return;
  putEvent(savedCopies.get(post) ?? post);
}

export function createCalendar({ color, name }: { color: string; name: string }): string | undefined {
  const trimmed = name.trim();
  const nextColor = normalizeColor(color);
  if (!trimmed) return msg("Give the calendar a name.");
  if (!nextColor) return msg("Choose a color.");

  const calendar: Calendar = { color: nextColor, createdAt: new Date().toISOString(), id: newId(), name: trimmed };
  setCalendars((current) => [...current, calendar]);
  void persist((database) => database.put("calendars", calendar), { rows: [`calendar:${calendar.id}`] });
}

export function updateCalendar({ color, id, name }: { color: string; id: string; name: string }): string | undefined {
  const trimmed = name.trim();
  const nextColor = normalizeColor(color);
  if (!trimmed) return msg("Give the calendar a name.");
  if (!nextColor) return msg("Choose a color.");
  const existing = calendars().find((calendar) => calendar.id === id);
  if (!existing) return msg("This calendar no longer exists.");

  const next = { ...existing, color: nextColor, name: trimmed };
  setCalendars((current) => current.map((calendar) => (calendar.id === id ? next : calendar)));
  void persist((database) => database.put("calendars", next), { rows: [`calendar:${id}`] });
}

export function deleteCalendar(id: string): string | undefined {
  if (calendars().length <= 1) return msg("Keep at least one calendar.");
  const removed = storedEvents().filter((event) => event.calendarId === id);
  setCalendars((current) => current.filter((calendar) => calendar.id !== id));
  setStoredEvents((current) => current.filter((event) => event.calendarId !== id));
  void persist(
    async (database) => {
      const tx = database.transaction(["calendars", "events"], "readwrite");
      await Promise.all([
        tx.objectStore("calendars").delete(id),
        ...removed.map((event) => tx.objectStore("events").delete(event.id)),
        tx.done,
      ]);
    },
    { rows: [`calendar:${id}`, ...removed.map((event) => `event:${event.id}`)] },
  );
}
