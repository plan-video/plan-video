/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { localized, t } from "@/lib/i18n";
import type { CalendarNavigation } from "./navigation";
import { PostChipBody, chipClass, moreClass } from "./post-chip";
import { isEventVisible, monthRange } from "./store";
import { MIN_CHIP_HEIGHT, chipStyle, cn, formatDay, formatDayParts, getWeekDays } from "./utils";
import type { PostHover } from "./post-hover-card";
import type { CalendarEvent, SelectedEvent } from "./types";

/** Monday-first. The long name is used when the column can hold “Wednesday”. */
const WEEKDAYS = localized(() =>
  getWeekDays("2024-01-01").map((day) => {
    const parts = formatDayParts(day);
    return { full: parts.weekday, short: parts.weekdayShort };
  }),
);

/** A cell's own chrome, in pixels: the day's number, the padding, and the border under it. */
const CELL_CHROME = 30 + 8 + 1;
const CHIP_GAP = 2;
const MORE_HEIGHT = 24;
/** The rows' least height, from the grid's `auto-rows`, until the grid has been measured. */
const MIN_CELL_HEIGHT = 136;
const ROWS = 6;

/** How many of a day's `count` posts a cell this tall shows, keeping room for “+N more” when not all fit. */
function chipsShown(cellHeight: number, count: number) {
  const room = cellHeight - CELL_CHROME;
  const step = MIN_CHIP_HEIGHT + CHIP_GAP;
  if (count <= Math.floor((room + CHIP_GAP) / step)) return count;
  return Math.max(1, Math.floor((room - MORE_HEIGHT) / step));
}

function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((left, right) => {
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
    return left.start.localeCompare(right.start) || left.title.localeCompare(right.title);
  });
}

type MonthBoardProps = {
  nav: CalendarNavigation;
  onCreate(day: string, time?: string): void;
  onSelect(selected: SelectedEvent): void;
  /** Shows a post's preview while the mouse rests on it. */
  hover?: PostHover;
};

function DayHeading(props: { day: string; today: boolean; outside: boolean; onCreate(): void }) {
  return (
    <div class="pointer-events-none relative z-10 mb-0.5 flex h-7 shrink-0 items-center justify-between pl-0.5">
      <span
        class={cn(
          "grid h-6 min-w-6 place-items-center rounded-md px-1 text-xs tabular-nums",
          props.today ? "bg-(--plane-accent-primary) font-medium text-white" : props.outside ? "text-(--plane-text-disabled)" : "text-(--plane-text-secondary)",
        )}
      >
        {Number(props.day.slice(-2))}
      </span>
      <button
        type="button"
        aria-label={t("Add a post on {date}", { date: formatDay(props.day) })}
        class="pointer-events-auto grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 press hover:bg-accent hover:text-foreground focus-ring focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => props.onCreate()}
      >
        <Icon name="plus-add-small" class="size-5" />
      </button>
    </div>
  );
}

function MonthChip(props: { event: CalendarEvent; onSelect(selected: SelectedEvent): void; hover?: PostHover }) {
  const event = () => props.event;
  return (
    <button
      type="button"
      data-status={event().status}
      data-delivery={event().delivery || undefined}
      data-paused={event().paused || undefined}
      class={cn(chipClass, "pointer-events-auto relative w-full")}
      style={{ ...chipStyle(event().color), height: `${MIN_CHIP_HEIGHT}px` }}
      onPointerEnter={(pointer) => props.hover?.enter(event(), pointer)}
      onPointerLeave={() => props.hover?.leave()}
      onClick={(click) => props.onSelect({ anchor: click.currentTarget.getBoundingClientRect(), event: event() })}
    >
      <PostChipBody event={event()} time={event().allDay ? undefined : event().start} />
    </button>
  );
}

export function MonthBoard(props: MonthBoardProps) {
  let grid!: HTMLDivElement;
  const range = createMemo(() => monthRange(props.nav.date()));
  const month = () => props.nav.date().slice(0, 7);
  const [openDay, setOpenDay] = createSignal<string | null>(null);
  const [cellHeight, setCellHeight] = createSignal(MIN_CELL_HEIGHT);
  const byDay = createMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of range().events) {
      if (!isEventVisible(event)) continue;
      const list = map.get(event.day) ?? [];
      list.push(event);
      map.set(event.day, list);
    }
    return map;
  });

  // Only a move to another date closes the open day: the navigation's clock ticks every half minute without the date changing.
  createEffect(
    on(
      () => props.nav.date(),
      (date, previous) => {
        if (date !== previous) setOpenDay(null);
      },
      { defer: true },
    ),
  );

  onMount(() => {
    // The rows share the grid's height equally, so one measure tells every cell how many posts it has room for.
    const observer = new ResizeObserver(() => setCellHeight(grid.offsetHeight / ROWS));
    observer.observe(grid);

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-month-open], [data-month-more]")) return;
      setOpenDay(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenDay(null);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    onCleanup(() => {
      observer.disconnect();
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    });
  });

  return (
    <section class="min-h-0 flex-1 overflow-auto overscroll-contain">
      <div class="grid min-h-full min-w-[46rem] select-none [grid-template-rows:auto_1fr]">
        <div class="sticky top-0 z-20 grid grid-cols-7 border-y border-(--plane-border-subtle) bg-(--plane-layer-1)">
          <For each={WEEKDAYS()}>
            {(weekday) => (
              <div class="@container flex h-9 items-center border-r border-(--plane-border-subtle) px-2.5 text-xs font-medium text-(--plane-text-tertiary) last:border-r-0">
                <span class="whitespace-nowrap @[4.5rem]:hidden">{weekday.short}</span>
                <span class="hidden whitespace-nowrap @[4.5rem]:inline">{weekday.full}</span>
              </div>
            )}
          </For>
        </div>
        <div ref={grid} class="grid auto-rows-[minmax(8.5rem,1fr)] grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
          <For each={range().days}>
            {(day) => {
              const outside = () => !day.startsWith(month());
              const isToday = () => day === props.nav.today();
              const events = () => sortEvents(byDay().get(day) ?? []);
              const shown = () => events().slice(0, chipsShown(cellHeight(), events().length));
              const remaining = () => events().length - shown().length;
              const expanded = () => openDay() === day;
              const chip = (event: CalendarEvent) => <MonthChip event={event} onSelect={props.onSelect} hover={props.hover} />;

              return (
                <div
                  class={cn(
                    "group relative flex min-w-0 flex-col border-b border-r border-border-strong p-1",
                    !expanded() && "overflow-hidden",
                    isToday() && "bg-(--plane-fill-faint)",
                    outside() && !isToday() && "bg-(--plane-fill-recessed)",
                  )}
                >
                  <button
                    type="button"
                    aria-label={t("View the week of {date}", { date: formatDay(day) })}
                    class="absolute inset-0 z-0 outline-none focus-ring"
                    onClick={() => props.nav.go(day, "week")}
                  />
                  <DayHeading day={day} today={isToday()} outside={outside()} onCreate={() => props.onCreate(day)} />
                  <div class="pointer-events-none relative z-10 space-y-0.5">
                    <For each={shown()}>{chip}</For>
                    <Show when={remaining() > 0}>
                      <button
                        type="button"
                        data-month-more
                        aria-expanded={expanded()}
                        class={cn(moreClass, "pointer-events-auto")}
                        onClick={() => setOpenDay(day)}
                      >
                        {t("{count, plural, one {+# more} other {+# more}}", { count: remaining() })}
                      </button>
                    </Show>
                  </div>
                  {/* The whole day, on a card over the cell, so the rest of its posts don't spill into the next row. */}
                  <Show when={expanded()}>
                    <div
                      data-month-open
                      class="absolute -inset-x-px -top-px z-20 flex min-h-[calc(100%+2px)] flex-col rounded-xl border border-(--plane-border-strong) bg-(--plane-surface-1) p-1"
                    >
                      <DayHeading day={day} today={isToday()} outside={outside()} onCreate={() => props.onCreate(day)} />
                      <div class="space-y-0.5">
                        <For each={events()}>{chip}</For>
                      </div>
                      <button type="button" class={cn(moreClass, "mt-0.5")} onClick={() => setOpenDay(null)}>
                        {t("Show less")}
                      </button>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </section>
  );
}
