/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { toast } from "somoto";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { t } from "@/lib/i18n";
import type { PostHover } from "./post-hover-card";
import { PostChipBody, chipClass, moreClass, thumbHeight } from "./post-chip";
import type { CalendarNavigation } from "./navigation";
import { isEventVisible, moveEvent, resizeEvent, weekRange } from "./store";
import {
  DEFAULT_SCROLL_TOP,
  END_MINUTES,
  GRID_HEIGHT,
  HOUR_HEIGHT,
  HOURS,
  MIDNIGHT_LINE,
  MIN_CHIP_HEIGHT,
  SNAP_MINUTES,
  START_MINUTES,
  calendarDayFromGridDay,
  chipStyle,
  cn,
  displayMinutes,
  eventHeight,
  eventStartMinutes,
  formatDay,
  formatDayParts,
  gridDayFromCalendarDay,
  minutesToTime,
  packDay,
  shiftDay,
  snapMinutes,
  timeRangeLabel,
  topFor,
} from "./utils";
import type { CalendarEvent, SelectedEvent } from "./types";

type DragMove = { day: string; id: string; startMin: number };
type MoveOrigin = {
  day: string;
  duration: number;
  grabOffsetMin: number;
  id: string;
  moved: boolean;
  pointerId: number;
  sourceId: string;
  start: string;
  x0: number;
  y0: number;
};
type ResizeState = { endMin: number; initialDuration: number; pointerId: number; sourceId: string; startMin: number };

const TALL_CHIP = 56;

function titleLines(height: number) {
  return Math.max(1, Math.min(4, Math.floor((height - 26) / 16)));
}

type Quarter = { day: string; at: number };

type WeekBoardProps = {
  nav: CalendarNavigation;
  onCreate(day: string, time?: string): void;
  onSelect(selected: SelectedEvent): void;
  hover?: PostHover;
};

export function WeekBoard(props: WeekBoardProps) {
  let scroller!: HTMLElement;
  let body!: HTMLDivElement;

  const range = createMemo(() => weekRange(props.nav.date()));
  const days = () => range().days;
  const visible = createMemo(() => range().events.filter(isEventVisible));
  const today = () => props.nav.today();
  const nowMinutes = () => props.nav.nowMinutes();
  // The grid's day runs 06:00 to 06:00. Before 06:00, "now" is on yesterday's column.
  const nowGridDay = () => (nowMinutes() < START_MINUTES ? shiftDay(today(), -1) : today());

  const [dragMove, setDragMove] = createSignal<DragMove | null>(null);
  const [resize, setResize] = createSignal<ResizeState | null>(null);
  const [allDayOpen, setAllDayOpen] = createSignal(false);
  const [pointed, setPointed] = createSignal<Quarter | null>(null, { equals: (a, b) => a?.day === b?.day && a?.at === b?.at });

  let moveOrigin: MoveOrigin | null = null;
  let resizeColumnTop = 0;
  let suppressClick = false;
  let stopMoveListeners = () => {};
  onCleanup(() => stopMoveListeners());

  createEffect(
    on(
      () => days()[0],
      () => {
        scroller.scrollTop = DEFAULT_SCROLL_TOP;
      },
    ),
  );

  const effectiveDay = (event: CalendarEvent) => {
    if (event.allDay) return event.day;
    const drag = dragMove();
    if (drag?.id === event.id) return gridDayFromCalendarDay(drag.day, drag.startMin);
    return gridDayFromCalendarDay(event.day, eventStartMinutes(event.start));
  };

  const allDayByDay = createMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of days()) map.set(day, []);
    for (const event of visible()) if (event.allDay) map.get(event.day)?.push(event);
    return map;
  });

  const gridTemplate = "var(--calendar-time-width) repeat(7, minmax(var(--calendar-day-width), 1fr))";

  const dayIndexAt = (clientX: number) => {
    const rect = body.getBoundingClientRect();
    const gutter = (body.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 56;
    const width = (rect.width - gutter) / 7;
    return Math.max(0, Math.min(6, Math.floor((clientX - rect.left - gutter) / width)));
  };
  const minutesAt = (clientY: number) => START_MINUTES + ((clientY - body.getBoundingClientRect().top) / HOUR_HEIGHT) * 60;

  const moveTarget = (origin: MoveOrigin, event: PointerEvent): DragMove => {
    const gridDay = days()[dayIndexAt(event.clientX)];
    const snapped = Math.round((minutesAt(event.clientY) - origin.grabOffsetMin) / SNAP_MINUTES) * SNAP_MINUTES;
    const startMin = Math.max(START_MINUTES, Math.min(END_MINUTES - origin.duration, snapped));
    return { day: calendarDayFromGridDay(gridDay, startMin), id: origin.id, startMin };
  };

  const onMoveMove = (event: PointerEvent) => {
    const origin = moveOrigin;
    if (!origin || origin.pointerId !== event.pointerId) return;
    if (!origin.moved) {
      if (Math.abs(event.clientX - origin.x0) < 4 && Math.abs(event.clientY - origin.y0) < 4) return;
      origin.moved = true;
    }
    setDragMove(moveTarget(origin, event));
  };

  const onMoveUp = (event: PointerEvent) => {
    const origin = moveOrigin;
    if (!origin || origin.pointerId !== event.pointerId) return;
    moveOrigin = null;
    stopMoveListeners();
    const target = origin.moved ? moveTarget(origin, event) : null;
    setDragMove(null);
    if (!target) return;

    suppressClick = true;
    window.setTimeout(() => (suppressClick = false), 120);
    const start = minutesToTime(target.startMin);
    if (target.day === origin.day && start === origin.start) return;
    const failure = moveEvent({ day: target.day, from: origin.day, sourceId: origin.sourceId, start });
    if (failure) toast.error(t(failure));
  };

  const onMoveCancel = (event: PointerEvent) => {
    if (moveOrigin?.pointerId !== event.pointerId) return;
    moveOrigin = null;
    stopMoveListeners();
    setDragMove(null);
  };

  const startMove = (calendarEvent: CalendarEvent, event: PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-resize-handle]")) return;
    event.stopPropagation();
    if (calendarEvent.status === "posted") return;
    moveOrigin = {
      day: calendarEvent.day,
      duration: calendarEvent.duration,
      grabOffsetMin: minutesAt(event.clientY) - eventStartMinutes(calendarEvent.start),
      id: calendarEvent.id,
      moved: false,
      pointerId: event.pointerId,
      sourceId: calendarEvent.sourceId,
      start: calendarEvent.start,
      x0: event.clientX,
      y0: event.clientY,
    };
    stopMoveListeners();
    window.addEventListener("pointermove", onMoveMove);
    window.addEventListener("pointerup", onMoveUp);
    window.addEventListener("pointercancel", onMoveCancel);
    stopMoveListeners = () => {
      window.removeEventListener("pointermove", onMoveMove);
      window.removeEventListener("pointerup", onMoveUp);
      window.removeEventListener("pointercancel", onMoveCancel);
    };
  };

  const resizeTarget = (active: ResizeState, event: PointerEvent) => ({
    ...active,
    endMin: Math.max(active.startMin + SNAP_MINUTES, snapMinutes(event.clientY, resizeColumnTop)),
  });

  const startResize = (calendarEvent: CalendarEvent, event: PointerEvent & { currentTarget: HTMLElement }) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    resizeColumnTop = event.currentTarget.closest("[data-day-column]")?.getBoundingClientRect().top ?? 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startMin = eventStartMinutes(calendarEvent.start);
    setResize({
      endMin: startMin + calendarEvent.duration,
      initialDuration: calendarEvent.duration,
      pointerId: event.pointerId,
      sourceId: calendarEvent.sourceId,
      startMin,
    });
  };

  const onResizeMove = (event: PointerEvent) => {
    const active = resize();
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    setResize(resizeTarget(active, event));
  };

  const onResizeUp = (event: PointerEvent) => {
    const active = resize();
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const target = resizeTarget(active, event);
    setResize(null);
    suppressClick = true;
    window.setTimeout(() => (suppressClick = false), 120);
    const duration = target.endMin - target.startMin;
    if (duration === target.initialDuration) return;
    const failure = resizeEvent(target.sourceId, duration);
    if (failure) toast.error(t(failure));
  };

  const onResizeCancel = (event: PointerEvent) => {
    if (resize()?.pointerId === event.pointerId) setResize(null);
  };

  const select = (event: CalendarEvent, element: HTMLElement) => {
    if (suppressClick) return;
    props.onSelect({ anchor: element.getBoundingClientRect(), event });
  };

  return (
    <section
      ref={scroller}
      data-calendar-scroll
      class="min-h-0 flex-1 overflow-auto overscroll-contain [overflow-anchor:none]"
    >
      <div class="relative grid min-w-(--calendar-grid-width) select-none [--calendar-day-width:6.5rem] [--calendar-grid-width:calc(var(--calendar-time-width)+7*var(--calendar-day-width))] [--calendar-time-width:3.5rem] [grid-template-rows:auto_auto_auto]">
        <div class="sticky top-0 z-30 col-start-1 row-start-1 grid border-y border-(--plane-border-subtle) bg-(--plane-layer-1)" style={{ "grid-template-columns": gridTemplate }}>
          <div class="border-r border-border-strong" />
          <For each={days()}>
            {(day) => {
              const parts = () => formatDayParts(day);
              const isToday = () => day === today();
              return (
                <div class={cn("group flex h-12 items-center gap-2 border-r border-border-strong px-2.5", isToday() && "bg-(--plane-fill-faint)")}>
                  <span class={cn("whitespace-nowrap text-xs", isToday() ? "text-foreground" : "text-muted-foreground")}>
                    {parts().weekdayShort}
                  </span>
                  <span
                    class={cn(
                      "grid h-6 min-w-6 place-items-center rounded-md px-1 text-sm font-medium tabular-nums",
                      isToday() ? "bg-primary text-primary-foreground" : "text-foreground",
                    )}
                  >
                    {parts().day}
                  </span>
                  <button
                    type="button"
                    aria-label={t("Add a post on {date}", { date: formatDay(day) })}
                    class="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 press hover:bg-accent hover:text-foreground focus-ring focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => props.onCreate(day)}
                  >
                    <Icon name="plus-add-small" class="size-5" />
                  </button>
                </div>
              );
            }}
          </For>
        </div>

        <div class="sticky top-12 z-30 col-start-1 row-start-2 grid min-h-8 border-b border-border-strong bg-background" style={{ "grid-template-columns": gridTemplate }}>
          <div class="border-r border-border-strong pr-2 pt-[11px] text-right text-xs leading-none text-muted-foreground">{t("No time")}</div>
          <For each={days()}>
            {(day) => {
              const events = () => allDayByDay().get(day) ?? [];
              const shown = () => (allDayOpen() ? events() : events().slice(0, 1));
              const hidden = () => events().length - shown().length;
              return (
                <div class={cn("flex min-w-0 flex-col gap-0.5 border-r border-border-strong p-1", day === today() && "bg-(--plane-fill-faint)")}>
                  <For each={shown()}>
                    {(event) => (
                      <button
                        type="button"
                        data-status={event.status}
                        data-delivery={event.delivery || undefined}
                        data-paused={event.paused || undefined}
                        class={cn(chipClass, "relative w-full")}
                        style={{ ...chipStyle(event.color), height: `${MIN_CHIP_HEIGHT}px` }}
                        onPointerEnter={(pointer) => props.hover?.enter(event, pointer)}
                        onPointerLeave={() => props.hover?.leave()}
                        onClick={(click) => select(event, click.currentTarget)}
                      >
                        <PostChipBody event={event} />
                      </button>
                    )}
                  </For>
                  <Show when={hidden() > 0}>
                    <button type="button" class={moreClass} onClick={() => setAllDayOpen(true)}>
                      {t("{count, plural, one {+# more} other {+# more}}", { count: hidden() })}
                    </button>
                  </Show>
                  <Show when={allDayOpen() && events().length > 1}>
                    <button type="button" class={moreClass} onClick={() => setAllDayOpen(false)}>
                      {t("Show less")}
                    </button>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>

        <div ref={body} class="relative col-start-1 row-start-3 grid" style={{ "grid-template-columns": gridTemplate }}>
          <div class="border-r border-border-strong">
            <Index each={HOURS}>
              {(hour) => (
                <div class={cn("relative pr-2 text-right", hour() === 0 && "border-t border-border-strong")} style={{ height: `${HOUR_HEIGHT}px` }}>
                  <span class="absolute right-2 top-1 text-xs tabular-nums text-muted-foreground">
                    {String(hour()).padStart(2, "0")}:00
                  </span>
                </div>
              )}
            </Index>
          </div>
          <For each={days()}>
            {(day) => {
              const showNow = () => day === nowGridDay();
              const dayEvents = () => visible().filter((event) => !event.allDay && effectiveDay(event) === day);
              const layout = createMemo(() =>
                packDay(
                  dayEvents().map((event) => {
                    const drag = dragMove();
                    if (drag?.id === event.id) return { ...event, start: minutesToTime(drag.startMin) };
                    const active = resize();
                    if (active?.sourceId === event.sourceId) return { ...event, duration: active.endMin - active.startMin };
                    return event;
                  }),
                ),
              );
              const nextDay = () => formatDayParts(shiftDay(day, 1));
              const now = () => (day < nowGridDay() ? Infinity : day > nowGridDay() ? -Infinity : displayMinutes(nowMinutes()));
              /** As drawn: a chip is never shorter than its least height. */
              const taken = createMemo(() =>
                dayEvents().map((event) => {
                  const start = eventStartMinutes(event.start);
                  return { start, end: start + (eventHeight(event.duration) / HOUR_HEIGHT) * 60 };
                }),
              );
              const free = (at: number) => at > now() && at < END_MINUTES && !taken().some((span) => span.start < at + SNAP_MINUTES && span.end > at);
              const slot = () => {
                const quarter = pointed();
                return quarter?.day === day && free(quarter.at) ? quarter.at : null;
              };
              /** None over a post, or for a press that began on one: that release clicks the column itself. */
              const quarterAt = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
                const target = event.target as HTMLElement;
                if (target === event.currentTarget || target.closest("[data-event-chip]")) return null;
                const minutes = ((event.clientY - event.currentTarget.getBoundingClientRect().top) / HOUR_HEIGHT) * 60;
                return START_MINUTES + Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
              };

              return (
                <div
                  data-day-column
                  class={cn("relative border-r border-border-strong", day === today() && "bg-(--plane-fill-faint)")}
                  style={{ height: `${GRID_HEIGHT}px` }}
                  onPointerMove={(event) => {
                    const at = moveOrigin || resize() ? null : quarterAt(event);
                    setPointed(at === null ? null : { day, at });
                  }}
                  onPointerLeave={() => setPointed(null)}
                  onClick={(event) => {
                    const at = quarterAt(event);
                    if (at !== null && free(at)) props.onCreate(calendarDayFromGridDay(day, at), minutesToTime(at));
                  }}
                >
                  <Index each={HOURS}>
                    {(hour) => (
                      <div
                        class={cn("border-border", hour() !== (START_MINUTES / 60 + 23) % 24 && "border-b", hour() === 0 && "border-t border-t-border-strong")}
                        style={{ height: `${HOUR_HEIGHT}px` }}
                      />
                    )}
                  </Index>
                  <Show when={slot()}>
                    {(at) => (
                      <span
                        aria-hidden="true"
                        class="pointer-events-none absolute inset-x-0.5 flex items-center gap-0.5 rounded-md bg-(--plane-layer-transparent-hover) pr-1.5 pl-0.5 text-xxs leading-none text-(--plane-text-tertiary)"
                        style={{ height: `${(SNAP_MINUTES / 60) * HOUR_HEIGHT - 2}px`, top: `${topFor(at())}px` }}
                      >
                        <Icon name="plus-add-small" class="size-3.5" />
                        <span class="tabular-nums">{minutesToTime(at())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={showNow() && topFor(nowMinutes()) > 0}>
                    <div
                      aria-hidden="true"
                      class="pointer-events-none absolute inset-x-0 top-0 z-[1] bg-(--plane-fill-faint)"
                      style={{ height: `${topFor(nowMinutes())}px` }}
                    />
                  </Show>
                  <Show when={showNow()}>
                    <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 z-20" style={{ top: `${topFor(nowMinutes())}px` }}>
                      <div class="relative h-px bg-primary/70">
                        <span class="cal-now-dot absolute -left-1 -top-[3px] size-[7px] rounded-full bg-primary" />
                      </div>
                    </div>
                  </Show>
                  <span
                    aria-label={t("Next day, {date}", { date: formatDay(shiftDay(day, 1)) })}
                    class="pointer-events-none absolute left-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border-strong bg-background px-1.5 py-0.5 text-xs font-medium uppercase leading-none text-muted-foreground"
                    style={{ top: `${MIDNIGHT_LINE}px` }}
                  >
                    {nextDay().weekdayShort} {nextDay().day}
                  </span>
                  <div class="pointer-events-none absolute inset-0 z-10">
                    <For each={dayEvents()}>
                      {(event) => {
                        const isDragging = () => dragMove()?.id === event.id;
                        const activeResize = () => (resize()?.sourceId === event.sourceId ? resize() : null);
                        const startMin = () => {
                          const drag = dragMove();
                          return drag?.id === event.id ? drag.startMin : eventStartMinutes(event.start);
                        };
                        const duration = () => {
                          const active = activeResize();
                          return active ? active.endMin - active.startMin : event.duration;
                        };
                        const height = () => Math.max(0, Math.min(eventHeight(duration()), GRID_HEIGHT - topFor(startMin())));
                        const place = () => layout().get(event.id) ?? { col: 0, cols: 1 };
                        const tall = () => height() >= TALL_CHIP;
                        const lines = () => (tall() ? titleLines(height()) : 1);
                        const timeLabel = () => (tall() ? timeRangeLabel(startMin(), duration(), true) : minutesToTime(startMin()));

                        return (
                          <button
                            type="button"
                            data-event-chip
                            data-status={event.status}
                            data-delivery={event.delivery || undefined}
                            data-paused={event.paused || undefined}
                            class={cn(
                              chipClass,
                              "group pointer-events-auto absolute touch-none",
                              isDragging() || activeResize()
                                ? "z-30 cursor-grabbing shadow-(--plane-shadow-overlay-200)"
                                : cn("z-10 hover:z-20", event.status === "posted" ? "cursor-pointer" : "cursor-grab"),
                            )}
                            style={{
                              ...chipStyle(event.color),
                              height: `${height()}px`,
                              left: `calc(${(place().col * 100) / place().cols}% + 2px)`,
                              top: `${topFor(startMin())}px`,
                              width: `calc(${100 / place().cols}% - 4px)`,
                            }}
                            onPointerDown={(pointer) => startMove(event, pointer)}
                            onPointerEnter={(pointer) => props.hover?.enter(event, pointer)}
                            onPointerLeave={() => props.hover?.leave()}
                            onClick={(click) => select(event, click.currentTarget)}
                          >
                            <PostChipBody event={event} time={timeLabel()} lines={lines()} thumb={thumbHeight(height())} top={tall()} />
                            <Show when={event.status !== "posted"}>
                              <span
                                data-event-chip
                                data-resize-handle
                                class="absolute inset-x-0 bottom-0 z-10 flex h-2 cursor-ns-resize touch-none items-end justify-center pb-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                                onClick={(click) => click.stopPropagation()}
                                onPointerDown={(pointer) => startResize(event, pointer)}
                                onPointerMove={onResizeMove}
                                onPointerUp={onResizeUp}
                                onPointerCancel={onResizeCancel}
                                onLostPointerCapture={onResizeCancel}
                              >
                                <span class="h-0.5 w-6 rounded-full bg-current opacity-40" />
                              </span>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </section>
  );
}
