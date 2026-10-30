/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A reader that catches a half-written file sees source no one wrote, so writes go to a temp file
// beside the target and are renamed over it.

import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Recognisable rather than unique, so the watcher can ignore all of them. Don't change: the watcher keys on it. */
export const TEMP_PREFIX = ".dstmp-";

export const isTempPath = (path: string): boolean => basename(path).startsWith(TEMP_PREFIX);

let sequence = 0;

/** Beside the target, not in the system temp folder: a rename is only atomic within a filesystem. */
export function tempPathFor(path: string): string {
  return join(dirname(path), `${TEMP_PREFIX}${basename(path)}.${process.pid}-${++sequence}`);
}

export async function writeFileAtomic(path: string, text: string): Promise<void> {
  const temp = tempPathFor(path);
  try {
    await writeFile(temp, text, "utf8");
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => { });
    throw error;
  }
}
