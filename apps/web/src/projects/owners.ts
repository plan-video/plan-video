/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only the signed-in person's projects (in `/browser/projects/@<user id>`) are listed,
// opened or synced, so someone signing in after another never sees or backs up the
// other's. Project folders are slugs, which never hold an `@`.

import { openDB } from "idb";

import { cloudEnabled } from "@/lib/cloud-storage";
import { copyProjectRecord, moveProjectRecord } from "@/lib/db";
import { guestId, inGuestMode, isGuestProject, signedInUserId } from "@/lib/guest";

import { BROWSER_PROJECTS_ROOT, freeFolder } from "./browser";
import { allPaths, copyTree, moveTree, readText } from "./browser-store";

export const SYNCED_DB_PREFIX = "plan-video-cloud-";

export const ownerRoot = (owner: string): string => `${BROWSER_PROJECTS_ROOT}/@${owner}`;

export function browserProjectsRoot(): string | null {
  const owner = signedInUserId() ?? (inGuestMode() ? guestId() : null);
  return owner ? ownerRoot(owner) : null;
}

export const isProjectIn = (root: string, dir: string): boolean =>
  dir.startsWith(`${root}/`) && !dir.slice(root.length + 1).includes("/");

async function projectIdIn(dir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse((await readText(`${dir}/package.json`)) ?? "null") as { projectId?: unknown } | null;
    return typeof pkg?.projectId === "string" && pkg.projectId ? pkg.projectId : null;
  } catch {
    return null;
  }
}

export async function sharedProjects(): Promise<{ folder: string; dir: string; projectId: string }[]> {
  const root = `${BROWSER_PROJECTS_ROOT}/`;
  const folders = new Set<string>();
  for (const path of await allPaths()) {
    if (!path.startsWith(root)) continue;
    const folder = path.slice(root.length).split("/")[0]!;
    if (folder && !folder.startsWith("@")) folders.add(folder);
  }
  const found = [];
  for (const folder of folders) {
    const projectId = await projectIdIn(`${root}${folder}`);
    if (projectId) found.push({ folder, dir: `${root}${folder}`, projectId });
  }
  return found;
}

/** Null when the browser can't list its databases. */
async function backedUpBy(): Promise<Map<string, Set<string>> | null> {
  if (typeof indexedDB.databases !== "function") return null;
  const owners = new Map<string, Set<string>>();
  for (const { name } of await indexedDB.databases()) {
    if (!name?.startsWith(SYNCED_DB_PREFIX)) continue;
    const userId = name.slice(SYNCED_DB_PREFIX.length);
    // Opened at the version it's at, so nothing here creates or upgrades it.
    const database = await openDB(name);
    try {
      if (!database.objectStoreNames.contains("synced")) continue;
      for (const key of await database.getAllKeys("synced")) {
        if (typeof key !== "string") continue;
        const projectId = key.slice(0, key.indexOf("/"));
        if (!owners.has(projectId)) owners.set(projectId, new Set());
        owners.get(projectId)!.add(userId);
      }
    } finally {
      database.close();
    }
  }
  return owners;
}

/** The ids of the projects already in `root`. */
async function projectIdsIn(root: string): Promise<Set<string>> {
  const prefix = `${root}/`;
  const folders = new Set<string>();
  for (const path of await allPaths()) {
    if (path.startsWith(prefix)) folders.add(path.slice(prefix.length).split("/")[0]!);
  }
  const ids = new Set<string>();
  for (const folder of folders) {
    const projectId = await projectIdIn(`${prefix}${folder}`);
    if (projectId) ids.add(projectId);
  }
  return ids;
}

async function claimNow(): Promise<void> {
  const shared = await sharedProjects();
  if (!shared.length) return;
  const owners = await backedUpBy();
  // Without the list nobody can say whose a backed-up project is, so those stay put.
  if (!owners) return;
  const signedIn = signedInUserId();
  const held = new Map<string, Set<string>>();

  for (const { folder, dir, projectId } of shared) {
    let claimants = [...(owners.get(projectId) ?? [])];
    if (!claimants.length && isGuestProject(projectId)) claimants = [guestId()].filter((id): id is string => !!id);
    else if (!claimants.length && !cloudEnabled && signedIn) claimants = [signedIn];

    for (const [index, owner] of claimants.entries()) {
      const root = ownerRoot(owner);
      if (!held.has(root)) held.set(root, await projectIdsIn(root));
      if (held.get(root)!.has(projectId)) continue;
      const target = `${root}/${await freeFolder(root, folder)}`;
      // Copies keep the files' times, so the sync finds them as it left them.
      if (index === claimants.length - 1) {
        await moveTree(dir, target);
        await moveProjectRecord(dir, target);
      } else {
        await copyTree(dir, target, { keepTimes: true });
        await copyProjectRecord(dir, target);
      }
      held.get(root)!.add(projectId);
    }
  }
}

const claims = new Map<string | null, Promise<void>>();
/** One claim at a time, so two can't move the same folder. */
let claiming: Promise<void> = Promise.resolve();

/**
 * Hands each project in the old shared folder to the accounts whose cloud backup holds it;
 * one nobody backed up stays put. Listing, opening and syncing wait for it.
 */
export function claimSharedProjects(): Promise<void> {
  if (window.desktop) return Promise.resolve();
  const root = browserProjectsRoot();
  let claim = claims.get(root);
  if (!claim) {
    claim = claiming.then(claimNow).catch((error: unknown) => console.warn("[projects] could not hand shared projects to their owners", error));
    claims.set(root, claim);
    claiming = claim;
  }
  return claim;
}
