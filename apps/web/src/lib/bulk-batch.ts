/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The files of a batch in Bulk tools, kept on this device until it's scheduled or cleared, so a refresh doesn't lose them.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const BULK_DATABASE = "plan-video-bulk";

export type BatchFile = { id: string; file: File; poster: string };

interface BulkDB extends DBSchema {
  files: { key: string; value: BatchFile };
}

const open = new Map<string, Promise<IDBPDatabase<BulkDB>>>();

function database(name: string) {
  let opening = open.get(name);
  if (!opening) {
    opening = openDB<BulkDB>(name, 1, {
      upgrade(db) {
        db.createObjectStore("files", { keyPath: "id" });
      },
      // Deleting the workspace waits on this connection.
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
        open.delete(name);
      },
    });
    open.set(name, opening);
  }
  return opening;
}

export async function readBatchFiles(name: string): Promise<Map<string, BatchFile>> {
  const files = await (await database(name)).getAll("files");
  return new Map(files.map((file) => [file.id, file]));
}

export async function writeBatchFile(name: string, file: BatchFile): Promise<void> {
  await (await database(name)).put("files", file);
}

export async function dropBatchFiles(name: string, ids: readonly string[]): Promise<void> {
  const transaction = (await database(name)).transaction("files", "readwrite");
  await Promise.all([...ids.map((id) => transaction.store.delete(id)), transaction.done]);
}

export async function clearBatchFiles(name: string): Promise<void> {
  await (await database(name)).clear("files");
}
