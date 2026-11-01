/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapted from next16-calendar (github.com/aurorascharff/next16-calendar, MIT).

import "./calendar.css";
import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { DashboardHeaderSearch, DashboardPageHeader } from "@/components/dashboard/page-header";
import { PostHoverCard, createPostHover } from "./post-hover-card";
import { PageSkeleton } from "@/components/dashboard/page-skeleton";
import { playEnter } from "@/lib/motion";
import { PlaneButton } from "@/components/dashboard/plane-button";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { GroupLogos } from "@/components/publish/account-group-picker";
import { PlatformLogo } from "@/components/publish/controls";
import { atLocal, nextSlot, timeOf } from "@/components/publish/save";
import { CalendarPostList, listQuery, setListQuery } from "@/components/dashboard/posts-view";
import { hasFailed, isGoingOut } from "@/components/publish/publisher";
import { msg, t } from "@/lib/i18n";
import { groupSelection } from "@/lib/account-groups";
import { sortPlatforms, type PlatformId } from "@/lib/social";
import { accountLabel, socialConnections } from "@/lib/social-connections";
import { EventPopover } from "./event-popover";
import { MiniMonth } from "./mini-month";
import { MonthBoard } from "./month-board";
import { useCalendarNavigation, type CalendarNavigation } from "./navigation";
import { SquirrelAsleep } from "@/components/brand/mascot";
import { accountFilter, allPosts, groupFilter, hydrateCalendar, isEventVisible, loadError, loaded, monthRange, saving, setAccountFilter, setStatusFilter, statusFilter, weekRange } from "./store";
import { STATUS_FILTERS, cn, formatMonth, localDateKey, shiftPeriod } from "./utils";
import { CalendarViewToggle } from "./view-toggle";
import { WeekBoard } from "./week-board";
import type { PostStatusFilter, SelectedEvent, CalendarView } from "./types";

function slotTime(day: string) {
  const morning = atLocal(day, "09:00");
  if (morning && morning.getTime() > Date.now()) return "09:00";
  const upcoming = nextSlot();
  return localDateKey(upcoming) === day ? timeOf(upcoming) : "09:00";
}

export function DashboardCalendarView() {
  const nav = useCalendarNavigation();
  const [, setParams] = useSearchParams();
  const [selected, setSelected] = createSignal<SelectedEvent | null>(null);

  onMount(() => void hydrateCalendar());

  const openComposer = (day: string, time?: string) => {
    setSelected(null);
    setParams({ dashboard: "new-post", date: day, time: time ?? slotTime(day), view: undefined });
  };
  const openEvent = (next: SelectedEvent) => {
    hover.cancel();
    setSelected(next);
  };
  const hover = createPostHover();

  let board: HTMLElement | undefined;
  createEffect(on(() => nav.view(), () => playEnter(board), { defer: true }));

  useCalendarShortcuts(nav, () => selected() !== null);

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <CalendarHeader nav={nav} />
      <main ref={board} class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Switch>
          <Match when={loadError()}>
            <div class="grid flex-1 place-items-center px-6 text-center text-sm text-(--plane-text-tertiary)">{t(loadError() ?? "")}</div>
          </Match>
          <Match when={!loaded()}>
            <PageSkeleton kind={nav.view()} />
          </Match>
          <Match when={nav.view() === "month"}>
            <MonthBoard nav={nav} onCreate={openComposer} onSelect={openEvent} hover={hover} />
          </Match>
          <Match when={nav.view() === "week"}>
            <WeekBoard nav={nav} onCreate={openComposer} onSelect={openEvent} hover={hover} />
          </Match>
          <Match when={nav.view() === "list"}>
            <CalendarPostList date={nav.date()} picked={nav.picked()} onShowMonth={() => nav.go(nav.date())} />
          </Match>
        </Switch>
        <Show when={loaded() && !loadError() && nav.view() !== "list" && periodIsEmpty(nav)}>
          <EmptyPeriod view={nav.view()} />
        </Show>
      </main>

      <Show when={selected()} keyed>
        {(current) => <EventPopover selected={current} onClose={() => setSelected(null)} />}
      </Show>
      <PostHoverCard hover={hover} />
    </div>
  );
}

function periodIsEmpty(nav: CalendarNavigation) {
  const range = nav.view() === "week" ? weekRange(nav.date()) : monthRange(nav.date());
  return !range.events.some(isEventVisible);
}

const EMPTY_PERIOD: Record<PostStatusFilter, string> = {
  all: msg("Nothing is scheduled"),
  scheduled: msg("Nothing is scheduled"),
  draft: msg("No drafts"),
  posted: msg("Nothing has been posted"),
  failed: msg("Nothing failed"),
};

/**
 * Lets clicks through to the slots underneath. The month is always six rows,
 * so its middle is a row's edge: the squirrel moves up half a row to sit in one day.
 */
function EmptyPeriod(props: { view: CalendarView }) {
  return (
    <div
      class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 pt-10 text-(--plane-text-tertiary)"
      style={{ translate: props.view === "month" ? "0 calc(-100% / 12 + 5px)" : undefined }}
    >
      <SquirrelAsleep width={92} class="opacity-70" />
      <span class="text-sm">{t(EMPTY_PERIOD[statusFilter()] ?? EMPTY_PERIOD.all)}</span>
    </div>
  );
}

function StatusFilter() {
  const failedCount = () => allPosts().filter((post) => hasFailed(post) && !isGoingOut(post)).length;
  const options = () =>
    failedCount() || statusFilter() === "failed" ? [...STATUS_FILTERS, { label: msg("Failed"), value: "failed" as const }] : STATUS_FILTERS;
  const label = () => (statusFilter() === "all" ? t("All posts") : t(options().find((option) => option.value === statusFilter())?.label ?? "All posts"));

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as={PlaneButton}
        variant={statusFilter() === "all" ? "ghost" : "tertiary"}
        size="lg"
        aria-label={t("Post status: {status}", { status: label() })}
        class="gap-1 pr-1.5"
      >
        <PlaneIcon name="preferences" class="size-3.5 text-(--plane-text-placeholder)" />
        {label()}
        <PlaneIcon name="chevron-down" class="size-3.5 text-(--plane-text-placeholder)" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-40">
          <DropdownMenuRadioGroup value={statusFilter()} onChange={(value) => setStatusFilter(value as PostStatusFilter)}>
            <For each={options()}>
              {(option) => <DropdownMenuRadioItem value={option.value}>{option.value === "all" ? t("All posts") : t(option.label)}</DropdownMenuRadioItem>}
            </For>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

/** Repeats the sidebar's pick, since the sidebar is hidden on narrow windows. */
function AccountChip() {
  const account = () => socialConnections().find((item) => item.id === accountFilter());
  const picked = () => {
    const group = groupFilter();
    if (group) return { label: group.name, mark: <GroupLogos platforms={sortPlatforms(groupSelection(group).platforms as PlatformId[])} /> };
    const one = account();
    return one ? { label: accountLabel(one), mark: <PlatformLogo id={one.platform as PlatformId} class="size-4 rounded-sm" bare /> } : null;
  };
  return (
    <Show when={picked()}>
      {(picked) => (
        <span class="flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-(--plane-layer-3) pr-0.5 pl-1.5 text-sm font-medium text-(--plane-text-secondary)">
          {picked().mark}
          <span class="max-w-32 truncate">{picked().label}</span>
          <button
            type="button"
            aria-label={t("Show every account")}
            class="grid size-6 place-items-center rounded-md text-(--plane-text-placeholder) outline-none press hover:text-(--plane-text-primary) focus-ring"
            onClick={() => setAccountFilter(null)}
          >
            <PlaneIcon name="close" class="size-3.5" />
          </button>
        </span>
      )}
    </Show>
  );
}

function CalendarHeader(props: { nav: CalendarNavigation }) {
  const period = () => (props.nav.view() === "week" ? "week" : "month");
  const arrow = "grid size-7 place-items-center rounded-md text-(--plane-text-secondary) outline-none press hover:bg-accent hover:text-(--plane-text-primary) focus-ring";

  return (
    <DashboardPageHeader
      noPhoneCrumbs
      nav={
        <div class="ml-1 flex min-w-0 items-center gap-0.5 max-md:hidden">
          <PlaneButton variant="secondary" size="lg" class="mr-1" aria-keyshortcuts="T" onClick={() => props.nav.go(props.nav.today())}>
            {t("Today")}
          </PlaneButton>
          <button
            type="button"
            class={arrow}
            aria-label={period() === "week" ? t("Previous week") : t("Previous month")}
            aria-keyshortcuts="ArrowLeft"
            onClick={() => props.nav.go(shiftPeriod(props.nav.date(), props.nav.view(), -1))}
          >
            <PlaneIcon name="chevron-left" class="size-4" />
          </button>
          <button
            type="button"
            class={arrow}
            aria-label={period() === "week" ? t("Next week") : t("Next month")}
            aria-keyshortcuts="ArrowRight"
            onClick={() => props.nav.go(shiftPeriod(props.nav.date(), props.nav.view(), 1))}
          >
            <PlaneIcon name="chevron-right" class="size-4" />
          </button>
          <MonthJump nav={props.nav} />
        </div>
      }
    >
      <span
        role="status"
        class={cn("text-xs text-(--plane-text-placeholder) transition-opacity duration-150 max-md:hidden", saving() ? "opacity-100" : "opacity-0")}
      >
        {t("Saving…")}
      </span>
      <Show when={props.nav.view() === "list" && allPosts().length}>
        <DashboardHeaderSearch value={listQuery()} placeholder={t("Search")} label={t("Search posts")} onInput={setListQuery} class="w-48" />
      </Show>
      <AccountChip />
      <StatusFilter />
      <div class="contents max-md:hidden">
        <ViewToggle nav={props.nav} />
      </div>
    </DashboardPageHeader>
  );
}

function MonthJump(props: { nav: CalendarNavigation }) {
  const [open, setOpen] = createSignal(false);
  createEffect(on(() => `${props.nav.date()}:${props.nav.view()}:${props.nav.picked()}`, () => setOpen(false), { defer: true }));

  return (
    <Popover placement="bottom-start" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        class="ml-1 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-sm leading-5 font-medium text-(--plane-text-primary) outline-none press hover:bg-accent focus-ring data-expanded:bg-accent"
      >
        <span class="truncate">{formatMonth(props.nav.date())}</span>
        <PlaneIcon name="chevron-down" class="size-3.5 shrink-0 text-(--plane-text-placeholder)" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="w-64 rounded-xl border-(--plane-border-strong) p-2">
          <MiniMonth nav={props.nav} onPick={() => setOpen(false)} />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function ViewToggle(props: { nav: CalendarNavigation }) {
  return <CalendarViewToggle value={props.nav.view()} onChange={(page) => props.nav.go(props.nav.date(), page)} />;
}

function useCalendarShortcuts(nav: CalendarNavigation, popupOpen: () => boolean) {
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (popupOpen()) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu], [role=listbox]"))) return;

      switch (event.key.toLowerCase()) {
        case "w":
          nav.go(nav.date(), "week");
          break;
        case "m":
          nav.go(nav.date(), "month");
          break;
        case "l":
          nav.go(nav.date(), "list");
          break;
        case "arrowleft":
          nav.go(shiftPeriod(nav.date(), nav.view(), -1));
          break;
        case "arrowright":
          nav.go(shiftPeriod(nav.date(), nav.view(), 1));
          break;
        case "t":
          nav.go(nav.today());
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });
}
