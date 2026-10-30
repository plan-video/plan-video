/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";

import { YouTubeWhiteTile } from "@/components/brand/youtube-icon";
import { GroupFormDialog, deleteGroupWithUndo } from "@/components/dashboard/account-groups";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { SearchInput } from "@/components/ui/search-input";
import { useAuth } from "@/context/auth";
import { accountGroups, groupAccounts, groupSelection, loadAccountGroups, type AccountGroup } from "@/lib/account-groups";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { socialPlatform, sortPlatforms, type PlatformId } from "@/lib/social";
import { accountLabel, accountsFor, sameChoices, socialConnections, type AccountChoices } from "@/lib/social-connections";

import { CheckMark, PlatformLogo } from "./controls";

const chipClass = (on: boolean) =>
  cx(
    "flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full border pl-1.5 pr-2.5 text-xs press focus-ring disabled:cursor-not-allowed disabled:opacity-40",
    on ? "border-primary/70 bg-primary/10 text-foreground" : "border-(--border-input) text-muted-foreground hover:bg-accent hover:text-foreground",
  );

const MORE_CLASS = "gap-1 pr-1.5 pl-2.5";

const NEW_GROUP_CLASS =
  "flex h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-(--border-input) pr-2.5 pl-1.5 text-xs text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring";

/** "Groups", which opens the list of every group once there is one. */
const LABEL_CLASS =
  "-ml-1 flex h-7 shrink-0 items-center gap-0.5 rounded-md pr-0.5 pl-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring data-[expanded]:bg-accent data-[expanded]:text-foreground";

const ROW_ACTION_CLASS = "grid size-6 place-items-center rounded-md text-muted-foreground press hover:bg-background hover:text-foreground focus-ring";

/** A group's platforms, overlapping, except beside YouTube's icon, which nothing may cover. */
function GroupLogos(props: { platforms: readonly PlatformId[] }) {
  return (
    <span class={cx("flex shrink-0 items-center", props.platforms.slice(0, 4).includes("youtube") ? "gap-1" : "-space-x-1")}>
      {/* YouTube's small, on its white tile, the size of the others (the user's choice; see brand/youtube-icon). */}
      <For each={props.platforms.slice(0, 4)}>
        {(id) => (id === "youtube" ? <YouTubeWhiteTile class="size-4 rounded-full" /> : <PlatformLogo id={id} class="size-4 rounded-full ring-2 ring-background" />)}
      </For>
    </span>
  );
}

/**
 * The workspace's account groups as chips. Picking one selects its platforms
 * and every account of it on each; New group saves the accounts picked now.
 * The chips that fit on one line show; the rest open from More. "Groups" opens
 * every group as a list that can be searched, edited and deleted from.
 */
export function AccountGroupPicker(props: {
  platforms: readonly PlatformId[];
  accounts: AccountChoices;
  /** The platforms this post can go to; a group's others are left out. */
  available?: readonly PlatformId[];
  onPick(platforms: PlatformId[], accounts: AccountChoices): void;
  class?: string;
}) {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [editing, setEditing] = createSignal<AccountGroup | "new" | null>(null);
  /** Which button the list is open from. */
  const [listFrom, setListFrom] = createSignal<"label" | "more" | null>(null);
  const [query, setQuery] = createSignal("");
  createEffect(() => loadAccountGroups(auth.user()?.id));

  /** The accounts the post goes out from now, to start a new group with. */
  const pickedAccounts = () => props.platforms.flatMap((id) => accountsFor(id, props.accounts).map((account) => account.id));

  const selectionOf = (group: AccountGroup) => {
    const { platforms, accounts } = groupSelection(group);
    const usable = (platforms as PlatformId[]).filter((id) => !props.available || props.available.includes(id));
    const picked: AccountChoices = {};
    for (const id of usable) picked[id] = accounts[id];
    return { platforms: sortPlatforms(usable), accounts: picked };
  };

  const isActive = (group: AccountGroup) => {
    const { platforms, accounts } = selectionOf(group);
    return (
      platforms.length > 0 &&
      platforms.length === props.platforms.length &&
      platforms.every((id) => props.platforms.includes(id)) &&
      sameChoices(accounts, props.accounts)
    );
  };

  // A hidden copy of the row on one line, every chip in it, says how many fit.
  const [row, setRow] = createSignal<HTMLDivElement>();
  const [ruler, setRuler] = createSignal<HTMLDivElement>();
  const [fitting, setFitting] = createSignal(Infinity);
  const fit = () => {
    const line = row();
    const copy = ruler();
    if (!line || !copy) return;
    const style = getComputedStyle(line);
    const room = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const gap = parseFloat(style.columnGap) || 0;
    // More and New group lead the copy, so the line is measured from its label.
    const [more, create, label, ...chips] = [...copy.children] as HTMLElement[];
    const ends = chips.map((chip) => chip.offsetLeft - label!.offsetLeft + chip.offsetWidth);
    if ((ends.at(-1) ?? 0) + gap + create!.offsetWidth <= room) return setFitting(Infinity);
    const tail = 2 * gap + more!.offsetWidth + create!.offsetWidth;
    const count = ends.filter((end) => end + tail <= room).length;
    // A lone group left over wraps to a second line rather than hide behind "1 more".
    setFitting(count === chips.length - 1 ? Infinity : count);
  };
  createEffect(() => {
    const line = row();
    const copy = ruler();
    if (!line || !copy) return;
    const observer = new ResizeObserver(fit);
    observer.observe(line);
    observer.observe(copy);
    onCleanup(() => observer.disconnect());
  });

  const shown = () => accountGroups().slice(0, fitting());
  const hidden = () => accountGroups().slice(fitting());
  /** A group from the list that the post is set to now: More shows as picked. */
  const hiddenActive = () => hidden().find(isActive);

  const matches = () => {
    const words = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return accountGroups();
    return accountGroups().filter((group) => {
      const text = [group.name, ...groupAccounts(group).flatMap((account) => [account.handle, socialPlatform(account.platform as PlatformId)?.name ?? account.platform])]
        .join(" ")
        .toLowerCase();
      return words.every((word) => text.includes(word));
    });
  };

  const pick = (group: AccountGroup) => {
    const { platforms, accounts } = selectionOf(group);
    props.onPick(platforms, accounts);
  };

  const openList = (from: "label" | "more", next: boolean) => {
    setListFrom(next ? from : null);
    if (!next) setQuery("");
  };
  const closeList = () => {
    setListFrom(null);
    setQuery("");
  };

  const remove = (group: AccountGroup) => {
    const userId = auth.ownerId();
    if (userId) deleteGroupWithUndo(userId, group);
  };

  /** Every group, for both buttons that open it. Edit and Delete show on the row under the pointer or focus. */
  const groupList = () => (
    <PopoverPortal>
      <PopoverContent data-calendar-keep-popup class="z-[10000] flex w-72 flex-col overflow-hidden rounded-xl p-0">
        <SearchInput placeholder={t("Search groups")} value={query()} onValue={setQuery} />
        <div role="group" aria-label={t("Account groups")} class="flex max-h-72 flex-col gap-0.5 overflow-y-auto overscroll-contain p-1">
          <Show when={matches().length} fallback={<p class="px-2 py-6 text-center text-xs text-muted-foreground">{t("Nothing matches.")}</p>}>
            <For each={matches()}>
              {(group) => {
                const selection = () => selectionOf(group);
                return (
                  <div class="group/row flex h-8 shrink-0 items-center rounded-md transition-colors focus-within:bg-accent hover:bg-accent">
                    <button
                      type="button"
                      aria-pressed={isActive(group)}
                      disabled={selection().platforms.length === 0}
                      title={groupAccounts(group).map(accountLabel).join(", ")}
                      class="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-2 text-left text-xs focus-ring disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        pick(group);
                        closeList();
                      }}
                    >
                      <GroupLogos platforms={selection().platforms} />
                      <span class={cx("min-w-0 flex-1 truncate", isActive(group) ? "text-foreground" : "text-muted-foreground")}>{group.name}</span>
                      <Show
                        when={isActive(group)}
                        fallback={
                          <span class="shrink-0 text-muted-foreground group-focus-within/row:hidden group-hover/row:hidden">
                            {t("{count, plural, one {# account} other {# accounts}}", { count: groupAccounts(group).length })}
                          </span>
                        }
                      >
                        <CheckMark class="size-3 text-primary" />
                      </Show>
                    </button>
                    <span class="hidden shrink-0 items-center gap-0.5 pr-1 group-focus-within/row:flex group-hover/row:flex">
                      <button
                        type="button"
                        aria-label={t("Edit group")}
                        title={t("Edit group")}
                        class={ROW_ACTION_CLASS}
                        onClick={() => {
                          closeList();
                          setEditing(group);
                        }}
                      >
                        <PlaneIcon name="edit" class="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("Delete {title}", { title: group.name })}
                        title={t("Delete {title}", { title: group.name })}
                        class={cx(ROW_ACTION_CLASS, "hover:text-destructive")}
                        onClick={() => remove(group)}
                      >
                        <PlaneIcon name="trash" class="size-3.5" />
                      </button>
                    </span>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
        <div class="flex h-9 items-center border-t border-border px-2">
          <button
            type="button"
            class="rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-ring"
            onClick={() => {
              closeList();
              setParams({ dashboard: "connections" });
            }}
          >
            {t("Manage groups")}
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  );

  return (
    <Show when={accountGroups().length > 0 || socialConnections().length > 0}>
      <div ref={setRow} class={cx("flex flex-wrap items-center gap-1.5", props.class)} role="group" aria-label={t("Account groups")}>
        <Show when={accountGroups().length} fallback={<span class="mr-0.5 text-xs text-muted-foreground">{t("Groups")}</span>}>
          <Popover placement="bottom-start" open={listFrom() === "label"} onOpenChange={(next) => openList("label", next)}>
            <PopoverTrigger type="button" class={LABEL_CLASS}>
              {t("Groups")}
              <Icon name="chevron-down" class="size-4 shrink-0" />
            </PopoverTrigger>
            {groupList()}
          </Popover>
        </Show>
        <For each={shown()}>
          {(group) => {
            const selection = () => selectionOf(group);
            return (
              <button
                type="button"
                aria-pressed={isActive(group)}
                disabled={selection().platforms.length === 0}
                title={groupAccounts(group).map(accountLabel).join(", ")}
                class={chipClass(isActive(group))}
                onClick={() => pick(group)}
              >
                <GroupLogos platforms={selection().platforms} />
                <span class="truncate">{group.name}</span>
              </button>
            );
          }}
        </For>
        <Show when={hidden().length}>
          <Popover placement="bottom-start" open={listFrom() === "more"} onOpenChange={(next) => openList("more", next)}>
            <PopoverTrigger type="button" title={hiddenActive()?.name} class={cx(chipClass(!!hiddenActive()), MORE_CLASS)}>
              {t("{count, plural, one {# more} other {# more}}", { count: hidden().length })}
              <Icon name="chevron-down" class="size-4 shrink-0" />
            </PopoverTrigger>
            {groupList()}
          </Popover>
        </Show>
        <button type="button" class={NEW_GROUP_CLASS} onClick={() => setEditing("new")}>
          <Icon name="plus-add-small" class="size-4" />
          {t("New group")}
        </button>
      </div>
      <div class="h-0 overflow-hidden" aria-hidden="true">
        <div ref={setRuler} class="invisible flex w-max items-center gap-1.5">
          <span class={cx(chipClass(false), MORE_CLASS)}>
            {t("{count, plural, one {# more} other {# more}}", { count: accountGroups().length })}
            <Icon name="chevron-down" class="size-4 shrink-0" />
          </span>
          <span class={NEW_GROUP_CLASS}>
            <Icon name="plus-add-small" class="size-4" />
            {t("New group")}
          </span>
          <span class={LABEL_CLASS}>
            {t("Groups")}
            <Icon name="chevron-down" class="size-4 shrink-0" />
          </span>
          <For each={accountGroups()}>
            {(group) => (
              <span class={chipClass(false)}>
                <GroupLogos platforms={selectionOf(group).platforms} />
                <span class="truncate">{group.name}</span>
              </span>
            )}
          </For>
        </div>
      </div>
      <Show when={editing()} keyed>
        {(current) => (
          <GroupFormDialog
            group={current === "new" ? null : current}
            accounts={current === "new" ? pickedAccounts() : undefined}
            onClose={() => setEditing(null)}
          />
        )}
      </Show>
    </Show>
  );
}
