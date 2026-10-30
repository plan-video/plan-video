/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pages follow the last row's (updated_at, id), not an offset: a post changed
// mid-read moves to the end and is read again, so no row is skipped.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PostRow } from "@/lib/post-sync-core";

export const POST_COLUMNS = "id,version,data,deleted_at,updated_at,thumbnail_at";
/** Rows asked for at a time, under PostgREST's cap of 1000. */
const PAGE = 1000;

export async function readPostRows(db: SupabaseClient, owner: string, workspace: string, since: string | null, page = PAGE): Promise<PostRow[]> {
  const rows: PostRow[] = [];
  let after: { at: string; id: string } | null = null;
  for (;;) {
    let query = db.from("posts").select(POST_COLUMNS).match({ owner_id: owner, workspace_id: workspace });
    // Quoted: a time has colons, and a plus before its zone.
    if (after) query = query.or(`updated_at.gt."${after.at}",and(updated_at.eq."${after.at}",id.gt."${after.id}")`);
    else if (since) query = query.gte("updated_at", since);
    const { data, error } = await query.order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(page);
    if (error) throw Object.assign(new Error(error.message || "The server didn't answer."), { code: error.code });
    const found = (data ?? []) as unknown as PostRow[];
    rows.push(...found);
    if (found.length < page) return rows;
    const last = found[found.length - 1]!;
    after = { at: last.updated_at, id: last.id };
  }
}
