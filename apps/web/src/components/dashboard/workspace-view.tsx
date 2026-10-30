/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createSignal, onMount } from "solid-js";
import { toast } from "somoto";

import { allPosts, hydrateCalendar } from "@/components/calendar/store";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import { accountGroups, loadAccountGroups } from "@/lib/account-groups";
import { t } from "@/lib/i18n";
import { loadSocialConnections, socialConnections } from "@/lib/social-connections";
import { TEAM_LEVEL, leaveWorkspace, sendLegacyInvites } from "@/lib/team";
import { loadVault, vaultItems } from "@/lib/vault";
import { deleteWorkspaceEverywhere } from "@/lib/workspace-delete";
import { activeShared, activeWorkspace, shownWorkspaceName, workspaces } from "@/lib/workspaces";

import { DashboardScrollView, DashboardSurfaceCard } from "./shared";
import { TeamMembers, roleLabel } from "./team-members";
import { WorkspaceAppearance } from "./workspace-appearance";
import { WorkspaceBadge } from "./workspace-switcher";

export function DashboardWorkspaceView(props: { onOpen(view: "billing"): void }) {
  const auth = useAuth();
  const [deleting, setDeleting] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);

  createEffect(() => {
    const userId = auth.user()?.id;
    loadSocialConnections(userId);
    loadAccountGroups(userId);
    loadVault(userId);
  });
  onMount(() => void hydrateCalendar());

  const workspace = () => activeWorkspace();
  const shared = () => activeShared();
  const teamPlan = () => auth.accessLevel() >= TEAM_LEVEL;

  // Invites kept here before they went through the server go out once the plan includes a team.
  createEffect(() => {
    const userId = auth.user()?.id;
    const current = workspace();
    if (userId && !shared() && teamPlan() && current.members.length) void sendLegacyInvites(current, userId);
  });

  const confirmLeave = async () => {
    const current = shared();
    setLeaving(false);
    if (!current) return;
    const failure = await leaveWorkspace(current);
    if (failure) return toast.error(failure);
    toast.success(t("Left {name}", { name: current.name }));
  };

  const confirmDelete = async () => {
    const name = shownWorkspaceName(workspace().name);
    const userId = auth.user()?.id;
    const failure = userId ? await deleteWorkspaceEverywhere(userId, workspace().id) : t("Sign in to manage workspaces.");
    setDeleting(false);
    if (failure) return toast.error(failure);
    toast.success(t("Deleted {name}", { name }), { description: t("Switched to {name}.", { name: shownWorkspaceName(activeWorkspace().name) }) });
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <DashboardScrollView>
        <Show when={shared()}>
          {(current) => (
            <DashboardSurfaceCard>
              <div class="flex items-center gap-3">
                <WorkspaceBadge workspace={workspace()} class="size-10 rounded-xl text-base" />
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="truncate text-sm font-medium text-foreground">{shownWorkspaceName(workspace().name)}</span>
                  <span class="truncate text-xs text-muted-foreground">
                    {t("Shared by {name} · {role}", { name: current().ownerName || current().ownerEmail, role: roleLabel(current().role) })}
                  </span>
                </div>
              </div>
            </DashboardSurfaceCard>
          )}
        </Show>

        <Show when={!shared()}>
          <WorkspaceAppearance />
        </Show>

        <Show when={auth.user()?.id} keyed>
          {(userId) => (
            <Show
              when={shared()}
              fallback={
                <TeamMembers
                  scope={{ owner: userId, workspace: workspace().id }}
                  workspaceName={shownWorkspaceName(workspace().name)}
                  role="owner"
                  userId={userId}
                  teamPlan={teamPlan()}
                  onUpgrade={() => props.onOpen("billing")}
                />
              }
            >
              {(current) => <TeamMembers scope={current().scope} workspaceName={current().name} role={current().role} userId={userId} teamPlan />}
            </Show>
          )}
        </Show>

        <Show when={shared()}>
          {(current) => (
            <section class="flex flex-col gap-3">
              <h2 class="px-1 text-sm font-medium text-foreground">{t("Leave workspace")}</h2>
              <DashboardSurfaceCard class="flex items-center gap-4">
                <p class="min-w-0 flex-1 text-xs text-muted-foreground">
                  {t("You won't be able to open {workspace} or post from its accounts. {name} can invite you again.", {
                    workspace: current().name,
                    name: current().ownerName || current().ownerEmail,
                  })}
                </p>
                <Button variant="destructive" onClick={() => setLeaving(true)}>
                  {t("Leave")}
                </Button>
              </DashboardSurfaceCard>
            </section>
          )}
        </Show>

        <Show when={!shared()}>
        <section class="flex flex-col gap-3">
          <h2 class="px-1 text-sm font-medium text-foreground">{t("Delete workspace")}</h2>
          <DashboardSurfaceCard class="flex items-center gap-4">
            <p class="min-w-0 flex-1 text-xs text-muted-foreground">
              {workspaces().length > 1
                ? t("Removes {workspace} with its accounts, groups, posts, calendars and vault items. Projects are not touched.", {
                    workspace: shownWorkspaceName(workspace().name),
                  })
                : t("You need at least one workspace. Make another before deleting this one.")}
            </p>
            <Button variant="destructive" disabled={workspaces().length <= 1} onClick={() => setDeleting(true)}>
              {t("Delete")}
            </Button>
          </DashboardSurfaceCard>
        </section>
        </Show>
      </DashboardScrollView>

      <AlertDialog open={leaving()} onOpenChange={(open) => !open && setLeaving(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Leave {name}?", { name: shared()?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("Its posts and accounts stay with the workspace. What this browser kept of it is removed.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="secondary" onClick={() => setLeaving(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmLeave()}>
              {t("Leave workspace")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting()} onOpenChange={(open) => !open && setDeleting(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {name}?", { name: shownWorkspaceName(workspace().name) })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Its {accounts, plural, other {# accounts}}, {groups, plural, other {# groups}}, {posts, plural, other {# posts}} and {items, plural, other {# vault items}} are removed from this browser. This cannot be undone.",
                { accounts: socialConnections().length, groups: accountGroups().length, posts: allPosts().length, items: vaultItems().length },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              {t("Delete workspace")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
