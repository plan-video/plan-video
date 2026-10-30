/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Account groups, as the Connections page lists and edits them.

import { For, Show, createEffect, createSignal } from "solid-js";
import { toast } from "somoto";

import { fieldControl, fieldLabel } from "@/components/calendar/popup";
import { CheckMark, PlatformLogo } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { useAuth } from "@/context/auth";
import {
  accountGroups,
  createAccountGroup,
  deleteAccountGroup,
  groupAccounts,
  loadAccountGroups,
  restoreAccountGroup,
  updateAccountGroup,
  type AccountGroup,
} from "@/lib/account-groups";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { SOCIAL_PLATFORMS, socialPlatform, type PlatformId } from "@/lib/social";
import { accountLabel, connectionsFor, socialConnections } from "@/lib/social-connections";

import { DashboardGroupLabel } from "./page-header";
import { DashboardSurfaceCard } from "./shared";

/** Deletes a group, with Undo on the toast that says so. */
export function deleteGroupWithUndo(userId: string, group: AccountGroup) {
  const index = accountGroups().findIndex((row) => row.id === group.id);
  deleteAccountGroup(userId, group.id);
  toast(t("Deleted {name}", { name: group.name }), {
    action: { label: t("Undo"), onClick: () => restoreAccountGroup(userId, group, index) },
  });
}

export function AccountGroupsSection() {
  const auth = useAuth();
  const [editing, setEditing] = createSignal<AccountGroup | "new" | null>(null);

  createEffect(() => loadAccountGroups(auth.user()?.id));

  const remove = (group: AccountGroup) => {
    const userId = auth.ownerId();
    if (userId) deleteGroupWithUndo(userId, group);
  };

  return (
    <section class="flex flex-col gap-3">
      <div class="flex items-end gap-3 px-1">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <DashboardGroupLabel>{t("Account groups")}</DashboardGroupLabel>
          <p class="text-xs text-muted-foreground">
            {t("A saved set of accounts, like three TikToks and two Instagrams. Pick it on New post to post from all of them at once.")}
          </p>
        </div>
        <Button variant="secondary" disabled={socialConnections().length === 0} onClick={() => setEditing("new")}>
          {t("New group")}
        </Button>
      </div>

      <Show
        when={accountGroups().length > 0}
        fallback={
          <DashboardSurfaceCard class="py-6 text-center">
            <p class="text-xs text-muted-foreground">
              {socialConnections().length === 0
                ? t("Connect an account above to start a group.")
                : t("No groups yet. Make one per brand or client, like Acme on TikTok, Instagram and YouTube.")}
            </p>
          </DashboardSurfaceCard>
        }
      >
        <div class="grid gap-2 sm:grid-cols-2">
          <For each={accountGroups()}>
            {(group) => {
              const accounts = () => groupAccounts(group);
              return (
                <DashboardSurfaceCard class="group/card flex flex-col gap-3 p-3">
                  <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{group.name}</span>
                    <span class="text-xs tabular-nums text-muted-foreground">
                      {t("{count, plural, one {# account} other {# accounts}}", { count: accounts().length })}
                    </span>
                    <DropdownMenu placement="bottom-end">
                      <DropdownMenuTrigger
                        as="button"
                        type="button"
                        aria-label={t("{name} options", { name: group.name })}
                        class="grid size-6 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring data-[expanded]:bg-accent"
                      >
                        <Icon name="more-three-dots-small-horizontal" class="size-6" />
                      </DropdownMenuTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuContent class="w-36">
                          <DropdownMenuItem onSelect={() => setEditing(group)}>
                            <span class="min-w-0 flex-1 truncate">{t("Edit")}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => remove(group)}>
                            <span class="min-w-0 flex-1 truncate">{t("Delete")}</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenuPortal>
                    </DropdownMenu>
                  </div>
                  <Show
                    when={accounts().length > 0}
                    fallback={<p class="text-xs text-muted-foreground">{t("Its accounts were removed. Edit it to pick new ones.")}</p>}
                  >
                    <ul class="flex flex-wrap gap-1">
                      <For each={accounts()}>
                        {(account) => (
                          <li class="flex h-6 max-w-full items-center gap-1.5 rounded-md bg-background/60 pl-1 pr-2">
                            <PlatformLogo id={account.platform as PlatformId} class="size-4 rounded-sm" />
                            <span class="truncate text-xs text-foreground">{accountLabel(account)}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </DashboardSurfaceCard>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={editing()} keyed>
        {(current) => <GroupFormDialog group={current === "new" ? null : current} onClose={() => setEditing(null)} />}
      </Show>
    </section>
  );
}

/** Makes a group, or edits one. A new one can start from accounts already picked, as New post's are. */
export function GroupFormDialog(props: { group: AccountGroup | null; accounts?: readonly string[]; onClose(): void }) {
  const auth = useAuth();
  const [name, setName] = createSignal(props.group?.name ?? "");
  const [picked, setPicked] = createSignal<string[]>(props.group ? groupAccounts(props.group).map((account) => account.id) : [...(props.accounts ?? [])]);
  const [error, setError] = createSignal<string | null>(null);

  const platforms = () => SOCIAL_PLATFORMS.filter((platform) => connectionsFor(platform.id).length > 0);

  const toggle = (accountId: string) => {
    setError(null);
    setPicked((current) => (current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]));
  };
  const allOn = (platform: string) => connectionsFor(platform).every((account) => picked().includes(account.id));
  const toggleAll = (platform: string) => {
    setError(null);
    const ids = connectionsFor(platform).map((account) => account.id);
    setPicked((current) => (allOn(platform) ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]));
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    // The owner, so a guest can try groups in the demo too.
    const userId = auth.ownerId();
    if (!userId) return;
    const draft = { name: name(), accounts: picked() };
    const failure = props.group ? updateAccountGroup(userId, props.group.id, draft) : createAccountGroup(userId, draft);
    if (failure) return setError(failure);
    toast.success(props.group ? t("Group updated") : t("Created {name}", { name: name().trim() }));
    props.onClose();
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent showCloseButton={false} class="w-96 max-w-11/12 gap-0 overflow-hidden rounded-xl border-border-strong bg-popover p-0">
          <form onSubmit={submit} class="flex max-h-[80vh] flex-col">
            <div class="flex items-center justify-between border-b border-border-strong py-2 pl-4 pr-2">
              <p class="text-xs text-foreground">{props.group ? t("Edit group") : t("New account group")}</p>
              <Button type="button" variant="ghost" size="icon-square" aria-label={t("Close")} onClick={props.onClose}>
                <Icon name="close-remove" class="size-6" />
              </Button>
            </div>
            <div class="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
              <label class="block">
                <span class={fieldLabel}>{t("Name")}</span>
                <input
                  autofocus
                  class={fieldControl}
                  maxLength={40}
                  placeholder={t("e.g. Acme")}
                  value={name()}
                  onInput={(event) => {
                    setName(event.currentTarget.value);
                    setError(null);
                  }}
                />
              </label>
              <div class="flex flex-col gap-3">
                <span class="text-xs text-muted-foreground">{t("Accounts · as many as you like on each platform")}</span>
                <For each={platforms()}>
                  {(platform) => (
                    <div class="flex flex-col gap-1">
                      <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <PlatformLogo id={platform.id} class="size-3.5 rounded-sm" />
                        <span class="flex-1">{socialPlatform(platform.id).name}</span>
                        <Show when={connectionsFor(platform.id).length > 1}>
                          <button
                            type="button"
                            class="cap-centered rounded-md px-1 text-xs text-primary press hover:bg-primary/10 focus-ring"
                            onClick={() => toggleAll(platform.id)}
                          >
                            {allOn(platform.id) ? t("Clear") : t("All {count}", { count: connectionsFor(platform.id).length })}
                          </button>
                        </Show>
                      </span>
                      <div class="flex flex-wrap gap-1">
                        <For each={connectionsFor(platform.id)}>
                          {(account) => {
                            const on = () => picked().includes(account.id);
                            return (
                              <button
                                type="button"
                                aria-pressed={on()}
                                class={cx(
                                  "flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs press focus-ring",
                                  on()
                                    ? "border-primary/70 bg-primary/10 text-foreground"
                                    : "border-(--border-input) text-muted-foreground hover:bg-accent hover:text-foreground",
                                )}
                                onClick={() => toggle(account.id)}
                              >
                                <span
                                  class="grid size-3.5 shrink-0 place-items-center rounded-sm border transition-colors"
                                  classList={{ "border-primary bg-primary text-primary-foreground": on(), "border-(--border-input)": !on() }}
                                >
                                  <Show when={on()}>
                                    <CheckMark />
                                  </Show>
                                </span>
                                <span class="truncate">{accountLabel(account)}</span>
                              </button>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <Show when={error()}>
                <p role="alert" class="text-xs text-destructive">{error()}</p>
              </Show>
            </div>
            <div class="flex items-center gap-1.5 border-t border-border-strong px-4 py-3">
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {t("{count, plural, one {# account} other {# accounts}}", { count: picked().length })}
              </span>
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={!name().trim() || picked().length === 0}>
                {props.group ? t("Save") : t("Create group")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
