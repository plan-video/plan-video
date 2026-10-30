/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Videos and pictures kept to reuse in posts. Each is kept in the browser, in
// a database per workspace like the calendar's, and in the account's cloud
// storage with its picture. Once both are up, it's on the account's list, and
// every browser signed in shows it: the picture comes down at once, the file
// the first time it's used. Only files a post can carry are taken, and the
// same file is kept once.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";

import {
  MEDIA_LIMITS,
  fileKey,
  formatBytes,
  imageFileProblem,
  isPostableVideo,
  mediaKind,
  readMedia,
  releaseMedia,
  type PostMedia,
} from "@/lib/social-media";
import { inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { keepBrowserStorage } from "@/lib/persistent-storage";
import { queueAccountSync } from "@/lib/account-sync-bus";
import { cloudEnabled, cloudReadUrl, cloudReadUrls, deleteFromCloud, queueCloud, uploadToCloud, type CloudCopy } from "@/lib/cloud-storage";
import { activeScope, isActiveWorkspace, onWorkspaceChange, workspaceDatabase, workspaceDatabaseFor, type TeamScope } from "@/lib/workspaces";

export type MediaItem = {
  id: string;
  name: string;
  kind: "video" | "image";
  type: string;
  size: number;
  width: number;
  height: number;
  /** Seconds. 0 for a picture. */
  duration: number;
  /** A small JPEG of it, as a data URL. Empty until another browser's copy comes down. */
  poster: string;
  /** Name, size and change time of the file it came from, so the same file is kept once. */
  fingerprint: string;
  lastModified: number;
  createdAt: string;
  uses: number;
  lastUsedAt: string | null;
  /** Its copy in cloud storage, once uploaded. */
  cloud?: CloudCopy;
  /** Its picture is in cloud storage too, under `<id>-poster`. */
  cloudPoster?: boolean;
};

/** What the account keeps of an item. The picture is fetched from cloud storage instead. */
export type LibraryItem = Omit<MediaItem, "poster">;

/** On the account: the file and its picture are both in cloud storage, so any browser can show it. */
const onAccount = (item: Pick<MediaItem, "cloud" | "cloudPoster">) => !!item.cloud && !!item.cloudPoster;

export const posterId = (id: string) => `${id}-poster`;

interface MediaDB extends DBSchema {
  items: { key: string; value: MediaItem };
  /** The files themselves, apart from the list, so listing never reads them. */
  files: { key: string; value: { id: string; blob: Blob } };
}

const DB_BASE = "plan-video-media";

let dbPromise: Promise<IDBPDatabase<MediaDB>> | null = null;

function openMediaDb(name: string, blocking?: (event: Event) => void) {
  return openDB<MediaDB>(name, 1, {
    upgrade(database) {
      database.createObjectStore("items", { keyPath: "id" });
      database.createObjectStore("files", { keyPath: "id" });
    },
    blocking: blocking && ((_current, _blocked, event) => blocking(event)),
  });
}

function db() {
  dbPromise ??= openMediaDb(workspaceDatabase(DB_BASE), (event) => {
    (event.target as IDBDatabase).close();
    dbPromise = null;
  });
  return dbPromise;
}

/** One person's library in one workspace, open or not. */
async function withWorkspaceDb<T>(userId: string, workspaceId: string, work: (database: IDBPDatabase<MediaDB>) => Promise<T>): Promise<T> {
  if (isActiveWorkspace(userId, workspaceId)) return work(await db());
  const database = await openMediaDb(workspaceDatabaseFor(DB_BASE, userId, workspaceId));
  try {
    return await work(database);
  } finally {
    database.close();
  }
}

const newestFirst = (list: MediaItem[]) => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const [items, setItems] = createSignal<MediaItem[]>([]);
const [loaded, setLoaded] = createSignal(false);
const [loadError, setLoadError] = createSignal<string | null>(null);

export { items as mediaItems, loaded as mediaLoaded, loadError as mediaLoadError };

let hydrating: Promise<void> | null = null;
let generation = 0;

export function loadMediaLibrary() {
  hydrating ??= (async () => {
    const run = generation;
    try {
      const found = await (await db()).getAll("items");
      if (run === generation) {
        setItems(newestFirst(found));
        for (const item of found) if (!onAccount(item)) backUp(item.id);
        void fetchPosters();
      }
    } catch (error) {
      if (run === generation) setLoadError((error as Error).message || t("The media library could not be opened."));
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
  setItems([]);
  setLoaded(false);
  setLoadError(null);
  void previous?.then((database) => database.close()).catch(() => undefined);
  if (reopen) void loadMediaLibrary();
});

/** Why a file can't go in the library, or null. */
export function libraryProblem(file: File): string | null {
  const kind = mediaKind(file);
  if (kind === "image") return imageFileProblem(file);
  if (kind !== "video" || !isPostableVideo(file)) return t("{name} isn't an MP4, MOV, JPG or PNG.", { name: file.name });
  if (file.size > MEDIA_LIMITS.videoMaxBytes) return t("{name} is {size}. Videos can be up to 500 MB.", { name: file.name, size: formatBytes(file.size) });
  return null;
}

const THUMB_SIZE = 480;

/** A JPEG of a picture, no more than THUMB_SIZE on its longer side. */
async function pictureThumb(url: string): Promise<string> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const scale = Math.min(1, THUMB_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function store(media: PostMedia): Promise<MediaItem> {
  const file = media.file;
  const item: MediaItem = {
    id: crypto.randomUUID(),
    name: file.name,
    kind: media.kind,
    type: file.type || (media.kind === "video" ? "video/mp4" : "image/jpeg"),
    size: file.size,
    width: media.width,
    height: media.height,
    duration: media.duration,
    poster: media.kind === "image" ? await pictureThumb(media.url) : media.poster,
    fingerprint: fileKey(file),
    lastModified: file.lastModified,
    createdAt: new Date().toISOString(),
    uses: 0,
    lastUsedAt: null,
  };
  const database = await db();
  const tx = database.transaction(["items", "files"], "readwrite");
  await Promise.all([tx.objectStore("items").put(item), tx.objectStore("files").put({ id: item.id, blob: file }), tx.done]);
  setItems((current) => [item, ...current]);
  backUp(item.id);
  return item;
}

/**
 * Uploads an item's file, then its picture, to cloud storage, if it's still
 * here when its turn comes. The account lists it once both are up.
 */
function backUp(id: string) {
  if (!cloudEnabled) return;
  const run = generation;
  // A shared workspace's library is in its owner's cloud storage.
  const team = activeScope();
  const current = () => (run === generation ? items().find((row) => row.id === id) : undefined);
  queueCloud(`media:${id}`, async () => {
    const item = current();
    if (!item) return;
    if (!item.cloud) {
      const stored = await (await db()).get("files", id);
      if (!stored) return;
      const cloud = await uploadToCloud({ purpose: "media", id }, new File([stored.blob], item.name, { type: item.type }), { team });
      const latest = current();
      if (!latest) return;
      putItem({ ...latest, cloud });
    }
    const latest = current();
    if (!latest?.poster || latest.cloudPoster) return;
    const poster = await (await fetch(latest.poster)).blob();
    await uploadToCloud({ purpose: "media", id: posterId(id) }, new Blob([poster], { type: poster.type === "image/png" ? "image/png" : "image/jpeg" }), { team });
    const done = current();
    if (done) putItem({ ...done, cloudPoster: true });
  });
}

let fetchingPosters = false;
let fetchAgain = false;

/** Brings down the pictures of items another browser added, so the library shows them before their files. */
async function fetchPosters() {
  if (!cloudEnabled) return;
  if (fetchingPosters) {
    fetchAgain = true;
    return;
  }
  fetchingPosters = true;
  fetchAgain = false;
  const run = generation;
  const team = activeScope();
  try {
    const missing = items().filter((item) => !item.poster && item.cloudPoster);
    if (!missing.length) return;
    const urls = await cloudReadUrls(missing.map((item) => ({ purpose: "media" as const, id: posterId(item.id) })), team);
    for (const [index, item] of missing.entries()) {
      const response = await fetch(urls[index]!).catch(() => null);
      if (run !== generation) return;
      if (!response?.ok) continue;
      const poster = await dataUrl(await response.blob());
      const latest = items().find((row) => row.id === item.id);
      if (latest && run === generation) putItem({ ...latest, poster }, { sync: false });
    }
  } catch {
    // The next visit tries again. Until then the item shows without its picture.
  } finally {
    fetchingPosters = false;
    if (fetchAgain) void fetchPosters();
  }
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The items of one of a person's workspaces their account keeps, for the account copy. */
export async function readLibrarySnapshot(userId: string, workspaceId: string): Promise<LibraryItem[]> {
  const found = await withWorkspaceDb(userId, workspaceId, (database) => database.getAll("items"));
  return found.filter(onAccount).map(({ poster: _poster, ...item }) => item);
}

/**
 * Replaces one workspace's account items with the account copy. Items this
 * browser holds that aren't uploaded yet stay; they join the copy once they are.
 * Files aren't downloaded here: `mediaFile` fetches one when it's first used.
 */
export async function writeLibrarySnapshot(userId: string, workspaceId: string, incoming: readonly LibraryItem[]) {
  const run = generation;
  const next = await withWorkspaceDb(userId, workspaceId, async (database) => {
    const existing = await database.getAll("items");
    const byId = new Map(existing.map((item) => [item.id, item]));
    const keep = new Set(incoming.map((item) => item.id));
    const gone = existing.filter((item) => onAccount(item) && !keep.has(item.id));
    const merged = incoming.map((item) => ({ ...item, poster: byId.get(item.id)?.poster ?? "" }));
    const tx = database.transaction(["items", "files"], "readwrite");
    await Promise.all([
      ...gone.flatMap((item) => [tx.objectStore("items").delete(item.id), tx.objectStore("files").delete(item.id)]),
      ...merged.map((item) => tx.objectStore("items").put(item)),
      tx.done,
    ]);
    return [...existing.filter((item) => !onAccount(item) && !keep.has(item.id)), ...merged];
  });
  if (run !== generation || !isActiveWorkspace(userId, workspaceId) || !hydrating) return;
  setItems(newestFirst(next));
  void fetchPosters();
}

/**
 * Puts items in one of a person's libraries as they are, pictures and all,
 * without their files: guest mode's demo footage, whose files come from the
 * site when first used (see lib/guest-demo.ts).
 */
export async function putLibraryItems(userId: string, workspaceId: string, list: readonly MediaItem[]) {
  await withWorkspaceDb(userId, workspaceId, async (database) => {
    const tx = database.transaction("items", "readwrite");
    await Promise.all([...list.map((item) => tx.store.put(item)), tx.done]);
  });
}

/** One of guest mode's demo files, from the site's footage. */
async function demoFile(id: string): Promise<File | null> {
  return (await (await import("@/lib/guest-demo")).demoFile(id)) ?? null;
}

/** Fingerprints being added, so a file dropped twice at once is kept once. */
const adding = new Set<string>();

const known = (file: File) => items().find((item) => item.fingerprint === fileKey(file));

export type AddResult = { added: MediaItem[]; existing: MediaItem[]; problems: string[] };

/** Reads the files and keeps the ones that fit. A file already in the library comes back as `existing`. */
export async function addToLibrary(files: readonly File[], onProgress?: (done: number) => void): Promise<AddResult> {
  keepBrowserStorage();
  await loadMediaLibrary();
  const result: AddResult = { added: [], existing: [], problems: [] };
  let done = 0;
  for (const file of files) {
    const problem = libraryProblem(file);
    const existing = known(file);
    const fingerprint = fileKey(file);
    if (problem) result.problems.push(problem);
    else if (existing) result.existing.push(existing);
    else if (!adding.has(fingerprint)) {
      adding.add(fingerprint);
      try {
        const media = await readMedia(file);
        try {
          result.added.push(await store(media));
        } finally {
          releaseMedia(media);
        }
      } catch (error) {
        result.problems.push((error as Error).message || t("{name} could not be read.", { name: file.name }));
      } finally {
        adding.delete(fingerprint);
      }
    }
    onProgress?.(++done);
  }
  return result;
}

/** Keeps what a post carries in the library too, from the copy the post already read. */
export async function keepInLibrary(read: readonly PostMedia[]) {
  await loadMediaLibrary();
  for (const media of read) {
    const fingerprint = fileKey(media.file);
    if (libraryProblem(media.file) || known(media.file) || adding.has(fingerprint)) continue;
    adding.add(fingerprint);
    try {
      await store(media);
    } catch {
      // The post still has it. It just isn't in the library.
    } finally {
      adding.delete(fingerprint);
    }
  }
}

const downloads = new Map<string, Promise<Blob | null>>();

/** Fetches an item another browser added, once, and keeps it here. */
function download(item: MediaItem): Promise<Blob | null> {
  let job = downloads.get(item.id);
  if (job) return job;
  const run = generation;
  const team = activeScope();
  job = (async () => {
    try {
      const response = await fetch(await cloudReadUrl({ purpose: "media", id: item.id }, team));
      if (!response.ok) return null;
      const blob = await response.blob();
      if (run === generation && items().some((row) => row.id === item.id)) await (await db()).put("files", { id: item.id, blob });
      return blob;
    } catch {
      return null;
    } finally {
      downloads.delete(item.id);
    }
  })();
  downloads.set(item.id, job);
  return job;
}

/** The file of an item, with its name and change time, as it was added. Downloaded first when another browser added it. */
export async function mediaFile(item: MediaItem): Promise<File | null> {
  const stored = await (await db()).get("files", item.id);
  const blob = stored?.blob ?? (item.cloud && cloudEnabled ? await download(item) : inGuestMode() ? await demoFile(item.id) : null);
  return blob ? new File([blob], item.name, { type: item.type, lastModified: item.lastModified }) : null;
}

/** `sync: false` for what only this browser keeps, like a picture fetched from the cloud. */
function putItem(next: MediaItem, options?: { sync?: boolean }) {
  setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
  void db().then((database) => database.put("items", next));
  if (options?.sync !== false && onAccount(next)) queueAccountSync();
}

/** Renames an item. The extension stays. Returns what is wrong, or nothing. */
export function renameMedia(id: string, name: string): string | undefined {
  const item = items().find((row) => row.id === id);
  if (!item) return t("This file is no longer in the library.");
  const extension = item.name.match(/\.[^.]+$/)?.[0] ?? "";
  const base = name.trim().replace(/\.[^.]+$/, "").replace(/[\\/]/g, "-").slice(0, 120);
  if (!base) return t("Give it a name.");
  if (`${base}${extension}` !== item.name) putItem({ ...item, name: `${base}${extension}` });
}

export function markMediaUsed(ids: readonly string[]) {
  const at = new Date().toISOString();
  for (const id of ids) {
    const item = items().find((row) => row.id === id);
    if (item) putItem({ ...item, uses: item.uses + 1, lastUsedAt: at });
  }
}

/** What a delete took, so Undo can put it back. `blob` is null for a file this browser never downloaded. */
export type RemovedMedia = { item: MediaItem; blob: Blob | null }[];

/** How long the cloud copy of a deleted item waits, so Undo can still bring back one that was never downloaded here. */
const UNDO_MS = 15_000;
/** Cloud copies waiting to be deleted, kept so a tab closed in the meantime deletes them on the next visit. */
const DELETES_KEY = "plan.video.media-deletes";
const deleteTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** A copy waiting to be deleted, with the shared workspace it's in, if any: those are in the owner's storage. */
type WaitingDelete = { id: string; team?: TeamScope };

function waitingDeletes(): WaitingDelete[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DELETES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown): WaitingDelete[] => {
      // Saved as a bare id before shared workspaces.
      if (typeof entry === "string") return [{ id: entry }];
      const row = entry as WaitingDelete | null;
      if (typeof row?.id !== "string") return [];
      const team = row.team && typeof row.team.owner === "string" && typeof row.team.workspace === "string" ? row.team : undefined;
      return [{ id: row.id, ...(team ? { team } : {}) }];
    });
  } catch {
    return [];
  }
}

function saveWaitingDeletes(entries: readonly WaitingDelete[]) {
  try {
    if (entries.length) localStorage.setItem(DELETES_KEY, JSON.stringify(entries));
    else localStorage.removeItem(DELETES_KEY);
  } catch {
    // Without it, a tab closed within the Undo window leaves that copy in the cloud.
  }
}

function deleteCopies(entries: readonly WaitingDelete[]) {
  const byWorkspace = new Map<string, WaitingDelete[]>();
  for (const entry of entries) {
    const key = entry.team ? `${entry.team.owner}/${entry.team.workspace}` : "";
    byWorkspace.set(key, [...(byWorkspace.get(key) ?? []), entry]);
  }
  for (const group of byWorkspace.values()) {
    const ids = group.map((entry) => entry.id);
    queueCloud(`media-delete:${ids.join(",")}`, async () => {
      await deleteFromCloud("media", ids.flatMap((id) => [id, posterId(id)]), group[0]!.team);
      const done = new Set(ids);
      saveWaitingDeletes(waitingDeletes().filter((entry) => !done.has(entry.id)));
    });
  }
}

/** Deletes the copies a closed tab left waiting. */
export function flushMediaDeletes() {
  if (cloudEnabled) deleteCopies(waitingDeletes().filter((entry) => !deleteTimers.has(entry.id)));
}

export async function deleteMedia(ids: readonly string[]): Promise<RemovedMedia> {
  const team = activeScope();
  const database = await db();
  const removed: RemovedMedia = [];
  for (const id of ids) {
    const item = items().find((row) => row.id === id);
    const stored = await database.get("files", id);
    if (item && (stored || item.cloud)) removed.push({ item, blob: stored?.blob ?? null });
  }
  const gone = new Set(ids);
  setItems((current) => current.filter((item) => !gone.has(item.id)));
  const tx = database.transaction(["items", "files"], "readwrite");
  await Promise.all([...ids.flatMap((id) => [tx.objectStore("items").delete(id), tx.objectStore("files").delete(id)]), tx.done]);
  queueAccountSync();
  const copied: WaitingDelete[] = removed.filter(({ item }) => item.cloud).map(({ item }) => ({ id: item.id, ...(team ? { team } : {}) }));
  if (copied.length && cloudEnabled) {
    const fresh = new Set(copied.map((entry) => entry.id));
    saveWaitingDeletes([...waitingDeletes().filter((entry) => !fresh.has(entry.id)), ...copied]);
    const timer = setTimeout(() => {
      for (const entry of copied) deleteTimers.delete(entry.id);
      deleteCopies(copied);
    }, UNDO_MS);
    for (const entry of copied) deleteTimers.set(entry.id, timer);
  }
  return removed;
}

export async function restoreMedia(removed: RemovedMedia) {
  const database = await db();
  const restored: { item: MediaItem; blob: Blob | null }[] = [];
  for (const { item, blob } of removed) {
    const timer = deleteTimers.get(item.id);
    // Still in the cloud: it comes back as it was, on the account too.
    if (timer) {
      clearTimeout(timer);
      deleteTimers.delete(item.id);
      restored.push({ item, blob });
    } else if (blob) {
      restored.push({ item: { ...item, cloud: undefined, cloudPoster: undefined }, blob });
    }
  }
  const kept = new Set(restored.filter(({ item }) => item.cloud).map(({ item }) => item.id));
  saveWaitingDeletes(waitingDeletes().filter((entry) => !kept.has(entry.id)));
  const tx = database.transaction(["items", "files"], "readwrite");
  await Promise.all([
    ...restored.flatMap(({ item, blob }) => [tx.objectStore("items").put(item), ...(blob ? [tx.objectStore("files").put({ id: item.id, blob })] : [])]),
    tx.done,
  ]);
  const back = new Set(restored.map(({ item }) => item.id));
  setItems((current) => newestFirst([...current.filter((item) => !back.has(item.id)), ...restored.map(({ item }) => item)]));
  for (const { item } of restored) if (!onAccount(item)) backUp(item.id);
  queueAccountSync();
}
