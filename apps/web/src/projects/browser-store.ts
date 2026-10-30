import { openDB } from "idb";
import type * as idb from "idb";

import type { FsEntry } from "@plan.video/assets";
import type { AssetStat } from "@plan.video/assets";

const DB_NAME = "plan-studio-files";
const DB_VERSION = 1;

interface FileRecord {
  path: string;
  kind: "file" | "directory";
  mtime: number;
  data?: Uint8Array;
}

interface FileDB extends idb.DBSchema {
  files: {
    value: FileRecord;
    key: string;
  };
}

const dbPromise = openDB<FileDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("files")) {
      db.createObjectStore("files", { keyPath: "path" });
    }
  },
});

interface ChangedDB extends idb.DBSchema {
  changed: {
    value: { path: string; at: number };
    key: string;
  };
}

// A database of its own, so adding it needed no version change an open older tab
// would block. Marked before the file is written, so a closed tab loses none.
const changedPromise = openDB<ChangedDB>("plan-studio-changed", 1, {
  upgrade(db) {
    db.createObjectStore("changed", { keyPath: "path" });
  },
});

const listeners = new Set<() => void>();
const outsideListeners = new Set<(paths: readonly string[]) => void>();

// Writes are announced to other tabs, so one with the same project open takes them up
// rather than saving over them.
const tabs = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(DB_NAME);

tabs?.addEventListener("message", (event: MessageEvent<{ paths?: unknown }>) => {
  const paths = event.data?.paths;
  if (Array.isArray(paths)) changedElsewhere(paths.filter((path): path is string => typeof path === "string"));
});

export function onFilesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes from other tabs or the cloud sync (`changedElsewhere`); this tab's own writes aren't reported. */
export function onFilesChangedElsewhere(listener: (paths: readonly string[]) => void): () => void {
  outsideListeners.add(listener);
  return () => outsideListeners.delete(listener);
}

export function changedElsewhere(paths: readonly string[]): void {
  if (!paths.length) return;
  for (const listener of outsideListeners) listener(paths);
}

async function markChanged(marks: readonly { path: string; at: number }[]) {
  if (!marks.length) return;
  const tx = (await changedPromise).transaction("changed", "readwrite");
  await Promise.all([...marks.map((mark) => tx.store.put(mark)), tx.done]);
}

function announce(paths: readonly string[]) {
  for (const listener of listeners) listener();
  if (paths.length) tabs?.postMessage({ paths });
}

export async function allPaths(): Promise<string[]> {
  return (await dbPromise).getAllKeys("files");
}

export async function changedFiles(): Promise<Map<string, number>> {
  const records = await (await changedPromise).getAll("changed");
  return new Map(records.map((record) => [record.path, record.at]));
}

/** Clears a file from the changed list, unless it was written again after `mtime`. */
export async function markBackedUp(path: string, mtime: number): Promise<void> {
  const tx = (await changedPromise).transaction("changed", "readwrite");
  const record = await tx.store.get(path);
  if (record && record.at <= mtime) await tx.store.delete(path);
  await tx.done;
}

export const parentPath = (path: string): string => {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
};

export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

async function put(record: FileRecord): Promise<void> {
  const db = await dbPromise;
  await db.put("files", record);
}

export async function ensureDirectory(path: string): Promise<void> {
  const db = await dbPromise;
  const existing = await db.get("files", path);
  if (existing?.kind === "directory") return;
  if (existing) throw new Error(`${path} is a file.`);

  const parent = parentPath(path);
  if (parent !== "/" && parent !== path) await ensureDirectory(parent);
  await put({ path, kind: "directory", mtime: Date.now() });
}

export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await ensureDirectory(parentPath(path));
  const mtime = Date.now();
  await markChanged([{ path, at: mtime }]);
  await put({ path, kind: "file", mtime, data });
  announce([path]);
}

export async function writeText(path: string, text: string): Promise<void> {
  await writeBytes(path, new TextEncoder().encode(text));
}

/** The check and the write are one transaction, so no other tab's write can land between them. */
export async function replaceText(path: string, expected: string | null, text: string | null): Promise<boolean> {
  if (text !== null) await ensureDirectory(parentPath(path));
  const db = await dbPromise;
  const mtime = Date.now();
  // Marked first, as every write is. A refused replace leaves a mark on a file it didn't
  // write, where the next backup just finds nothing new.
  if (text !== null) await markChanged([{ path, at: mtime }]);

  const tx = db.transaction("files", "readwrite");
  const record = await tx.store.get(path);
  const current = record?.kind === "file" && record.data ? new TextDecoder().decode(record.data) : null;
  if (current !== expected) {
    tx.abort();
    await tx.done.catch(() => {});
    return false;
  }
  if (text !== null) await tx.store.put({ path, kind: "file", mtime, data: new TextEncoder().encode(text) });
  else if (record) await tx.store.delete(path);
  await tx.done;
  announce([path]);
  return true;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** Like `replaceText` for bytes, in one transaction; null when the file had changed, else the write time. */
export async function replaceBytes(path: string, expected: Uint8Array | null, data: Uint8Array): Promise<number | null> {
  await ensureDirectory(parentPath(path));
  const db = await dbPromise;
  const mtime = Date.now();
  await markChanged([{ path, at: mtime }]);

  const tx = db.transaction("files", "readwrite");
  const record = await tx.store.get(path);
  const unchanged = expected === null ? record === undefined : record?.kind === "file" && !!record.data && sameBytes(record.data, expected);
  if (!unchanged) {
    tx.abort();
    await tx.done.catch(() => {});
    return null;
  }
  await tx.store.put({ path, kind: "file", mtime, data });
  await tx.done;
  announce([path]);
  return mtime;
}

export async function readBytes(path: string): Promise<Uint8Array | null> {
  const db = await dbPromise;
  const record = await db.get("files", path);
  if (!record || record.kind !== "file" || !record.data) return null;
  return record.data;
}

export async function readText(path: string): Promise<string | null> {
  const data = await readBytes(path);
  if (!data) return null;
  return new TextDecoder().decode(data);
}

export async function statPath(path: string): Promise<AssetStat | null> {
  const db = await dbPromise;
  const record = await db.get("files", path);
  if (!record || record.kind !== "file") return null;
  return { size: record.data?.byteLength ?? 0, mtime: record.mtime };
}

export async function listDirectory(path: string): Promise<FsEntry[]> {
  const db = await dbPromise;
  const prefix = path.endsWith("/") ? path : `${path}/`;
  const records = await db.getAll("files");
  return records
    .filter((record) => record.path.startsWith(prefix) && !record.path.slice(prefix.length).includes("/"))
    .map((record) => ({
      name: baseName(record.path),
      kind: record.kind,
      size: record.data?.byteLength ?? 0,
      mtime: record.mtime,
    }));
}

export async function existsPath(path: string): Promise<boolean> {
  const db = await dbPromise;
  return (await db.getKey("files", path)) !== undefined;
}

export async function removeTree(path: string): Promise<void> {
  const db = await dbPromise;
  const prefix = path.endsWith("/") ? path : `${path}/`;
  const keys = await db.getAllKeys("files");
  const removing = keys.filter((key) => key === path || key.startsWith(prefix));
  const tx = db.transaction("files", "readwrite");
  for (const key of removing) await tx.store.delete(key);
  await tx.done;
  announce(removing);
}

export async function copyTree(from: string, to: string, { keepTimes = false } = {}): Promise<void> {
  const db = await dbPromise;
  const prefix = `${from}/`;
  const records = await db.getAll("files");
  const copying = records.filter((record) => record.path === from || record.path.startsWith(prefix));
  const now = Date.now();
  const target = (path: string) => (path === from ? to : `${to}${path.slice(from.length)}`);
  const timeOf = (record: FileRecord) => (keepTimes ? record.mtime : now);
  await markChanged(copying.filter((record) => record.kind === "file").map((record) => ({ path: target(record.path), at: timeOf(record) })));
  const tx = db.transaction("files", "readwrite");
  for (const record of copying) {
    const data = record.data ? new Uint8Array(record.data) : undefined;
    await tx.store.put({ path: target(record.path), kind: record.kind, mtime: timeOf(record), data });
  }
  await tx.done;
  announce(copying.map((record) => target(record.path)));
}

export async function moveTree(from: string, to: string): Promise<void> {
  const db = await dbPromise;
  const prefix = `${from}/`;
  const records = await db.getAll("files");
  const moving = records.filter((record) => record.path === from || record.path.startsWith(prefix));
  const target = (path: string) => (path === from ? to : `${to}${path.slice(from.length)}`);
  await markChanged(moving.filter((record) => record.kind === "file").map((record) => ({ path: target(record.path), at: record.mtime })));
  const tx = db.transaction("files", "readwrite");
  for (const record of moving) {
    await tx.store.delete(record.path);
    await tx.store.put({ ...record, path: target(record.path) });
  }
  await tx.done;
  announce(moving.flatMap((record) => [record.path, target(record.path)]));
}
