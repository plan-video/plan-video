/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A post's approval and who may give it. The database enforces the same rules
// (supabase/migrations/20261126120000_post_approvals.sql): only the owner,
// admins and whoever has the post's link decide, and a post waiting for
// approval is a draft the publisher never sends.

import { createSignal } from "solid-js";

import { msg } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { activeScope, activeShared, activeWorkspaceId, type TeamScope } from "@/lib/workspaces";

export type ApprovalState = "pending" | "changes" | "approved";

export type Approval = {
  state: ApprovalState;
  at: string;
  /** Who asked, or who decided. */
  by?: string;
  /** Decided through the post's link, or in the dashboard. */
  via?: "link" | "team";
  /** What to change, with `changes`. */
  note?: string;
};

export const APPROVAL_LABELS: Record<ApprovalState, string> = {
  pending: msg("Needs approval"),
  changes: msg("Changes requested"),
  approved: msg("Approved"),
};

/** Word for word in services/publisher/worker.mjs and the migration, so they show translated. */
export const AWAITING_APPROVAL = msg("This post is waiting for approval. Once it's approved it goes out at its time.");
export const MEMBERS_NEED_APPROVAL = msg("Posts in this workspace need approval before they go out. Ask for approval instead.");
export const ONLY_APPROVERS = msg("Only the workspace's owner and admins can approve posts.");
/** What the publisher and the database say back, so they show translated. */
export const SERVER_WORDS = [
  msg("The post was sent for approval before it went out."),
  msg("This post isn't waiting for approval."),
  msg("This post was deleted."),
  msg("Add your name."),
];

export { approvalOf, awaitingApproval, isApproval } from "@/lib/post-rules";

/** The person's role in the open workspace. Their own workspaces are theirs. */
export const workspaceRole = (): "owner" | "admin" | "member" => activeShared()?.role ?? "owner";

export const canApprove = () => workspaceRole() !== "member";

const [rules, setRules] = createSignal<{ key: string; membersNeedApproval: boolean } | null>(null);

function subject(userId: string | undefined) {
  const team = activeScope();
  if (team) return team;
  return userId ? { owner: userId, workspace: activeWorkspaceId() } : null;
}

const keyOf = (scope: { owner: string; workspace: string }) => `${scope.owner}|${scope.workspace}`;

/** Whether the open workspace has its members' posts approved. False until read. */
export function membersNeedApproval(userId: string | undefined): boolean {
  const scope = subject(userId);
  const known = rules();
  return !!scope && known?.key === keyOf(scope) && known.membersNeedApproval;
}

/** This person's posts here wait for approval before they're scheduled. */
export const mustAskForApproval = (userId: string | undefined) => workspaceRole() === "member" && membersNeedApproval(userId);

let reading: string | null = null;

/** Null when it can't be read. */
export async function readWorkspaceRules(scope: TeamScope): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("workspace_rules")
    .select("members_need_approval")
    .match({ owner_id: scope.owner, workspace_id: scope.workspace })
    .maybeSingle();
  return error ? null : !!(data as { members_need_approval?: boolean } | null)?.members_need_approval;
}

/** Quiet when the table isn't there yet. */
export async function loadWorkspaceRules(userId: string | undefined): Promise<void> {
  const scope = subject(userId);
  if (!scope) return;
  const key = keyOf(scope);
  reading = key;
  const found = await readWorkspaceRules(scope);
  if (found === null || reading !== key) return;
  setRules({ key, membersNeedApproval: found });
}

export async function setMembersNeedApproval(scope: TeamScope, on: boolean): Promise<string | undefined> {
  if (!supabase) return msg("Sign in first.");
  const { error } = await supabase.rpc("set_workspace_rules", { owner: scope.owner, workspace: scope.workspace, need_approval: on });
  if (error) return error.code === "42501" ? msg("Only the workspace's owner and admins can change this.") : msg("Couldn't save that. Try again.");
  setRules({ key: keyOf(scope), membersNeedApproval: on });
}
