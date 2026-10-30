/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { deleteDB, openDB } from 'idb';
import type * as idb from 'idb';

import type { ProjectInfo } from '@desktop/main-channels';

import { msg, t } from '@/lib/i18n';

/** How long a project stays in the in-app trash before its files are deleted. */
export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Short titles for a new project. The card already says when it was edited. */
const PROJECT_NAMES = [
  msg("Quiet Harbor"),
  msg("Silver Lantern"),
  msg("North Wind"),
  msg("Paper Crane"),
  msg("Late Light"),
  msg("Glass Orchard"),
  msg("Copper Finch"),
  msg("Velvet Hour"),
  msg("Amber Field"),
  msg("Little Comet"),
  msg("Open Window"),
  msg("Night Market"),
  msg("Pale Harbor"),
  msg("Warm Static"),
  msg("Blue Hour"),
  msg("Low Tide"),
  msg("Salt Air"),
  msg("Moon Garden"),
  msg("Half Light"),
  msg("Long Take"),
  msg("Still Frame"),
  msg("After Rain"),
  msg("First Light"),
  msg("Distant Shore"),
  msg("Small Fire"),
  msg("Wild Honey"),
  msg("Night Train"),
  msg("Open Road"),
  msg("Soft Focus"),
  msg("Paper Moon"),
  msg("Cold Spring"),
  msg("Bright Interval"),
  msg("Even Tide"),
  msg("Clear Water"),
  msg("Red Lantern"),
  msg("Winter Bloom"),
  msg("Inner Room"),
  msg("Kindling"),
  msg("Second Sunrise"),
  msg("River Glass"),
];

let lastProjectName = "";

export function generateProjectName(): string {
  let name = PROJECT_NAMES[Math.floor(Math.random() * PROJECT_NAMES.length)]!;
  if (PROJECT_NAMES.length > 1) {
    while (name === lastProjectName) {
      name = PROJECT_NAMES[Math.floor(Math.random() * PROJECT_NAMES.length)]!;
    }
  }
  lastProjectName = name;
  return t(name);
}

/**
 * A project the app knows: one it created, one it was asked to open — from
 * the folder picker, or `planvideo open <path>` — or one found in the projects
 * root when that was chosen. The dashboard lists these and nothing else.
 * Keyed by folder, which is how main addresses a project.
 */
export interface ProjectRecord extends ProjectInfo {
  recordedAt: string; // When the app first put it on record.
  lastOpenedAt: string;
  cover: Blob | null;
  /**
   * Set when the project was moved to the in-app trash. Absent means it is
   * still on the projects list. The files stay for 30 days, then the project
   * is permanently deleted.
   */
  trashedAt?: string;
}

/**
 * The bundle a project last mounted successfully, keyed by its id. Two jobs:
 * the copy an export re-renders (see `@/engine/capture`), and the head start
 * the next open of the project mounts while its first compile still runs.
 * Written only after a mount lands, so what is here is always something the
 * canvas has shown.
 */
export interface ProjectBundle {
  projectId: string;
  code: string;
  updatedAt: string;
}

export interface GlobalDBSchema extends idb.DBSchema {
  projects: {
    value: ProjectRecord;
    key: string;
    indexes: {
      'by-id': string;
      'by-last-opened': string;
    };
  };
  bundles: {
    value: ProjectBundle;
    key: string;
  };
}

type UpgradeTransaction = Parameters<NonNullable<idb.OpenDBCallbacks<GlobalDBSchema>['upgrade']>>[3];

const DB_NAME = 'planvideo-idb';
/** What the database was called before the app was renamed. */
const LEGACY_DB_NAME = 'diffusion-studio-idb';
const DB_VERSION = 3;

const upgrade: NonNullable<idb.OpenDBCallbacks<GlobalDBSchema>['upgrade']> = async (db, _oldVersion, _newVersion, tx) => {
  if (!db.objectStoreNames.contains('bundles')) {
    db.createObjectStore('bundles', { keyPath: 'projectId' });
  }
  if (!db.objectStoreNames.contains('projects')) {
    const store = db.createObjectStore('projects', { keyPath: 'dir' });
    store.createIndex('by-id', 'id');
    store.createIndex('by-last-opened', 'lastOpenedAt');
  }
  if (db.objectStoreNames.contains('roots' as never)) await retireRoots(db, tx);
};

const dbPromise = openDB<GlobalDBSchema>(DB_NAME, DB_VERSION, { upgrade }).then(adoptLegacyRecords);

/**
 * Moves the projects and bundles over from the database's old name, once. A
 * browser project lives only in here, so leaving them behind would lose it.
 * The old database goes only after everything is copied, and without waiting:
 * a tab still running the old build holds it open.
 */
async function adoptLegacyRecords(db: idb.IDBPDatabase<GlobalDBSchema>): Promise<idb.IDBPDatabase<GlobalDBSchema>> {
  try {
    const known = await indexedDB.databases();
    if (!known.some((entry) => entry.name === LEGACY_DB_NAME)) return db;

    const legacy = await openDB<GlobalDBSchema>(LEGACY_DB_NAME, DB_VERSION, { upgrade });
    const [projects, bundles] = await Promise.all([legacy.getAll('projects'), legacy.getAll('bundles')]);
    legacy.close();

    const tx = db.transaction(['projects', 'bundles'], 'readwrite');
    await Promise.all([
      ...projects.map((record) => tx.objectStore('projects').put(record)),
      ...bundles.map((bundle) => tx.objectStore('bundles').put(bundle)),
      tx.done,
    ]);
    void deleteDB(LEGACY_DB_NAME);
  } catch (error) {
    console.warn('[db] could not move projects over from the old database', error);
  }
  return db;
}

/** Last segment of a path, whichever separator it uses. */
const folderLabel = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * A record for a project the app has not looked at yet: the folder name
 * stands in for the display name, and the record's own dates for the
 * folder's. What a legacy root is upgraded to; the first open replaces it
 * with what the folder actually says.
 */
function placeholderRecord(dir: string, recordedAt: string, lastOpenedAt: string): ProjectRecord {
  const name = folderLabel(dir);
  return { dir, id: '', name, displayName: name, entry: '', modifiedAt: lastOpenedAt, createdAt: recordedAt, recordedAt, lastOpenedAt, cover: null };
}

/**
 * Versions 1 and 2 kept a `roots` store: folders the dashboard scanned for
 * projects (`kind: 'multi'`), and single project folders registered on their
 * own (`kind: 'single'`). Version 3 does away with it. The single ones become
 * project records; the multi ones are dropped — the projects root lives in
 * localStorage now, and the projects the old one held come back on record
 * when the user picks a root again (see `adoptProjectsRoot` in @/projects).
 */
async function retireRoots(db: idb.IDBPDatabase<GlobalDBSchema>, tx: UpgradeTransaction): Promise<void> {
  type LegacyRoot = { path: string; kind?: 'multi' | 'single'; createdAt: string; lastUsedAt: string };
  const projects = tx.objectStore('projects');

  // The store is not in the schema any more, so it is addressed by name.
  const roots = (tx as unknown as idb.IDBPTransaction<unknown, string[], 'versionchange'>).objectStore('roots');
  for (const root of (await roots.getAll()) as LegacyRoot[]) {
    if (root.kind !== 'single') continue;
    await projects.put(placeholderRecord(root.path, root.createdAt, root.lastUsedAt));
  }

  db.deleteObjectStore('roots' as never);
}

// ---------------------------------------------------------------------------
// Project records

/**
 * Puts `project` on record as just opened — what its folder says now,
 * replacing the copy the record held — or on record for the first time.
 */
export async function rememberProject(project: ProjectInfo): Promise<ProjectRecord> {
  const db = await dbPromise;
  const now = new Date().toISOString();
  const existing = await db.get('projects', project.dir);

  const record: ProjectRecord = existing
    ? { ...existing, ...project, lastOpenedAt: now }
    : { ...project, recordedAt: now, lastOpenedAt: now, cover: null };

  await db.put('projects', record);
  return record;
}

/**
 * Brings the record for `project` up to date with what its folder says,
 * without marking it opened — for a project that changed while it was open,
 * and for one that is closing. Nothing to do when it is not on record.
 */
export async function updateProjectRecord(project: ProjectInfo): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(project.dir);
  if (existing) await tx.store.put({ ...existing, ...project });
  await tx.done;
}

/**
 * Puts every project in `found` that is not on record yet on it, leaving the
 * ones that are alone — they were opened when they were opened. Answers with
 * how many were new. For the projects a freshly chosen root turns out to hold.
 */
export async function addProjectRecords(found: ProjectInfo[]): Promise<number> {
  const db = await dbPromise;
  const now = new Date().toISOString();
  const tx = db.transaction('projects', 'readwrite');
  let added = 0;

  for (const project of found) {
    if (await tx.store.getKey(project.dir)) continue;
    await tx.store.put({ ...project, recordedAt: now, lastOpenedAt: now, cover: null });
    added++;
  }

  await tx.done;
  return added;
}

async function readProjectRecords(): Promise<ProjectRecord[]> {
  const db = await dbPromise;
  return (await db.getAllFromIndex('projects', 'by-last-opened')).reverse();
}

/** Projects still on the list, most recently opened first. Trashed ones are left out. */
export async function listProjectRecords(): Promise<ProjectRecord[]> {
  const records = await readProjectRecords();
  return records.filter((record) => !record.trashedAt);
}

/** Projects in the trash, most recently trashed first. */
export async function listTrashedProjectRecords(): Promise<ProjectRecord[]> {
  const records = await readProjectRecords();
  return records
    .filter((record) => record.trashedAt)
    .sort((a, b) => (a.trashedAt! < b.trashedAt! ? 1 : a.trashedAt! > b.trashedAt! ? -1 : 0));
}

/** The record for the project in `dir`, trashed or not. */
export async function getProjectRecord(dir: string): Promise<ProjectRecord | undefined> {
  return (await dbPromise).get('projects', dir);
}

/**
 * Marks the project in `dir` as trashed, keeping its files; `at` when another
 * browser trashed it then. Nothing to do when it is not on record.
 */
export async function trashProjectRecord(dir: string, at = new Date().toISOString()): Promise<void> {
  const db = await dbPromise;
  const existing = await db.get('projects', dir);
  if (!existing || existing.trashedAt) return;
  await db.put('projects', { ...existing, trashedAt: at });
}

/** Puts the project in `dir` back on the list. Nothing to do when it is not in the trash. */
export async function restoreProjectRecord(dir: string): Promise<void> {
  const db = await dbPromise;
  const existing = await db.get('projects', dir);
  if (!existing?.trashedAt) return;
  const record = { ...existing };
  delete record.trashedAt;
  await db.put('projects', record);
}

/**
 * The records `ref` could name: those whose id it is, then — for links made
 * before ids existed, and folders opened by name — those whose folder it
 * names. Most recently opened first within each, so a project that was just
 * open wins over a copy of it.
 */
export async function findProjectRecords(ref: string): Promise<ProjectRecord[]> {
  const records = await listProjectRecords();
  return [
    ...records.filter((record) => record.id === ref),
    ...records.filter((record) => record.id !== ref && folderLabel(record.dir) === ref),
  ];
}

/**
 * Re-keys the record for `from` to `to`, for a project whose folder moved
 * (renaming one moves its folder). Nothing to do when `from` is not on record.
 */
export async function moveProjectRecord(from: string, to: string): Promise<void> {
  if (from === to) return;
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(from);
  if (existing) {
    await tx.store.delete(from);
    await tx.store.put({ ...existing, dir: to });
  }
  await tx.done;
}

/** Puts a copy of the record for `from` on record for `to`, cover and trash included. Nothing to do when `from` is not on record. */
export async function copyProjectRecord(from: string, to: string): Promise<void> {
  if (from === to) return;
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(from);
  if (existing) await tx.store.put({ ...existing, dir: to });
  await tx.done;
}

/**
 * Records `cover` as the picture of the project in `dir`, replacing the one
 * before it. Nothing to do when the project is not on record: one deleted
 * while its cover was still being taken is not put back.
 */
export async function rememberProjectCover(dir: string, cover: Blob): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(dir);
  if (existing) await tx.store.put({ ...existing, cover });
  await tx.done;
}

/** Takes the project in `dir` off the record. The folder itself is left alone. */
export async function forgetProject(dir: string): Promise<void> {
  const db = await dbPromise;
  await db.delete('projects', dir);
}

// ---------------------------------------------------------------------------
// Project bundles

/** Records the bundle `projectId` just mounted, replacing the one before it. */
export async function rememberProjectBundle(projectId: string, code: string): Promise<void> {
  try {
    const db = await dbPromise;
    await db.put('bundles', { projectId, code, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Failed to remember project bundle', e);
  }
}

/** The bundle `projectId` last mounted, or null when it has none on record. */
export async function loadProjectBundle(projectId: string): Promise<string | null> {
  if (!projectId) return null;
  try {
    const db = await dbPromise;
    return (await db.get('bundles', projectId))?.code ?? null;
  } catch (e) {
    console.error('Failed to load project bundle', e);
    return null;
  }
}

/** Forgets a project's bundle, for when the project itself is deleted. */
export async function forgetProjectBundle(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const db = await dbPromise;
    await db.delete('bundles', projectId);
  } catch (e) {
    console.error('Failed to forget project bundle', e);
  }
}
