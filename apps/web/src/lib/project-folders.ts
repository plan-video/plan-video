/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Folders the person sorts their projects into, listed in the Projects
// sidebar. A project is in one folder at most, by its key (projectKey), which
// stays the same through a rename. Projects belong to a person rather than a
// workspace (projects/owners.ts), so their folders do too, and sync with the
// account (lib/account-sync.ts). Taking a project out of every folder, or
// deleting the folder, leaves the project itself as it is.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { t } from "@/lib/i18n";

export type ProjectFolder = {
  id: string;
  name: string;
  /** Project keys, sorted, each in this folder only. */
  projects: string[];
  createdAt: string;
};

const MAX_NAME = 40;

/** Where `userId`'s folders are kept in this browser. */
export const projectFoldersKey = (userId: string) => `plan.video.project-folders.${userId}`;

const [folders, setFolders] = createSignal<ProjectFolder[]>([]);
let loadedKey: string | undefined;

/** By name, as the sidebar lists them: the synced copy keeps its rows in id order. */
export const projectFolders = () => [...folders()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export function isProjectFolder(value: unknown): value is ProjectFolder {
  if (!value || typeof value !== "object") return false;
  const row = value as ProjectFolder;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    Array.isArray(row.projects) &&
    row.projects.every((key) => typeof key === "string")
  );
}

/** Reads the account copy again. `loadProjectFolders` does nothing when this person's are already loaded. */
export function reloadProjectFolders(userId: string | undefined) {
  loadedKey = undefined;
  loadProjectFolders(userId);
}

export function loadProjectFolders(userId: string | undefined) {
  // A guest keeps theirs under the guest id, and they never sync.
  const owner = ownerOf(userId);
  if (!owner) {
    loadedKey = undefined;
    setFolders([]);
    return;
  }
  const key = projectFoldersKey(owner);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setFolders(Array.isArray(parsed) ? parsed.filter(isProjectFolder) : []);
  } catch {
    setFolders([]);
  }
}

function write(update: (current: ProjectFolder[]) => ProjectFolder[]) {
  if (!loadedKey) return;
  setFolders(update);
  try {
    localStorage.setItem(loadedKey, JSON.stringify(folders()));
  } catch {
    // Storage full or blocked: the change holds until the page reloads.
    return;
  }
  queueAccountSync();
}

function cleanName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
}

/** "New folder", or "New folder 2" and on while that is taken. */
function freeName() {
  const base = t("New folder");
  const taken = new Set(folders().map((folder) => folder.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Makes a folder holding `projects`, taken out of the folders they were in, and returns it. */
export function createProjectFolder(projects: readonly string[] = []): ProjectFolder | undefined {
  if (!loadedKey) return;
  const folder: ProjectFolder = { id: crypto.randomUUID(), name: freeName(), projects: [...new Set(projects)].sort(), createdAt: new Date().toISOString() };
  const moving = new Set(projects);
  write((current) => [...current.map((row) => (row.projects.some((key) => moving.has(key)) ? { ...row, projects: row.projects.filter((key) => !moving.has(key)) } : row)), folder]);
  return folder;
}

/** False when the name is empty, which keeps the old one. */
export function renameProjectFolder(id: string, name: string): boolean {
  const clean = cleanName(name);
  if (!clean) return false;
  write((current) => current.map((folder) => (folder.id === id && folder.name !== clean ? { ...folder, name: clean } : folder)));
  return true;
}

export function deleteProjectFolder(id: string) {
  write((current) => current.filter((folder) => folder.id !== id));
}

/** Puts a deleted folder back, as Undo does. Projects moved elsewhere since stay where they went. */
export function restoreProjectFolder(folder: ProjectFolder) {
  write((current) => {
    if (current.some((row) => row.id === folder.id)) return current;
    const elsewhere = new Set(current.flatMap((row) => row.projects));
    return [...current, { ...folder, projects: folder.projects.filter((key) => !elsewhere.has(key)) }];
  });
}

/** Moves the projects into the folder, out of any other; `null` takes them out of every folder. */
export function moveProjectsToFolder(keys: readonly string[], folderId: string | null) {
  const moving = new Set(keys);
  if (!moving.size) return;
  write((current) =>
    current.map((folder) => {
      const kept = folder.projects.filter((key) => !moving.has(key));
      const projects = folder.id === folderId ? [...new Set([...kept, ...moving])].sort() : kept;
      return projects.length === folder.projects.length && projects.every((key, index) => key === folder.projects[index]) ? folder : { ...folder, projects };
    }),
  );
}

/** The folder a project is in, if any. */
export function folderOfProject(key: string): ProjectFolder | undefined {
  return folders().find((folder) => folder.projects.includes(key));
}

export function projectFolder(id: string | undefined): ProjectFolder | undefined {
  return id ? folders().find((folder) => folder.id === id) : undefined;
}
