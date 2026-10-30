/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The server (supabase/migrations/20261014200000_team_members.sql) checks every change
// against the person's role; this only lists and asks. owner: everything, and the only
// one who renames or deletes; admin: everything in the workspace; member: writes,
// schedules and posts, but can't connect accounts or invite.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSignal } from "solid-js";
import { toast } from "somoto";

import { APP_ORIGIN } from "@/lib/app-url";
import { msg, t } from "@/lib/i18n";
import { sendInviteEmail } from "@/lib/publishing";
import { supabase } from "@/lib/supabase";
import {
  asWorkspaceIcon,
  asWorkspaceShape,
  clearLegacyMembers,
  forgetSharedCopy,
  setSharedWorkspaces,
  sharedIdOf,
  sharedWorkspace,
  switchWorkspace,
  type SharedWorkspace,
  type TeamScope,
  type Workspace,
  type WorkspaceRole,
} from "@/lib/workspaces";

/** Pro, as user_data.access_level. */
export const TEAM_LEVEL = 3;

export type WorkspaceLook = Pick<Workspace, "name" | "color" | "icon" | "shape">;

export type TeamInvite = {
  id: string;
  scope: TeamScope;
  role: WorkspaceRole;
  invitedAt: string;
  /** False while the owner's plan doesn't include a team, or the workspace is gone. */
  open: boolean;
  look: WorkspaceLook;
  ownerName: string;
  ownerEmail: string;
  invitedBy: string | null;
};

/** `userId` is set once they've joined. */
export type TeamMember = {
  id: string;
  email: string;
  userId: string | null;
  name: string | null;
  role: WorkspaceRole;
  invitedAt: string;
  joinedAt: string | null;
};

export type TeamList = {
  /** The owner's plan doesn't include a team right now, so nobody but them gets in. */
  paused: boolean;
  owner: { id: string; email: string; name: string };
  members: TeamMember[];
};

const [invites, setInvites] = createSignal<TeamInvite[]>([]);
const [changes, setChanges] = createSignal(0);
const [shown, setShown] = createSignal<string | null>(null);

export { shown as shownInvite };

export function showInvite(id: string | null) {
  setShown(id);
}

export { invites as teamInvites };

/** Bumped on any join, leave or role change this person can see, so lists read again. */
export { changes as teamChanges };

/** The sentences the server refuses with, so each can be shown translated. */
const SERVER_WORDS = new Set<string>([
  msg("Only the workspace's owner and admins can invite people."),
  msg("Only the workspace's owner and admins can change roles."),
  msg("Only the workspace's owner and admins can remove people."),
  msg("Team members come with Pro and Agency."),
  msg("This workspace is gone."),
  msg("Pick Admin or Member."),
  msg("Enter an email address."),
  msg("That's the workspace's owner."),
  msg("That's a lot of invites for one day. Try again tomorrow."),
  msg("That person is already invited."),
  msg("That person isn't in the workspace anymore."),
  msg("You're not in this workspace."),
  msg("This invite isn't open anymore."),
  msg("This is your own workspace."),
  msg("This workspace's plan doesn't include team members right now."),
]);

function reason(error: { message?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  return SERVER_WORDS.has(message) ? t(message) : fallback;
}

const asRole = (value: unknown): WorkspaceRole => (value === "admin" ? "admin" : "member");

/** A workspace still wearing a name the app gave it is called after its owner. */
function asLook(value: unknown, owner: string): WorkspaceLook | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.name !== "string" || !row.name) return null;
  const icon = asWorkspaceIcon(row.icon);
  const shape = asWorkspaceShape(row.shape);
  const unnamed = row.name === "My workspace" || row.name === "Personal";
  const first = owner.trim().split(/\s+/)[0] ?? "";
  return {
    name: unnamed && first ? t("{name}'s workspace", { name: first }) : row.name,
    color: typeof row.color === "string" && row.color ? row.color : "sky",
    ...(icon ? { icon } : {}),
    ...(shape ? { shape } : {}),
  };
}

let person: string | undefined;
let channel: RealtimeChannel | null = null;
const mine = new Set<string>();
const watched = new Map<symbol, ReadonlySet<string>>();

export function watchTeamRows(ids: readonly string[]) {
  const key = Symbol("rows");
  watched.set(key, new Set(ids));
  return () => watched.delete(key);
}

const concerns = (id: string) => mine.has(id) || [...watched.values()].some((ids) => ids.has(id));
let refreshing: Promise<void> | null = null;
let refreshAgain = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let lastRefresh = 0;
let known: ReadonlySet<string> | null = null;

/** Does nothing when already following this person. */
export function beginTeam(userId: string | undefined) {
  if (person === userId) return;
  person = userId;
  known = null;
  mine.clear();
  setInvites([]);
  clearTimeout(refreshTimer);
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  if (!userId || !supabase) return;
  void refreshTeam();
  // A deleted row reaches every listener with only its id, so it counts only when it's one of theirs.
  channel = supabase
    .channel(`team-${userId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_members" }, () => scheduleRefresh())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "workspace_members" }, () => scheduleRefresh())
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "workspace_members" }, (payload) => {
      const id = (payload.old as { id?: unknown } | undefined)?.id;
      if (typeof id === "string" && concerns(id)) scheduleRefresh();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED" && Date.now() - lastRefresh > 5_000) scheduleRefresh();
    });
}

function scheduleRefresh(delay = 400) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshTeam(), delay);
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    if (person && Date.now() - lastRefresh > 30_000) scheduleRefresh(0);
  });
}

/** Several calls in a row read it once. */
export function refreshTeamSoon() {
  if (person) scheduleRefresh(1_500);
}

export function refreshTeam(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return refreshing;
  }
  refreshing = (async () => {
    try {
      do {
        refreshAgain = false;
        await readTeam();
      } while (refreshAgain);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Listed = {
  workspaces: {
    id: string;
    owner: string;
    workspace: string;
    role: string;
    joinedAt: string | null;
    state: "active" | "paused" | "gone";
    look: unknown;
    ownerName: string | null;
    ownerEmail: string | null;
  }[];
  invites: {
    id: string;
    owner: string;
    workspace: string;
    role: string;
    invitedAt: string;
    open: boolean;
    look: unknown;
    ownerName: string | null;
    ownerEmail: string | null;
    invitedBy: string | null;
  }[];
};

async function readTeam() {
  const userId = person;
  if (!userId || !supabase) return;
  lastRefresh = Date.now();
  const { data, error } = await supabase.rpc("my_team");
  if (userId !== person) return;
  if (error) {
    // Offline, or a page left mid-read: it's read again later.
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) console.warn("[team] Could not read your teams", error.message);
    else if (!/my_team/.test(error.message)) console.error("[team] Could not read your teams", error);
    return;
  }
  const listed = (data ?? { workspaces: [], invites: [] }) as Listed;
  const rows: SharedWorkspace[] = [];
  for (const row of listed.workspaces ?? []) {
    const look = asLook(row.look, row.ownerName || row.ownerEmail?.split("@")[0] || "");
    if (row.state === "gone" || !look) continue;
    const scope = { owner: row.owner, workspace: row.workspace };
    rows.push({
      ...look,
      id: sharedIdOf(scope),
      createdAt: row.joinedAt ?? new Date(0).toISOString(),
      members: [],
      scope,
      membership: row.id,
      role: asRole(row.role),
      ownerName: row.ownerName ?? "",
      ownerEmail: row.ownerEmail ?? "",
      state: row.state === "paused" ? "paused" : "active",
    });
  }
  const before = known;
  const gone = setSharedWorkspaces(userId, rows);
  mine.clear();
  for (const row of rows) mine.add(row.membership);
  for (const row of listed.invites ?? []) mine.add(row.id);
  known = new Set(rows.map((row) => row.id));
  for (const row of gone) {
    forgetSharedCopy(userId, row.id);
    if (before?.has(row.id)) toast(t("You're no longer in {workspace}", { workspace: row.name }));
  }
  const waiting: TeamInvite[] = (listed.invites ?? []).flatMap((row) => {
    const look = asLook(row.look, row.ownerName || row.ownerEmail?.split("@")[0] || "");
    if (!look) return [];
    return [
      {
        id: row.id,
        scope: { owner: row.owner, workspace: row.workspace },
        role: asRole(row.role),
        invitedAt: row.invitedAt,
        open: row.open === true,
        look,
        ownerName: row.ownerName ?? "",
        ownerEmail: row.ownerEmail ?? "",
        invitedBy: row.invitedBy,
      },
    ];
  });
  setInvites(waiting);
  announce(userId, waiting);
  setChanges((count) => count + 1);
}

function announce(userId: string, waiting: readonly TeamInvite[]) {
  const key = `plan.video.invites-told.${userId}`;
  let told: string[] = [];
  try {
    told = JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[];
  } catch {
    told = [];
  }
  const fresh = waiting.filter((invite) => !told.includes(invite.id));
  if (!fresh.length) return;
  try {
    sessionStorage.setItem(key, JSON.stringify([...told, ...fresh.map((invite) => invite.id)]));
  } catch {
    // Said again next time the list is read.
  }
  for (const invite of fresh) {
    toast(t("{name} invited you to {workspace}", { name: invite.invitedBy || invite.ownerName || invite.ownerEmail, workspace: invite.look.name }), {
      action: { label: t("View invite"), onClick: () => showInvite(invite.id) },
    });
  }
}

export async function acceptInvite(invite: TeamInvite): Promise<string | undefined> {
  if (!supabase) return t("Sign in first.");
  const { error } = await supabase.rpc("accept_workspace_invite", { invite: invite.id });
  if (error) {
    void refreshTeam();
    return reason(error, t("Couldn't join {workspace}. Try again.", { workspace: invite.look.name }));
  }
  await refreshTeam();
  switchWorkspace(sharedIdOf(invite.scope));
}

export async function declineInvite(invite: TeamInvite): Promise<string | undefined> {
  if (!supabase) return t("Sign in first.");
  const { error } = await supabase.rpc("remove_workspace_member", { member: invite.id });
  if (error) return reason(error, t("Couldn't turn the invite down. Try again."));
  setInvites((current) => current.filter((row) => row.id !== invite.id));
  void refreshTeam();
}

export async function leaveWorkspace(workspace: SharedWorkspace): Promise<string | undefined> {
  if (!supabase) return t("Sign in first.");
  const { error } = await supabase.rpc("remove_workspace_member", { member: workspace.membership });
  if (error) return reason(error, t("Couldn't leave {workspace}. Try again.", { workspace: workspace.name }));
  // Dropped from `known` so leaving isn't announced as being taken out.
  known = new Set([...(known ?? [])].filter((id) => id !== workspace.id));
  await refreshTeam();
}

export async function loadTeamList(scope: TeamScope): Promise<TeamList> {
  if (!supabase) throw new Error(t("Sign in first."));
  const { data, error } = await supabase.rpc("workspace_team", { owner: scope.owner, workspace: scope.workspace });
  if (error || !data) throw new Error(reason(error, t("Couldn't load who's in this workspace. Try again.")));
  const list = data as { paused: boolean; owner: { id: string; email: string; name: string | null }; members: Record<string, unknown>[] };
  return {
    paused: list.paused === true,
    owner: { id: list.owner.id, email: list.owner.email, name: list.owner.name || list.owner.email },
    members: (list.members ?? []).map((row) => ({
      id: String(row.id),
      email: String(row.email),
      userId: typeof row.userId === "string" ? row.userId : null,
      name: typeof row.name === "string" && row.name ? row.name : null,
      role: asRole(row.role),
      invitedAt: String(row.invitedAt),
      joinedAt: typeof row.joinedAt === "string" ? row.joinedAt : null,
    })),
  };
}

/** Doesn't email; `emailInvite` does. */
export async function inviteToWorkspace(scope: TeamScope, email: string, role: WorkspaceRole): Promise<{ id: string } | { error: string }> {
  if (!supabase) return { error: t("Sign in first.") };
  const { data, error } = await supabase.rpc("invite_workspace_member", { owner: scope.owner, workspace: scope.workspace, address: email, role });
  if (error || !data) return { error: reason(error, t("Couldn't send the invite. Try again.")) };
  setChanges((count) => count + 1);
  return { id: String((data as { id: string }).id) };
}

/** Only for an address with no account: one with an account finds the invite in the app. */
export function emailInvite(id: string): Promise<boolean> {
  return sendInviteEmail(id).catch(() => false);
}

export async function changeMemberRole(id: string, role: WorkspaceRole): Promise<string | undefined> {
  if (!supabase) return t("Sign in first.");
  const { error } = await supabase.rpc("set_workspace_member_role", { member: id, role });
  if (error) return reason(error, t("Couldn't change the role. Try again."));
  setChanges((count) => count + 1);
}

export async function removeTeamMember(id: string): Promise<string | undefined> {
  if (!supabase) return t("Sign in first.");
  const { error } = await supabase.rpc("remove_workspace_member", { member: id });
  if (error) return reason(error, t("Couldn't remove them. Try again."));
  setChanges((count) => count + 1);
}

/** It only works for the address invited. */
export function inviteLink(id: string): string {
  const origin = window.desktop ? APP_ORIGIN : window.location.origin;
  return `${origin}/dashboard?invite=${encodeURIComponent(id)}`;
}

/** Old invites stored on the workspace itself; sent for real once the plan includes a team. */
export async function sendLegacyInvites(workspace: Workspace, ownerId: string) {
  if (!workspace.members.length || sharedWorkspace(workspace.id)) return;
  const scope = { owner: ownerId, workspace: workspace.id };
  for (const member of workspace.members) {
    const result = await inviteToWorkspace(scope, member.email, member.role);
    if ("error" in result && result.error !== t("That person is already invited.")) return;
    if ("id" in result) void emailInvite(result.id);
  }
  clearLegacyMembers(workspace.id);
}
