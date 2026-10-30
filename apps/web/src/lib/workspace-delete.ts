/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Also deletes the server's logins, files and shared previews (see workspace-leftovers.ts for why these can't stay).

import { everyFileOf, readCalendarSnapshot } from "@/components/calendar/store";
import { flushAccountSync, readSlice } from "@/lib/account-sync";
import { deleteFromCloud, queueCloud } from "@/lib/cloud-storage";
import { inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { posterId } from "@/lib/media-library";
import { forgetLogin } from "@/lib/publishing";
import { supabase } from "@/lib/supabase";
import { flushAllPosts } from "@/lib/post-sync";
import { leftoversOf, type WorkspaceParts } from "@/lib/workspace-leftovers";
import { deleteWorkspace, workspaces } from "@/lib/workspaces";

/** Returns why it couldn't, for the user. */
export async function deleteWorkspaceEverywhere(userId: string, id: string): Promise<string | undefined> {
  // The demo has nothing on the server.
  if (inGuestMode()) return deleteWorkspace(id);
  // Flushed first, so what each workspace has matches the account: an id the other workspaces list stays.
  if (!(await flushAccountSync()) || !(await flushAllPosts())) return t("Couldn't reach the server. Try again in a moment.");
  let parts: { gone: WorkspaceParts; kept: WorkspaceParts[] } | null = null;
  try {
    const others = workspaces().filter((row) => row.id !== id);
    parts = { gone: await partsOf(userId, id), kept: await Promise.all(others.map((row) => partsOf(userId, row.id))) };
  } catch (error) {
    console.error("[workspaces] Could not read the workspaces, so the deleted one's logins and files stay", error);
  }
  const failure = await deleteWorkspace(id);
  if (failure || !parts) return failure;

  const { logins, postFiles, libraryFiles } = leftoversOf(parts.gone, parts.kept, everyFileOf);
  for (const connectionId of logins) {
    void forgetLogin(connectionId, null).catch((error) => console.error("[workspaces] Could not drop a deleted workspace's login", error));
  }
  if (postFiles.length) queueCloud(`posts-delete:${postFiles.join(",")}`, () => deleteFromCloud("posts", postFiles, null));
  if (libraryFiles.length) {
    const files = libraryFiles.flatMap((file) => [file, posterId(file)]);
    queueCloud(`media-delete:${libraryFiles.join(",")}`, () => deleteFromCloud("media", files, null));
  }
  // forget_workspace_team does the same on the server.
  void supabase
    ?.from("post_previews")
    .delete()
    .eq("owner_id", userId)
    .eq("snapshot->>workspaceId", id)
    .then(({ error }) => {
      if (error) console.error("[workspaces] Could not stop sharing the deleted workspace's posts", error);
    });
}

async function partsOf(userId: string, id: string): Promise<WorkspaceParts> {
  const [slice, posts] = await Promise.all([readSlice(userId, id), readCalendarSnapshot(userId, id)]);
  if (!posts) throw new Error("Could not read posts");
  return { connections: slice.connections, library: slice.library, events: posts.events, media: posts.media };
}
