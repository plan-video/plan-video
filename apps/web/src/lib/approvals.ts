/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { allPosts, setPostApproval } from "@/components/calendar/store";
import { ONLY_APPROVERS, approvalOf, canApprove } from "@/lib/approval-state";
import { msg } from "@/lib/i18n";
import { paidToolsLocked } from "@/lib/paid-tools";
import { flushPostSync } from "@/lib/post-sync";
import { previewOf, sharePost } from "@/lib/post-previews";
import { supabase } from "@/lib/supabase";
import { activeScope, activeWorkspaceId } from "@/lib/workspaces";

export type Decision = "approved" | "changes";

const postOf = (id: string) => allPosts().find((post) => post.id === id);

/**
 * Takes the post off the schedule until it's approved, and makes its link (the preview) for whoever approves.
 * The post waits even when the link can't be made yet: asking again makes it.
 */
export async function askForApproval(postId: string, by?: string): Promise<{ previewId: string } | { error: string }> {
  const post = postOf(postId);
  if (!post) return { error: msg("This post no longer exists.") };
  if (post.status === "posted") return { error: msg("This post has already gone out.") };
  if (!previewOf(postId) && paidToolsLocked()) return { error: msg("Approval links come with a paid plan.") };
  if (approvalOf(post)?.state !== "pending") {
    const failed = setPostApproval(postId, { state: "pending", at: new Date().toISOString(), ...(by ? { by } : {}) });
    if (failed) return { error: failed };
  }
  const shared = await sharePost(postOf(postId) ?? post);
  if ("error" in shared) return shared;
  await supabase?.rpc("note_approval_request", { preview: shared.id });
  return { previewId: shared.id };
}

/** Back to a plain draft, with no approval asked for. */
export function withdrawApproval(postId: string): string | undefined {
  return setPostApproval(postId, null);
}

/** For the workspace's owner and admins. The server schedules an approved post for its time, if that's still ahead. */
export async function decide(postId: string, decision: Decision, note = ""): Promise<string | undefined> {
  if (!supabase) return msg("Sign in first.");
  if (!canApprove()) return ONLY_APPROVERS;
  const owner = activeScope()?.owner ?? (await supabase.auth.getSession()).data.session?.user.id;
  if (!owner) return msg("Sign in first.");
  const open = activeWorkspaceId();
  // The server decides on its own copy: this browser's latest changes go first.
  if (!(await flushPostSync(postId))) return msg("This post hasn't reached plan.video yet. Try again in a moment.");
  const { error } = await supabase.rpc("review_post", { owner, post: postId, decision, note: note.trim() || null });
  if (error) return error.code === "42501" ? ONLY_APPROVERS : error.message || msg("Couldn't save that. Try again.");
  if (activeWorkspaceId() === open) await flushPostSync();
}
