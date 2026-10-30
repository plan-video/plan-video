/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Filed under projectId, so a renamed folder is still the same project. Each file is compared here, in the cloud,
// and as last agreed. A file changed on both sides takes the cloud's copy and sets this browser's aside under
// `.conflicts/` (see `settleClashes`). Trash and covers travel as files in the project's folder.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { toast } from "somoto";

import {
  cloudEnabled,
  cloudReadUrls,
  cloudStopped,
  cloudUserId,
  deleteProjectFromCloud,
  listCloudProjects,
  queueCloud,
  uploadToCloud,
  type CloudProjectFile,
} from "@/lib/cloud-storage";
import {
  addProjectRecords,
  forgetProject,
  forgetProjectBundle,
  getProjectRecord,
  listProjectRecords,
  listTrashedProjectRecords,
  rememberProjectCover,
  restoreProjectRecord,
  trashProjectRecord,
  updateProjectRecord,
} from "@/lib/db";
import { t } from "@/lib/i18n";
import { keepBrowserStorage } from "@/lib/persistent-storage";

import {
  COVER_FILE,
  TRASHED_FILE,
  browserGetProject,
  browserKeepCover,
  browserMarkTrashed,
  folderSlug,
  freeFolder,
} from "./browser";
import {
  allPaths,
  changedElsewhere,
  changedFiles,
  existsPath,
  markBackedUp,
  onFilesChanged,
  readBytes,
  readText,
  removeTree,
  replaceBytes,
  statPath,
  writeBytes,
} from "./browser-store";
import { markProjectsChanged } from "./host";
import { SYNCED_DB_PREFIX, claimSharedProjects, isProjectIn, ownerRoot, sharedProjects } from "./owners";

/** `remoteAt` is the cloud's time for it, once known. */
type Synced = { id: string; projectId: string; path: string; size: number; mtime: number; remoteAt?: number };

interface SyncedDB extends DBSchema {
  /** By `projectId/path`, as it was when uploaded or downloaded. */
  synced: { key: string; value: Synced };
}

/** Per account, so two people on one browser each get a whole copy. */
const syncedDb = (userId: string) =>
  openDB<SyncedDB>(`${SYNCED_DB_PREFIX}${userId}`, 1, {
    upgrade(database) {
      database.createObjectStore("synced", { keyPath: "id" });
    },
  });

const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/;
/** Waits for typing and autosave to settle before looking. */
const SETTLE_MS = 15_000;
const LOOK_EVERY_MS = 5 * 60_000;
/** Coming back to the tab looks again, but not more often than this. */
const LOOK_GAP_MS = 60_000;
/** Read links last 15 minutes, so a big project asks for them a few files at a time. */
const DOWNLOAD_BATCH = 20;

type LocalFile = { path: string; projectId: string; rel: string };

async function projectIdOf(dir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse((await readText(`${dir}/package.json`)) ?? "null") as { projectId?: unknown } | null;
    return typeof pkg?.projectId === "string" && PROJECT_ID.test(pkg.projectId) ? pkg.projectId : null;
  } catch {
    return null;
  }
}

async function localProjects(home: string): Promise<{ dirs: Map<string, string>; files: Map<string, LocalFile> }> {
  const root = `${home}/`;
  const paths = (await allPaths()).filter((path) => path.startsWith(root));
  const folders = new Set<string>();
  for (const path of paths) {
    let parent = path.slice(0, path.lastIndexOf("/"));
    while (parent.length > home.length) {
      folders.add(parent);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
  }

  const dirs = new Map<string, string>();
  const files = new Map<string, LocalFile>();
  const projects = new Set(paths.filter((path) => !path.slice(root.length).includes("/")));
  for (const dir of projects) {
    const projectId = await projectIdOf(dir);
    if (!projectId || dirs.has(projectId)) continue;
    dirs.set(projectId, dir);
    for (const path of paths) {
      if (!path.startsWith(`${dir}/`) || folders.has(path)) continue;
      const rel = path.slice(dir.length + 1);
      files.set(`${projectId}/${rel}`, { path, projectId, rel });
    }
  }
  return { dirs, files };
}

function groupBy<T>(rows: Iterable<T>, key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

/** The server only stores these; this checks again. */
const safePath = (path: string) => !!path && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** Covers are stored as bytes; the type is sniffed from the first few. */
function imageType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return "";
}

/** Not offered again until the next visit. */
const refused = new Set<string>();

type Pass = {
  userId: string;
  home: string;
  database: IDBPDatabase<SyncedDB>;
  changed: Map<string, number>;
  copies: Map<string, Synced>;
  /** Their cloud time is read once the pass is done. */
  uploaded: Set<string>;
  listChanged: boolean;
  /** A file saved since is newer than the pass knows. */
  startedAt: number;
};

/** The rest of the pass isn't theirs. */
class SomeoneElse extends Error {}

/** Run before each upload, download or delete. */
async function stillSignedIn(pass: Pass) {
  if ((await cloudUserId()) !== pass.userId) throw new SomeoneElse();
}

async function agree(pass: Pass, entry: Synced) {
  await pass.database.put("synced", entry);
  pass.copies.set(entry.id, entry);
}

async function forget(pass: Pass, entries: readonly Synced[]) {
  const tx = pass.database.transaction("synced", "readwrite");
  await Promise.all([...entries.map((entry) => tx.store.delete(entry.id)), tx.done]);
  for (const entry of entries) pass.copies.delete(entry.id);
}

type Upload = { file: LocalFile; id: string; size: number; mtime: number };

async function changedHere(pass: Pass, files: readonly LocalFile[]): Promise<Upload[]> {
  const uploads: Upload[] = [];
  for (const file of files) {
    const id = `${file.projectId}/${file.rel}`;
    const copy = pass.copies.get(id);
    if ((copy && !pass.changed.has(file.path)) || refused.has(id)) continue;
    const stat = await statPath(file.path);
    if (!stat) continue;
    if (copy && copy.size === stat.size && copy.mtime === stat.mtime) {
      await markBackedUp(file.path, stat.mtime);
      continue;
    }
    uploads.push({ file, id, size: stat.size, mtime: stat.mtime });
  }
  return uploads;
}

/**
 * Uploading these would overwrite another browser's save. A file agreed on before cloud times were kept
 * can't be told apart, and goes up as before.
 */
function clashes(pass: Pass, uploads: readonly Upload[], there: readonly CloudProjectFile[]): Upload[] {
  const at = new Map(there.map((file) => [file.path, file.at]));
  return uploads.filter((upload) => {
    const copy = pass.copies.get(upload.id);
    const now = at.get(upload.file.rel);
    if (now === undefined) return false;
    return copy ? copy.remoteAt !== undefined && now !== copy.remoteAt : true;
  });
}

const CONFLICTS = ".conflicts";
const KEEP_CONFLICTS = 5;

/** A clash on one takes the cloud's copy, with nothing set aside. */
const madeByApp = (rel: string) => rel === COVER_FILE || rel === TRASHED_FILE || rel.startsWith("cache/") || rel.startsWith(`${CONFLICTS}/`);

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** Named for when this browser saved its side, so a retried pass keeps the same copy. */
const stampOf = (mtime: number) => new Date(mtime).toISOString().replace(/[:.]/g, "-");

/** The file now holds the other browser's copy. */
type Kept = { path: string; aside: string; stamp: string; mine: Uint8Array };

/**
 * Each comes down first: identical bytes are agreement (a lost upload answer, or another tab's).
 * A file written again meanwhile, or that didn't come down, waits for the next pass.
 */
async function settleClashes(pass: Pass, projectId: string, dir: string, clashing: readonly Upload[], there: readonly CloudProjectFile[]) {
  const at = new Map(there.map((file) => [file.path, file.at]));
  const settled = new Set<string>();
  const kept: Kept[] = [];
  let replaced = false;
  for (let start = 0; start < clashing.length; start += DOWNLOAD_BATCH) {
    const batch = clashing.slice(start, start + DOWNLOAD_BATCH);
    await stillSignedIn(pass);
    const urls = await cloudReadUrls(batch.map((upload) => ({ purpose: "projects" as const, id: projectId, path: upload.file.rel })));
    for (const [index, upload] of batch.entries()) {
      const { file } = upload;
      const response = await fetch(urls[index]!).catch(() => null);
      if (!response?.ok) continue;
      const theirs = new Uint8Array(await response.arrayBuffer());
      const mine = await readBytes(file.path);
      if (!mine) continue;
      let mtime = upload.mtime;
      if (!sameBytes(mine, theirs)) {
        const stamp = stampOf(upload.mtime);
        const aside = madeByApp(file.rel) ? null : `${dir}/${CONFLICTS}/${stamp}/${file.rel}`;
        if (aside) await writeBytes(aside, mine);
        const written = await replaceBytes(file.path, mine, theirs);
        if (written === null) {
          // Saved again since it was read: the next pass looks at it afresh.
          if (aside) await removeTree(aside);
          continue;
        }
        mtime = written;
        replaced = true;
        changedElsewhere([file.path]);
        if (aside) kept.push({ path: file.path, aside, stamp, mine });
      }
      await agree(pass, { id: upload.id, projectId, path: file.rel, size: theirs.byteLength, mtime, remoteAt: at.get(file.rel) });
      await markBackedUp(file.path, mtime);
      settled.add(file.rel);
    }
  }
  if (kept.length) await pruneConflicts(dir);
  if (replaced) {
    // Its name, cover or trash may have come down with it.
    await listProject(dir);
    pass.listChanged = true;
  }
  return { settled, kept };
}

async function pruneConflicts(dir: string) {
  const root = `${dir}/${CONFLICTS}/`;
  const stamps = [...new Set((await allPaths()).filter((path) => path.startsWith(root)).map((path) => path.slice(root.length).split("/")[0]!))].sort();
  for (const stamp of stamps.slice(0, -KEEP_CONFLICTS)) await removeTree(`${root}${stamp}`);
}

/** Keeps the other browser's aside in its place. It goes up as any edit does. */
async function useMine(kept: readonly Kept[]) {
  for (const { path, aside, stamp, mine } of kept) {
    const theirs = await readBytes(path);
    if (theirs) await writeBytes(aside.replace(`/${CONFLICTS}/${stamp}/`, `/${CONFLICTS}/${stamp}-theirs/`), theirs);
    await writeBytes(path, mine);
  }
  changedElsewhere(kept.map((item) => item.path));
}

async function push(pass: Pass, projectId: string, uploads: readonly Upload[], deleted: readonly Synced[]) {
  for (const { file, id, size, mtime } of uploads) {
    const data = await readBytes(file.path);
    if (!data && size) continue;
    await stillSignedIn(pass);
    try {
      await uploadToCloud({ purpose: "projects", id: projectId, path: file.rel }, new Blob([(data ?? new Uint8Array()) as Uint8Array<ArrayBuffer>]));
    } catch (error) {
      if (cloudStopped(error)) throw error;
      refused.add(id);
      continue;
    }
    await agree(pass, { id, projectId, path: file.rel, size, mtime });
    pass.uploaded.add(id);
    await markBackedUp(file.path, mtime);
  }
  if (deleted.length) {
    await stillSignedIn(pass);
    await deleteProjectFromCloud(projectId, deleted.map((entry) => entry.path));
    await forget(pass, deleted);
  }
}

/** Emptied from the trash, or its 30 days ran out. */
async function eraseFromCloud(pass: Pass, projectId: string, agreed: readonly Synced[]) {
  await stillSignedIn(pass);
  await deleteProjectFromCloud(projectId);
  await forget(pass, agreed);
}

/** Named as it's named elsewhere. Null until its package.json is up. */
async function newFolder(pass: Pass, projectId: string, there: readonly CloudProjectFile[]): Promise<string | null> {
  const pkg = there.find((file) => file.path === "package.json");
  if (!pkg) return null;
  await stillSignedIn(pass);
  const [url] = await cloudReadUrls([{ purpose: "projects", id: projectId, path: pkg.path }]);
  const response = await fetch(url!);
  if (!response.ok) return null;
  let name = "";
  try {
    const parsed = (await response.json()) as { name?: unknown; displayName?: unknown };
    name = typeof parsed.displayName === "string" ? parsed.displayName : typeof parsed.name === "string" ? parsed.name : "";
  } catch {
    return null;
  }
  return `${pass.home}/${await freeFolder(pass.home, folderSlug(name))}`;
}

async function pull(
  pass: Pass,
  projectId: string,
  dir: string | undefined,
  here: readonly LocalFile[],
  there: readonly CloudProjectFile[],
  agreed: readonly Synced[],
) {
  if (dir && !there.length) {
    if (!agreed.length) return;
    await removeTree(dir);
    await forgetProject(dir);
    await forgetProjectBundle(projectId);
    await forget(pass, agreed);
    pass.listChanged = true;
    return;
  }

  const hereBy = new Set(here.map((file) => file.rel));
  const thereBy = new Set(there.map((file) => file.path));
  const downloads: CloudProjectFile[] = [];
  for (const file of there) {
    if (!safePath(file.path)) continue;
    const copy = pass.copies.get(`${projectId}/${file.path}`);
    if (copy?.remoteAt === file.at) continue;
    // Backed up before cloud times were kept: the same size is taken as the same file.
    if (copy && copy.remoteAt === undefined && copy.size === file.size) {
      await agree(pass, { ...copy, remoteAt: file.at });
      continue;
    }
    downloads.push(file);
  }
  const deleted = agreed.filter((entry) => !thereBy.has(entry.path) && hereBy.has(entry.path));
  if (!downloads.length && !deleted.length) return;

  const target = dir ?? (await newFolder(pass, projectId, there));
  if (!target) return;
  keepBrowserStorage();
  // The package.json first, so a pass cut short leaves a folder the next one knows as this project.
  downloads.sort((a, b) => Number(b.path === "package.json") - Number(a.path === "package.json"));
  // An editor open on the project here takes these up (see `watchProject`), even from a pass cut short.
  const arrived: string[] = [];
  try {
    for (let start = 0; start < downloads.length; start += DOWNLOAD_BATCH) {
      const batch = downloads.slice(start, start + DOWNLOAD_BATCH);
      await stillSignedIn(pass);
      const urls = await cloudReadUrls(batch.map((file) => ({ purpose: "projects" as const, id: projectId, path: file.path })));
      for (const [index, file] of batch.entries()) {
        const path = `${target}/${file.path}`;
        const id = `${projectId}/${file.path}`;
        // Read before the download so a save in between shows.
        const before = await readBytes(path);
        const saved = before ? await statPath(path) : null;
        // Saved here since the pass looked: the next pass settles it as a clash.
        if (before && (!saved || saved.mtime >= pass.startedAt)) continue;
        const response = await fetch(urls[index]!).catch(() => null);
        // Deleted or replaced since the list was read: the next pass sees it as it is then.
        if (!response?.ok) continue;
        // Written only over what was read above, so an edit saved during the download isn't lost.
        const mtime = await replaceBytes(path, before, new Uint8Array(await response.arrayBuffer()));
        if (mtime === null) continue;
        arrived.push(path);
        const stat = await statPath(path);
        if (!stat) continue;
        await agree(pass, { id, projectId, path: file.path, size: stat.size, mtime: stat.mtime, remoteAt: file.at });
        await markBackedUp(path, stat.mtime);
      }
    }
    for (const entry of deleted) {
      await removeTree(`${target}/${entry.path}`);
      arrived.push(`${target}/${entry.path}`);
    }
  } finally {
    changedElsewhere(arrived);
  }
  await forget(pass, deleted);
  await listProject(target);
  pass.listChanged = true;
}

async function listProject(dir: string) {
  const project = await browserGetProject(dir);
  if (!project) return;
  if (await getProjectRecord(dir)) await updateProjectRecord(project);
  else await addProjectRecords([project]);

  const cover = await readBytes(`${dir}/${COVER_FILE}`);
  if (cover?.byteLength) await rememberProjectCover(dir, new Blob([cover as Uint8Array<ArrayBuffer>], { type: imageType(cover) }));

  const trashed = (await readText(`${dir}/${TRASHED_FILE}`))?.trim();
  const record = await getProjectRecord(dir);
  if (trashed && !record?.trashedAt) await trashProjectRecord(dir, Number.isNaN(Date.parse(trashed)) ? new Date().toISOString() : trashed);
  else if (!trashed && record?.trashedAt) await restoreProjectRecord(dir);
}

/** So the next pass can tell another browser's change apart, even one of the same size. */
async function learnTimes(pass: Pass) {
  for (const file of await listCloudProjects()) {
    const id = `${file.id}/${file.path}`;
    const copy = pass.copies.get(id);
    if (pass.uploaded.has(id) && copy && copy.remoteAt === undefined && copy.size === file.size) await agree(pass, { ...copy, remoteAt: file.at });
  }
}

const carried = new Set<string>();

/** Once a visit per person: moves trash and covers kept before they synced into the projects' folders. */
async function carryOver(home: string) {
  if (carried.has(home)) return;
  carried.add(home);
  for (const record of await listTrashedProjectRecords()) {
    if (!isProjectIn(home, record.dir) || !record.trashedAt || (await existsPath(`${record.dir}/${TRASHED_FILE}`))) continue;
    if (await existsPath(`${record.dir}/package.json`)) await browserMarkTrashed(record.dir, record.trashedAt);
  }
  for (const record of await listProjectRecords()) {
    if (!record.cover || !isProjectIn(home, record.dir) || (await existsPath(`${record.dir}/${COVER_FILE}`))) continue;
    await browserKeepCover(record.dir, record.cover);
  }
}

async function syncProjects(userId: string) {
  await claimSharedProjects();
  const home = ownerRoot(userId);
  await carryOver(home);
  const database = await syncedDb(userId);
  try {
    const startedAt = Date.now();
    const [local, changed, synced, remote, shared] = await Promise.all([
      localProjects(home),
      changedFiles(),
      database.getAll("synced"),
      listCloudProjects(),
      sharedProjects(),
    ]);
    // Still in the old shared folder waiting to be handed over: not taken as erased here.
    const waiting = new Set(shared.map((project) => project.projectId));
    const pass: Pass = { userId, home, database, changed, copies: new Map(synced.map((entry) => [entry.id, entry])), uploaded: new Set(), listChanged: false, startedAt };
    const hereBy = groupBy(local.files.values(), (file) => file.projectId);
    const thereBy = groupBy(
      remote.filter((file) => PROJECT_ID.test(file.id)),
      (file) => file.id,
    );
    const agreedBy = groupBy(synced, (entry) => entry.projectId);

    for (const projectId of new Set([...local.dirs.keys(), ...thereBy.keys(), ...agreedBy.keys()])) {
      const dir = local.dirs.get(projectId);
      const here = hereBy.get(projectId) ?? [];
      const there = thereBy.get(projectId) ?? [];
      const agreed = agreedBy.get(projectId) ?? [];
      if (!dir) {
        if (agreed.length) {
          if (!waiting.has(projectId)) await eraseFromCloud(pass, projectId, agreed);
        } else await pull(pass, projectId, undefined, [], there, []);
        continue;
      }
      const changed = await changedHere(pass, here);
      const clashing = clashes(pass, changed, there);
      const uploads = changed.filter((upload) => !clashing.includes(upload));
      const present = new Set(here.map((file) => file.rel));
      const deleted = agreed.filter((entry) => !present.has(entry.path));
      if (clashing.length) {
        const { settled, kept } = await settleClashes(pass, projectId, dir, clashing, there);
        // The rest of the other browser's save comes down too, so the project isn't half one save and half the other.
        const mine = new Set([...uploads.map((upload) => upload.file.rel), ...deleted.map((entry) => entry.path)]);
        for (const upload of clashing) if (!settled.has(upload.file.rel)) mine.add(upload.file.rel);
        const theirs = there.filter((file) => !mine.has(file.path));
        if (theirs.length) await pull(pass, projectId, dir, here, theirs, agreed.filter((entry) => !mine.has(entry.path)));
        if (kept.length) {
          const name = (await getProjectRecord(dir))?.displayName ?? "";
          toast(t("Opened the newer version from another device"), {
            description: name
              ? t("{name} was saved on another device after this browser last synced. Your edits here are kept in a copy.", { name })
              : t("This project was saved on another device after this browser last synced. Your edits here are kept in a copy."),
            action: { label: t("Use mine instead"), onClick: () => void useMine(kept) },
            duration: 20_000,
          });
        }
      }
      if (uploads.length || deleted.length) await push(pass, projectId, uploads, deleted);
      else if (!clashing.length) await pull(pass, projectId, dir, here, there, agreed);
    }
    if (pass.uploaded.size) await learnTimes(pass);
    if (pass.listChanged) markProjectsChanged();
  } finally {
    database.close();
  }
}

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastRun = 0;

/** Called again for each sign-in, which looks at once, so the next person's projects come down. */
export function startProjectSync() {
  if (!cloudEnabled) return;
  if (started) return run();
  started = true;
  onFilesChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(run, SETTLE_MS);
  });
  window.addEventListener("focus", look);
  document.addEventListener("visibilitychange", look);
  setInterval(look, LOOK_EVERY_MS);
  run();
}

function run() {
  lastRun = Date.now();
  queueCloud("projects", async () => {
    const userId = await cloudUserId();
    if (!userId) return;
    try {
      await syncProjects(userId);
    } catch (error) {
      // The next person's pass starts with their own sign-in (see `startProjectSync`).
      if (!(error instanceof SomeoneElse)) throw error;
    }
  });
}

function look() {
  if (document.visibilityState === "visible" && Date.now() - lastRun > LOOK_GAP_MS) run();
}
