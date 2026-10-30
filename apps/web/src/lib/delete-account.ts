/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The server does all the deleting (services/publisher/account-deletion.mjs); this browser only forgets its copies.

import { t } from "@/lib/i18n";
import { deleteAccountOnServer } from "@/lib/publishing";
import { supabase } from "@/lib/supabase";
import { WORKSPACE_DATABASES, sharedWorkspaces, workspaceDatabaseFor, workspaces } from "@/lib/workspaces";

async function forget(userId: string) {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.includes(userId)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
  // These hold what networks returned, such as YouTube's video links and numbers.
  const names = new Set<string>();
  for (const workspace of [...workspaces(), ...sharedWorkspaces()]) {
    for (const base of WORKSPACE_DATABASES) names.add(workspaceDatabaseFor(base, userId, workspace.id));
  }
  for (const { name } of (await indexedDB.databases?.().catch(() => [])) ?? []) {
    if (name?.includes(userId)) names.add(name);
  }
  for (const name of names) indexedDB.deleteDatabase(name);
}

/** Throws with the server's reason. */
export async function deleteAccountEverywhere(userId: string) {
  if (!supabase) throw new Error(t("Accounts aren't available here."));
  await deleteAccountOnServer();
  await forget(userId);
}
