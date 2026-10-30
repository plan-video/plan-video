/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Windows has no File Provider attribute, so each service is found as it announces itself: OneDrive
// by env vars, Dropbox by its info.json, Google Drive by its streaming drive, iCloud by its fixed folder.

import { access, readFile } from "node:fs/promises";
import { win32 } from "node:path";

export type SyncRoot = [dir: string, label: string];

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** Without case, the way Windows compares paths. */
export function isUnder(path: string, root: string): boolean {
  const child = win32.resolve(path).toLowerCase();
  const parent = win32.resolve(root).toLowerCase().replace(/\\+$/, "");
  return child === parent || child.startsWith(parent + "\\");
}

/** One folder per linked Dropbox account, personal and business. */
export function dropboxRoots(infoJson: string): string[] {
  try {
    const info: unknown = JSON.parse(infoJson);
    if (typeof info !== "object" || info === null) return [];
    return Object.values(info)
      .map((account) => (account as { path?: unknown } | null)?.path)
      .filter((path): path is string => typeof path === "string" && path !== "");
  } catch {
    return [];
  }
}

export async function windowsSyncRoots(home: string, env: NodeJS.ProcessEnv = process.env): Promise<SyncRoot[]> {
  const roots: SyncRoot[] = [[win32.join(home, "iCloudDrive"), "iCloud Drive"]];

  for (const key of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
    const dir = env[key];
    if (dir) roots.push([dir, "OneDrive"]);
  }

  const dropbox: string[] = [];
  for (const base of [env.LOCALAPPDATA, env.APPDATA]) {
    if (!base) continue;
    const text = await readFile(win32.join(base, "Dropbox", "info.json"), "utf8").catch(() => null);
    if (text) dropbox.push(...dropboxRoots(text));
  }
  // No info.json (an old or half-installed client): the default location.
  if (dropbox.length === 0) dropbox.push(win32.join(home, "Dropbox"));
  for (const dir of dropbox) roots.push([dir, "Dropbox"]);

  // Google Drive in mirror mode keeps a real folder, by default in the home.
  if (await driveFsInstalled(env)) {
    roots.push([win32.join(home, "My Drive"), "Google Drive"], [win32.join(home, "Google Drive"), "Google Drive"]);
  }

  return roots;
}

function driveFsInstalled(env: NodeJS.ProcessEnv): Promise<boolean> {
  return env.LOCALAPPDATA ? exists(win32.join(env.LOCALAPPDATA, "Google", "DriveFS")) : Promise.resolve(false);
}

/** The streaming drive letter is only in the client's database, so it is recognised by a root holding `My Drive`. */
export async function onGoogleDriveStream(path: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const root = win32.parse(win32.resolve(path)).root;
  if (!/^[a-z]:\\$/i.test(root)) return false;
  return (await driveFsInstalled(env)) && (await exists(win32.join(root, "My Drive")));
}

export async function windowsCloudSyncKind(path: string, home: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  for (const [dir, label] of await windowsSyncRoots(home, env)) {
    if (isUnder(path, dir)) return label;
  }
  return (await onGoogleDriveStream(path, env)) ? "Google Drive" : null;
}
