/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { InboxArt } from "@/components/dashboard/empty-art";
import { DashboardGroupLabel, DashboardPageHeader } from "@/components/dashboard/page-header";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { cx } from "@/lib/cva";
import { localized, msg, t } from "@/lib/i18n";

import { needsAttention, type NoticeAction, type NoticeTone, type Notifications, type ShownNotice } from "./notifications";

const SEEN_AFTER_MS = 1500;

const TONES: Record<NoticeTone, string> = {
  error: "bg-destructive/12 text-destructive",
  warning: "bg-meter-yellow/12 text-meter-yellow",
  success: "bg-(--plane-layer-transparent-active) text-(--plane-text-tertiary)",
  info: "bg-primary/12 text-primary",
};

type Row = { key: string; notices: ShownNotice[] };

function rowsOf(notices: readonly ShownNotice[]): Row[] {
  const rows: Row[] = [];
  const groups = new Map<string, Row>();
  for (const notice of notices) {
    const found = notice.group ? groups.get(notice.group) : undefined;
    if (found) {
      found.notices.push(notice);
      continue;
    }
    const row = { key: notice.group ?? notice.id, notices: [notice] };
    rows.push(row);
    if (notice.group) groups.set(notice.group, row);
  }
  return rows;
}

function listNames(names: readonly string[]) {
  return names.length > 1 ? t("{names} and {last}", { names: names.slice(0, -1).join(", "), last: names.at(-1) }) : (names[0] ?? "");
}

type Filter = "all" | "attention" | "updates";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: msg("All") },
  { id: "attention", label: msg("Needs attention") },
  { id: "updates", label: msg("Updates") },
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SHORT_DATE = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }));

function ago(at: number, now: number) {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return t("Just now");
  if (elapsed < HOUR) return t("{count}m ago", { count: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t("{count}h ago", { count: Math.floor(elapsed / HOUR) });
  if (elapsed < 7 * DAY) return t("{count}d ago", { count: Math.floor(elapsed / DAY) });
  return SHORT_DATE().format(at);
}

export function DashboardNotificationsView(props: { notifications: Notifications }) {
  const shown = () => props.notifications.list();
  const attention = createMemo(() => shown().filter(needsAttention));
  const updates = createMemo(() => shown().filter((notice) => !needsAttention(notice)));

  // Unread ones stay marked as new for this visit after they count as read.
  const [fresh, setFresh] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(() => {
    const ids = props.notifications.unread().map((notice) => notice.id);
    if (!ids.length) return;
    setFresh((current) => new Set([...current, ...ids]));
    const seen = () => {
      if (document.visibilityState === "visible") props.notifications.markRead(ids);
    };
    const timer = setTimeout(seen, SEEN_AFTER_MS);
    document.addEventListener("visibilitychange", seen);
    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", seen);
    });
  });

  const run = (row: Row, action: NoticeAction) => {
    props.notifications.markRead(row.notices.map((notice) => notice.id));
    action.run();
  };

  const clear = (row: Row, title: string) => {
    const ids = row.notices.map((notice) => notice.id);
    props.notifications.clear(ids);
    toast(t("Notification cleared"), {
      description: title,
      action: { label: t("Undo"), onClick: () => props.notifications.restore(ids) },
    });
  };

  const clearAll = (notices: ShownNotice[]) => {
    const ids = notices.map((notice) => notice.id);
    if (!ids.length) return;
    props.notifications.clear(ids);
    toast(t("{count, plural, one {# notification cleared} other {# notifications cleared}}", { count: ids.length }), {
      action: { label: t("Undo"), onClick: () => props.notifications.restore(ids) },
    });
  };

  const restoreCleared = () => {
    const ids = props.notifications.cleared();
    props.notifications.restore(ids);
    toast(t("{count, plural, one {# notification restored} other {# notifications restored}}", { count: ids.length }));
  };

  // Drops the new marks too, which otherwise stay for the rest of the visit.
  const markAllRead = () => {
    props.notifications.markRead(shown().map((notice) => notice.id));
    setFresh(new Set<string>());
  };

  const [filter, setFilter] = createSignal<Filter>("all");
  const count = (id: Filter) => (id === "attention" ? attention() : id === "updates" ? updates() : shown()).length;

  const section = (title: string, notices: ShownNotice[]) => (
    <Show when={notices.length}>
      <section class="flex flex-col gap-2">
        <DashboardGroupLabel class="px-1">{title}</DashboardGroupLabel>
        <div class="flex flex-col divide-y divide-border-strong overflow-hidden rounded-xl border border-border-strong bg-accent/30">
          <For each={rowsOf(notices)}>
            {(row) => (
              <NoticeRow
                row={row}
                fresh={row.notices.some((notice) => fresh().has(notice.id))}
                now={props.notifications.now()}
                onAction={(action) => run(row, action)}
                onClear={(rowTitle) => clear(row, rowTitle)}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  );

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <DashboardPageHeader>
        <Show when={shown().length}>
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={PlaneButton} variant="ghost" size="lg" class="gap-1 pr-1.5" aria-label={t("Show")}>
              {t(FILTERS.find((option) => option.id === filter())!.label)}
              <PlaneIcon name="chevron-down" class="size-3.5 text-(--plane-text-placeholder)" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-44">
                <For each={FILTERS}>
                  {(option) => (
                    <DropdownMenuItem tone="neutral" onSelect={() => setFilter(option.id)}>
                      <span class="flex-1">{t(option.label)}</span>
                      <span class="text-xxs tabular-nums text-(--plane-text-placeholder)">{count(option.id)}</span>
                      <span class="grid size-3.5 place-items-center">
                        <Show when={filter() === option.id}>
                          <PlaneIcon name="check" class="size-3.5" />
                        </Show>
                      </span>
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger as={PlaneButton} variant="ghost" size="lg" class="w-7 px-0" aria-label={t("Inbox options")}>
              <Icon name="more-three-dots-small-horizontal" class="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-44">
                <DropdownMenuItem tone="neutral" disabled={!props.notifications.unread().length && !fresh().size} onSelect={markAllRead}>
                  {t("Mark all as read")}
                </DropdownMenuItem>
                <DropdownMenuItem tone="neutral" disabled={!updates().length} onSelect={() => clearAll(updates())}>
                  {t("Clear updates")}
                </DropdownMenuItem>
                <DropdownMenuItem tone="neutral" disabled={!props.notifications.cleared().length} onSelect={restoreCleared}>
                  <span class="flex-1">{t("Restore cleared")}</span>
                  <Show when={props.notifications.cleared().length}>
                    <span class="text-xxs tabular-nums text-(--plane-text-placeholder)">{props.notifications.cleared().length}</span>
                  </Show>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!shown().length} onSelect={() => clearAll(shown())}>
                  {t("Clear all")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </Show>
      </DashboardPageHeader>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex w-full flex-col gap-6 px-6 pt-6 pb-24">
          <Show
            when={shown().length}
            fallback={
              <div class="flex flex-col items-center gap-4 pt-4 text-center">
                <InboxArt />
                <div class="flex flex-col gap-1">
                  <h2 class="text-sm font-medium text-foreground">{t("You're all caught up")}</h2>
                  <p class="max-w-xs text-xs text-muted-foreground">
                    {t("Failed posts, plan and card reminders, and storage warnings show up here.")}
                  </p>
                </div>
                <Show when={props.notifications.cleared().length}>
                  {(cleared) => (
                    <PlaneButton variant="ghost" size="lg" onClick={restoreCleared}>
                      {t("{count, plural, one {Restore # cleared notification} other {Restore # cleared notifications}}", { count: cleared() })}
                    </PlaneButton>
                  )}
                </Show>
              </div>
            }
          >
            <Show
              when={count(filter())}
              fallback={
                <p class="pt-16 text-center text-xs text-muted-foreground">
                  {filter() === "attention" ? t("Nothing needs your attention.") : t("No updates.")}
                </p>
              }
            >
              {section(t("Needs attention"), filter() === "updates" ? [] : attention())}
              {section(t("Updates"), filter() === "attention" ? [] : updates())}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}

function NoticeRow(props: {
  row: Row;
  /** Unread when this visit began. */
  fresh: boolean;
  now: number;
  onAction(action: NoticeAction): void;
  onClear(title: string): void;
}) {
  const head = () => props.row.notices[0]!;
  const grouped = () => props.row.notices.length > 1;
  const networks = () => [...new Set(props.row.notices.map((notice) => notice.network).filter((name): name is string => !!name))].reverse();
  const title = () => {
    const name = head().groupTitle;
    return grouped() && name ? name(listNames(networks())) : head().title;
  };
  const body = () => {
    if (!grouped()) return head().body;
    const notes = [...new Set(props.row.notices.map((notice) => notice.note).filter((note): note is string => !!note))];
    return notes.length ? notes.join(" ") : head().body;
  };
  const attention = () => needsAttention(head());
  const open = () => (attention() ? undefined : head().actions[0]);

  return (
    <article
      class={cx("group relative flex gap-3 py-3 pr-3 pl-4", open() && "transition-colors hover:bg-(--plane-layer-transparent-hover)")}
      classList={{ "bg-primary/[0.04]": props.fresh }}
    >
      <Show when={props.fresh}>
        <span aria-label={t({ message: "New", context: "unread notification" })} class="absolute top-[22px] left-1.5 size-1.5 rounded-full bg-primary" />
      </Show>
      <span class={cx("grid size-7 shrink-0 place-items-center rounded-full", TONES[head().tone])}>
        <Icon name={head().icon} class="size-5" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5 pt-px">
        <h3 class="truncate text-xs leading-5 font-medium text-foreground">
          <Show when={open()} fallback={title()}>
            {(action) => (
              <button
                type="button"
                title={action().label}
                class="text-left outline-none focus-ring after:absolute after:inset-0 after:content-['']"
                onClick={() => props.onAction(action())}
              >
                {title()}
              </button>
            )}
          </Show>
        </h3>
        <p class="text-xs leading-4 text-muted-foreground">
          <Show when={head().subject}>
            <span class="text-foreground">{head().subject}</span>
            {" · "}
          </Show>
          {body()}
        </p>
        <Show when={attention() && head().actions.length}>
          <div class="flex flex-wrap items-center gap-1.5 pt-2">
            <For each={head().actions}>
              {(action, index) => (
                <Button variant={index() === 0 ? "secondary" : "ghost"} class="px-2.5" onClick={() => props.onAction(action)}>
                  {action.label}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="relative flex shrink-0 items-center gap-1 self-start">
        <time datetime={new Date(head().at).toISOString()} class="text-xs leading-5 tabular-nums text-muted-foreground">
          {ago(head().at, props.now)}
        </time>
        <button
          type="button"
          aria-label={t("Clear")}
          title={t("Clear")}
          class="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 press hover:bg-accent hover:text-foreground focus-ring group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => props.onClear(title())}
        >
          <Icon name="close-remove-small" class="size-5" />
        </button>
      </div>
    </article>
  );
}
