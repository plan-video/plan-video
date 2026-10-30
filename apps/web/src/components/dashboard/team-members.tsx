/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Who is in a workspace: its owner, the people who joined, and the invites
// still waiting. Its owner and admins invite people, change their roles and
// take them out; everyone else in it sees the list.

import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { fieldControl } from "@/components/calendar/popup";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { msg, t } from "@/lib/i18n";
import { changeMemberRole, emailInvite, inviteLink, inviteToWorkspace, loadTeamList, removeTeamMember, teamChanges, watchTeamRows, type TeamMember } from "@/lib/team";
import { zonedFormat } from "@/lib/time-zone";
import type { TeamScope, WorkspaceRole } from "@/lib/workspaces";

import { DashboardSurfaceCard } from "./shared";

const DATE_FORMAT = zonedFormat({ day: "numeric", month: "long", year: "numeric" });

export const ROLES: { id: WorkspaceRole; label: string; detail: string }[] = [
  { id: "member", label: msg("Member"), detail: msg("Writes, schedules and posts. Can't connect accounts or invite people.") },
  { id: "admin", label: msg("Admin"), detail: msg("Everything in the workspace, including its accounts and who's in it.") },
];

export const roleLabel = (role: WorkspaceRole | "owner") => (role === "owner" ? t("Owner") : t(ROLES.find((item) => item.id === role)!.label));

/** The first letter of a name or address, for a person with no picture. */
const initial = (text: string) => [...text.trim()][0]?.toUpperCase() ?? "?";

/** A role to pick, in the dashboard's own menu: a field in the invite form, quiet text in a member's row. */
function RolePicker(props: { value: WorkspaceRole; label: string; quiet?: boolean; onChange(role: WorkspaceRole): void }) {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        aria-label={props.label}
        class={
          props.quiet
            ? "flex h-6 shrink-0 items-center gap-0.5 rounded-md pr-0.5 pl-1.5 text-xs text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring data-[expanded]:bg-accent data-[expanded]:text-foreground"
            : "flex h-7 w-24 shrink-0 items-center justify-between gap-1 rounded-md border border-(--border-input) bg-input pr-1 pl-2 text-xs text-foreground transition-colors hover:bg-accent focus-ring data-[expanded]:border-primary"
        }
      >
        <span class="cap-centered">{roleLabel(props.value)}</span>
        <Icon name="chevron-down" class="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-36 gap-px p-1">
          <For each={ROLES}>
            {(option) => (
              <DropdownMenuItem tone="neutral" class="justify-between" onSelect={() => props.onChange(option.id)}>
                {t(option.label)}
                <Show when={props.value === option.id}>
                  <Icon name="confirm-check" class="size-4 text-primary" />
                </Show>
              </DropdownMenuItem>
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

export function TeamMembers(props: {
  scope: TeamScope;
  workspaceName: string;
  /** The signed-in person's role here. */
  role: WorkspaceRole | "owner";
  /** Their own id, so their row is marked and they can't remove themselves from here. */
  userId: string;
  /** False while the owner's plan doesn't include a team: nobody new can be asked in. */
  teamPlan: boolean;
  onUpgrade?(): void;
}) {
  const canManage = () => props.role === "owner" || props.role === "admin";
  const [list, { refetch }] = createResource(
    () => ({ owner: props.scope.owner, workspace: props.scope.workspace, version: teamChanges() }),
    ({ owner, workspace }) => loadTeamList({ owner, workspace }),
  );
  // Hears when someone on the list leaves or is taken out elsewhere.
  createEffect(() => {
    const ids = list.latest?.members.map((member) => member.id) ?? [];
    onCleanup(watchTeamRows(ids));
  });
  const [email, setEmail] = createSignal("");
  const [role, setRole] = createSignal<WorkspaceRole>("member");
  const [sending, setSending] = createSignal(false);
  const [removing, setRemoving] = createSignal<TeamMember | null>(null);

  const invite = async (event: SubmitEvent) => {
    event.preventDefault();
    const address = email().trim();
    if (!address || sending()) return;
    setSending(true);
    let result: Awaited<ReturnType<typeof inviteToWorkspace>>;
    try {
      result = await inviteToWorkspace(props.scope, address, role());
    } finally {
      setSending(false);
    }
    if ("error" in result) return void toast.error(result.error);
    // Unless the next address is already being typed.
    if (email().trim() === address) setEmail("");
    void refetch();
    const emailed = await emailInvite(result.id);
    toast.success(t("Invited {email}", { email: address.toLowerCase() }), {
      description: emailed
        ? t("They'll get an email with a link to join {workspace}.", { workspace: props.workspaceName })
        : t("They'll find the invite when they open plan.video with this email. You can send them the link too."),
      action: { label: t("Copy link"), onClick: () => void copyLink(result.id) },
    });
  };

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(id));
      toast.success(t("Invite link copied"), { description: t("It only works for the email it was sent to.") });
    } catch {
      toast.error(t("Couldn't copy the link"));
    }
  };

  const setMemberRole = async (member: TeamMember, next: WorkspaceRole) => {
    if (next === member.role) return;
    const failure = await changeMemberRole(member.id, next);
    if (failure) {
      toast.error(failure);
      void refetch();
    }
  };

  const remove = async (member: TeamMember) => {
    const failure = await removeTeamMember(member.id);
    setRemoving(null);
    if (failure) return void toast.error(failure);
    toast.success(member.joinedAt ? t("Removed {name}", { name: member.name ?? member.email }) : t("Invite to {email} taken back", { email: member.email }));
  };

  const shownRole = () => ROLES.find((item) => item.id === role())!;

  return (
    <section class="flex flex-col gap-3">
      <h2 class="px-1 text-sm font-medium text-foreground">{t("Members")}</h2>
      <DashboardSurfaceCard class="flex flex-col gap-1 p-2">
        {/* `latest`, so reading the list again doesn't suspend the page. */}
        <Show
          when={list.latest}
          fallback={
            <div class="flex h-10 items-center px-2 text-xs text-muted-foreground">
              {list.error ? (list.error as Error).message : t("Loading…")}
            </div>
          }
        >
          {(team) => (
            <>
              <Show when={team().paused}>
                <p class="px-2 pt-1 pb-2 text-xs text-muted-foreground">
                  {props.role === "owner"
                    ? t("Your plan doesn't include team members now, so only you can open {workspace}. They're back in once you're on Pro or Agency.", { workspace: props.workspaceName })
                    : t("{workspace}'s plan doesn't include team members right now.", { workspace: props.workspaceName })}
                </p>
              </Show>
              <PersonRow name={team().owner.name} email={team().owner.email} you={team().owner.id === props.userId}>
                <span class="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{t("Owner")}</span>
              </PersonRow>
              <For each={team().members}>
                {(member) => {
                  const you = () => member.userId === props.userId;
                  const pending = () => !member.joinedAt;
                  return (
                    <PersonRow
                      name={member.name ?? member.email}
                      email={pending() ? t("Invited {date}", { date: DATE_FORMAT.format(new Date(member.invitedAt)) }) : member.email}
                      you={you()}
                      pending={pending()}
                    >
                      <Show
                        when={canManage() && !you()}
                        fallback={<span class="px-1 text-xs text-muted-foreground">{roleLabel(member.role)}</span>}
                      >
                        <RolePicker
                          quiet
                          label={t("Role for {email}", { email: member.email })}
                          value={member.role}
                          onChange={(next) => void setMemberRole(member, next)}
                        />
                      </Show>
                      <Show when={pending()}>
                        <span class="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">{t("Pending")}</span>
                      </Show>
                      <Show when={canManage() && pending()}>
                        <Button
                          variant="ghost"
                          size="icon-square"
                          aria-label={t("Copy the invite link for {email}", { email: member.email })}
                          title={t("Copy invite link")}
                          class="text-muted-foreground hover:text-foreground"
                          onClick={() => void copyLink(member.id)}
                        >
                          <Icon name="link" class="size-5" />
                        </Button>
                      </Show>
                      <Show when={canManage() && !you()}>
                        <Button
                          variant="ghost"
                          size="icon-square"
                          aria-label={pending() ? t("Take back the invite to {email}", { email: member.email }) : t("Remove {email}", { email: member.email })}
                          class="text-muted-foreground hover:text-foreground"
                          onClick={() => (pending() ? void remove(member) : setRemoving(member))}
                        >
                          <Icon name="close-remove-small" class="size-6" />
                        </Button>
                      </Show>
                    </PersonRow>
                  );
                }}
              </For>
            </>
          )}
        </Show>
        <Show when={canManage()}>
          <Show
            when={props.teamPlan}
            fallback={
              <div class="mt-1 flex items-center gap-3 border-t border-border px-2 pt-2.5 pb-1">
                <p class="min-w-0 flex-1 text-xs text-muted-foreground">{t("Team members come with Pro and Agency, as many as you like.")}</p>
                <Show when={props.onUpgrade}>
                  <Button class="shrink-0" onClick={() => props.onUpgrade?.()}>
                    {t("See plans")}
                  </Button>
                </Show>
              </div>
            }
          >
            <form class="mt-1 flex flex-col gap-1.5 border-t border-border px-1 pt-2.5 pb-1" onSubmit={(event) => void invite(event)}>
              <div class="flex items-center gap-1.5">
                <input
                  type="email"
                  aria-label={t("Email to invite")}
                  class={fieldControl}
                  placeholder="name@company.com"
                  value={email()}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                />
                <RolePicker label={t("Role")} value={role()} onChange={setRole} />
                <Button type="submit" class="shrink-0 px-3" disabled={!email().trim() || sending()}>
                  {t("Invite")}
                </Button>
              </div>
              <p class="px-1 text-xs text-muted-foreground">{t(shownRole().detail)}</p>
            </form>
          </Show>
        </Show>
      </DashboardSurfaceCard>

      <AlertDialog open={!!removing()} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove {name} from {workspace}?", { name: removing()?.name ?? removing()?.email ?? "", workspace: props.workspaceName })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("They can't open {workspace} or post from its accounts anymore. The posts they made stay.", { workspace: props.workspaceName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" onClick={() => removing() && void remove(removing()!)}>
              {t("Remove")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function PersonRow(props: { name: string; email: string; you?: boolean; pending?: boolean; children?: unknown }) {
  return (
    <div class="flex h-10 items-center gap-2.5 rounded-md px-2">
      <Show
        when={!props.pending}
        fallback={
          <span class="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-(--border-input) text-muted-foreground">
            <Icon name="email" class="size-5" />
          </span>
        }
      >
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs text-foreground">{initial(props.name)}</span>
      </Show>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-xs text-foreground">
          {props.name}
          <Show when={props.you}>
            <span class="text-muted-foreground"> · {t("you")}</span>
          </Show>
        </span>
        <span class="truncate text-xs text-muted-foreground">{props.email}</span>
      </div>
      {props.children as never}
    </div>
  );
}
