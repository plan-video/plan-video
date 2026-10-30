/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The server's checks ask which workspace lists an id, so an id no workspace lists could be taken up by another:
// these go with the deleted workspace. An id another workspace lists too stays.

import type { StoredEvent } from "@/components/calendar/types";

type Row = { id?: unknown };

export type WorkspaceParts = {
  connections: readonly unknown[];
  events: readonly StoredEvent[];
  media: readonly Row[];
  library: readonly Row[];
};

export type Leftovers = { logins: string[]; postFiles: string[]; libraryFiles: string[] };

const idOf = (row: unknown) => (row && typeof row === "object" && typeof (row as Row).id === "string" ? ((row as Row).id as string) : null);
const ids = (rows: readonly unknown[]) => rows.flatMap((row) => idOf(row) ?? []);

/** `filesOf` lists every file a post keeps (everyFileOf). */
export function leftoversOf(gone: WorkspaceParts, kept: readonly WorkspaceParts[], filesOf: (post: StoredEvent) => string[]): Leftovers {
  const postFiles = (parts: WorkspaceParts) => [...ids(parts.media), ...parts.events.flatMap((post) => (idOf(post) ? filesOf(post) : []))];
  const only = (mine: string[], others: Iterable<string>) => {
    const elsewhere = new Set(others);
    return [...new Set(mine)].filter((id) => !elsewhere.has(id));
  };
  return {
    logins: only(ids(gone.connections), kept.flatMap((parts) => ids(parts.connections))),
    postFiles: only(postFiles(gone), kept.flatMap(postFiles)),
    libraryFiles: only(ids(gone.library), kept.flatMap((parts) => ids(parts.library))),
  };
}
