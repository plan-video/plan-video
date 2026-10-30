/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keyed by projectKey, which survives a rename. Folders belong to a person, like projects (projects/owners.ts).

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { t } from "@/lib/i18n";

export type ProjectFolder = {
  id: string;
  name: string;
  /** Each in this folder only. */
  projects: string[];
  createdAt: string;
};

const MAX_NAME = 40;

export const projectFoldersKey = (userId: string) => `plan.video.project-folders.${userId}`;

const [folders, setFolders] = createSignal<ProjectFolder[]>([]);
let loadedKey: string | undefined;

/** Sorted here: the synced copy keeps its rows in id order. */
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

/** `loadProjectFolders` does nothing when this person's are already loaded. */
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

function freeName() {
  const base = t("New folder");
  const taken = new Set(folders().map((folder) => folder.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

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

/** Projects moved elsewhere since stay where they went. */
export function restoreProjectFolder(folder: ProjectFolder) {
  write((current) => {
    if (current.some((row) => row.id === folder.id)) return current;
    const elsewhere = new Set(current.flatMap((row) => row.projects));
    return [...current, { ...folder, projects: folder.projects.filter((key) => !elsewhere.has(key)) }];
  });
}

/** `null` takes them out of every folder. */
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

export function folderOfProject(key: string): ProjectFolder | undefined {
  return folders().find((folder) => folder.projects.includes(key));
}

export function projectFolder(id: string | undefined): ProjectFolder | undefined {
  return id ? folders().find((folder) => folder.id === id) : undefined;
}
