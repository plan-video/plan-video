/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { deleteDB, openDB } from 'idb';
import type * as idb from 'idb';

import type { ProjectInfo } from '@desktop/main-channels';

import { msg, t } from '@/lib/i18n';

export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The card already says when it was edited. */
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

/** Keyed by folder, which is how main addresses a project. */
export interface ProjectRecord extends ProjectInfo {
  recordedAt: string;
  lastOpenedAt: string;
  cover: Blob | null;
  trashedAt?: string;
}

/** Written only after a mount lands, so it's always something the canvas has shown. */
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
/** Read once, then moved over. */
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
 * Browser projects live only in here, so they must be copied. The old database goes only after,
 * without waiting: a tab on the old build holds it open.
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

const folderLabel = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** What a legacy root is upgraded to; the first open replaces it with what the folder says. */
function placeholderRecord(dir: string, recordedAt: string, lastOpenedAt: string): ProjectRecord {
  const name = folderLabel(dir);
  return { dir, id: '', name, displayName: name, entry: '', modifiedAt: lastOpenedAt, createdAt: recordedAt, recordedAt, lastOpenedAt, cover: null };
}

/** Versions 1 and 2 kept a `roots` store; single roots become records, multi roots are dropped. */
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

export async function updateProjectRecord(project: ProjectInfo): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(project.dir);
  if (existing) await tx.store.put({ ...existing, ...project });
  await tx.done;
}

/** Leaves existing records alone. Answers with how many were new. */
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

export async function listProjectRecords(): Promise<ProjectRecord[]> {
  const records = await readProjectRecords();
  return records.filter((record) => !record.trashedAt);
}

export async function listTrashedProjectRecords(): Promise<ProjectRecord[]> {
  const records = await readProjectRecords();
  return records
    .filter((record) => record.trashedAt)
    .sort((a, b) => (a.trashedAt! < b.trashedAt! ? 1 : a.trashedAt! > b.trashedAt! ? -1 : 0));
}

export async function getProjectRecord(dir: string): Promise<ProjectRecord | undefined> {
  return (await dbPromise).get('projects', dir);
}

/** `at` is when another browser trashed it. */
export async function trashProjectRecord(dir: string, at = new Date().toISOString()): Promise<void> {
  const db = await dbPromise;
  const existing = await db.get('projects', dir);
  if (!existing || existing.trashedAt) return;
  await db.put('projects', { ...existing, trashedAt: at });
}

export async function restoreProjectRecord(dir: string): Promise<void> {
  const db = await dbPromise;
  const existing = await db.get('projects', dir);
  if (!existing?.trashedAt) return;
  const record = { ...existing };
  delete record.trashedAt;
  await db.put('projects', record);
}

/** Ids first, then folder names; most recently opened first, so a just-open project beats a copy of it. */
export async function findProjectRecords(ref: string): Promise<ProjectRecord[]> {
  const records = await listProjectRecords();
  return [
    ...records.filter((record) => record.id === ref),
    ...records.filter((record) => record.id !== ref && folderLabel(record.dir) === ref),
  ];
}

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

export async function copyProjectRecord(from: string, to: string): Promise<void> {
  if (from === to) return;
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(from);
  if (existing) await tx.store.put({ ...existing, dir: to });
  await tx.done;
}

/** Does nothing when the project is not on record: one deleted while its cover was being taken isn't put back. */
export async function rememberProjectCover(dir: string, cover: Blob): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction('projects', 'readwrite');
  const existing = await tx.store.get(dir);
  if (existing) await tx.store.put({ ...existing, cover });
  await tx.done;
}

export async function forgetProject(dir: string): Promise<void> {
  const db = await dbPromise;
  await db.delete('projects', dir);
}

export async function rememberProjectBundle(projectId: string, code: string): Promise<void> {
  try {
    const db = await dbPromise;
    await db.put('bundles', { projectId, code, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Failed to remember project bundle', e);
  }
}

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

export async function forgetProjectBundle(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const db = await dbPromise;
    await db.delete('bundles', projectId);
  } catch (e) {
    console.error('Failed to forget project bundle', e);
  }
}
