/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A day from a month grid and a time from a list. Days and times outside the
// allowed window can't be picked.

import { For, Show, createMemo, createSignal } from "solid-js";

import { cn, formatMonth, getMonthDays, localDateKey, shiftDay, shiftMonth } from "@/components/calendar/utils";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { localized, msg, t } from "@/lib/i18n";

const WEEKDAY_LABELS = [
  msg({ message: "Mo", context: "Monday" }),
  msg({ message: "Tu", context: "Tuesday" }),
  msg({ message: "We", context: "Wednesday" }),
  msg({ message: "Th", context: "Thursday" }),
  msg({ message: "Fr", context: "Friday" }),
  msg({ message: "Sa", context: "Saturday" }),
  msg({ message: "Su", context: "Sunday" }),
];
const DAY_LABEL = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
const SHORT_DAY_LABEL = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }));
const DAY_ARIA = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
const STEP_MINUTES = 15;

const triggerClass =
  "flex h-7 w-full min-w-0 items-center gap-1 rounded-md border border-(--border-input) bg-input pl-0.5 pr-2 text-left text-xs text-foreground transition-colors hover:bg-accent focus-ring data-[expanded]:border-primary disabled:pointer-events-none disabled:opacity-50";

const fromKey = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
};

/** `day`'s date of the month in the month starting `first`, or its last day when shorter. */
function sameDayIn(first: string, day: string) {
  const start = fromKey(first);
  const length = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  return `${first.slice(0, 8)}${String(Math.min(Number(day.slice(8)), length)).padStart(2, "0")}`;
}

function relativeDay(key: string) {
  const today = localDateKey(new Date());
  if (key === today) return t("Today");
  if (key === shiftDay(today, 1)) return t("Tomorrow");
  return null;
}

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
};

const toTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Reads 9, 0930, 9:30, 21.30, 9pm and 9:30 am as a 24-hour `HH:MM`. */
export function parseTime(text: string): string | null {
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a|p)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem.startsWith("p") ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return toTime(hours * 60 + minutes);
}

// ---------------------------------------------------------------------------
// The month grid

type CalendarProps = {
  value: string;
  min?: string;
  max?: string;
  onPick(day: string): void;
};

/** A month of days with paging and arrow keys. `ref` gets a function that focuses the chosen day. */
function MonthCalendar(props: CalendarProps & { ref?: (focus: () => void) => void }) {
  const [month, setMonth] = createSignal(`${props.value.slice(0, 7)}-01`);
  const [focused, setFocused] = createSignal(props.value);
  let grid: HTMLDivElement | undefined;

  const today = () => localDateKey(new Date());
  const allowed = (day: string) => (!props.min || day >= props.min) && (!props.max || day <= props.max);
  const clamp = (day: string) => (props.min && day < props.min ? props.min : props.max && day > props.max ? props.max : day);
  const canGoBack = () => !props.min || month() > `${props.min.slice(0, 7)}-01`;
  const canGoOn = () => !props.max || month() < `${props.max.slice(0, 7)}-01`;

  const focusDay = (day: string) => {
    const next = clamp(day);
    setFocused(next);
    setMonth(`${next.slice(0, 7)}-01`);
    queueMicrotask(() => grid?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  };
  props.ref?.(() => focusDay(props.value));

  const pick = (day: string) => {
    if (allowed(day)) props.onPick(day);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(focused());
      return;
    }
    const weekday = (fromKey(focused()).getDay() + 6) % 7;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => shiftDay(focused(), -1),
      ArrowRight: () => shiftDay(focused(), 1),
      ArrowUp: () => shiftDay(focused(), -7),
      ArrowDown: () => shiftDay(focused(), 7),
      PageUp: () => sameDayIn(shiftMonth(focused(), -1), focused()),
      PageDown: () => sameDayIn(shiftMonth(focused(), 1), focused()),
      Home: () => shiftDay(focused(), -weekday),
      End: () => shiftDay(focused(), 6 - weekday),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    focusDay(move());
  };

  const shortcuts = () =>
    [
      { label: t("Today"), day: today() },
      { label: t("Tomorrow"), day: shiftDay(today(), 1) },
      { label: t("In a week"), day: shiftDay(today(), 7) },
    ].filter((item) => allowed(item.day));

  return (
    <div class="flex w-[17.5rem] flex-col">
      <div class="flex items-center gap-1 px-3 pt-3 pb-2">
        <span class="flex-1 pl-1 text-xs font-medium text-foreground">{formatMonth(month())}</span>
        <button
          type="button"
          aria-label={t("Previous month")}
          disabled={!canGoBack()}
          class="grid size-7 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-30"
          onClick={() => setMonth((value) => shiftMonth(value, -1))}
        >
          <Icon name="chevron-left" class="size-5" />
        </button>
        <button
          type="button"
          aria-label={t("Next month")}
          disabled={!canGoOn()}
          class="grid size-7 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-30"
          onClick={() => setMonth((value) => shiftMonth(value, 1))}
        >
          <Icon name="chevron-right" class="size-5" />
        </button>
      </div>

      <div class="px-3">
        <div class="grid grid-cols-7 pb-1 text-center text-[11px] text-muted-foreground">
          <For each={WEEKDAY_LABELS}>{(label) => <span>{t(label)}</span>}</For>
        </div>
        <div ref={grid} role="grid" aria-label={formatMonth(month())} class="grid grid-cols-7 gap-0.5" onKeyDown={onKeyDown}>
          <For each={getMonthDays(month())}>
            {(day) => {
              const outside = () => day.slice(0, 7) !== month().slice(0, 7);
              const selected = () => day === props.value;
              return (
                <button
                  type="button"
                  role="gridcell"
                  data-day={day}
                  aria-label={DAY_ARIA().format(fromKey(day))}
                  aria-selected={selected()}
                  tabIndex={day === focused() ? 0 : -1}
                  disabled={!allowed(day)}
                  class={cn(
                    "relative grid h-8 place-items-center rounded-md text-xs tabular-nums press focus-ring disabled:pointer-events-none",
                    selected() && "bg-primary font-medium text-primary-foreground",
                    !selected() && "text-foreground hover:bg-accent",
                    !selected() && outside() && "text-muted-foreground/60",
                    !allowed(day) && "text-muted-foreground/25",
                  )}
                  onClick={() => pick(day)}
                  onFocus={() => setFocused(day)}
                >
                  {Number(day.slice(-2))}
                  <Show when={day === today()}>
                    <span
                      class={cn(
                        "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
                        selected() ? "bg-primary-foreground" : "bg-primary",
                      )}
                    />
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      <div class="mt-2 flex h-10 items-center gap-1 border-t border-border-strong px-3">
        <For each={shortcuts()}>
          {(item) => (
            <button
              type="button"
              class="h-6 rounded-md px-2 text-xs text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring"
              onClick={() => pick(item.day)}
            >
              {item.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The time list

type TimeListProps = {
  value: string;
  min?: string;
  onPick(time: string): void;
  class?: string;
};

/** A typed time on top, and every quarter hour below. `ref` gets a function that focuses the field and scrolls to the chosen time. */
function TimeList(props: TimeListProps & { ref?: (show: () => void) => void }) {
  const [draft, setDraft] = createSignal("");
  let list: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;

  const slots = createMemo(() => {
    const times = Array.from({ length: (24 * 60) / STEP_MINUTES }, (_, index) => toTime(index * STEP_MINUTES));
    return times.includes(props.value) ? times : [...times, props.value].sort();
  });
  const allowed = (time: string) => !props.min || time >= props.min;
  const typed = () => parseTime(draft());
  const typedProblem = () => {
    if (!draft().trim()) return null;
    const time = typed();
    if (!time) return t("Type a time like 18:30 or 6:30pm");
    if (!allowed(time)) return t("That time has passed");
    return null;
  };

  const pick = (time: string) => {
    if (!allowed(time)) return;
    setDraft("");
    props.onPick(time);
  };

  props.ref?.(() => {
    setDraft("");
    // Deferred, as the day grid's focus is: called while the popover opens, a
    // focus now lands before Kobalte has registered the popover as nested in the
    // one that holds the trigger (New post's When popup), which then takes it
    // for a focus outside itself and closes.
    queueMicrotask(() => input?.focus());
    requestAnimationFrame(() => {
      const target = toMinutes(props.value);
      const nearest = slots().reduce((best, time) =>
        Math.abs(toMinutes(time) - target) < Math.abs(toMinutes(best) - target) ? time : best,
      );
      const row = list?.querySelector<HTMLElement>(`[data-time="${nearest}"]`);
      if (row && list) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
    });
  });

  return (
    <div class={cn("flex w-44 flex-col", props.class)}>
      <div class="border-b border-border-strong p-2">
        <input
          ref={input}
          aria-label={t("Type a time")}
          placeholder={props.value}
          value={draft()}
          class="h-7 w-full rounded-md border border-(--border-input) bg-input px-2 text-xs tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key !== "Enter") return;
            event.preventDefault();
            const time = typed();
            if (time) pick(time);
          }}
        />
        <Show when={typedProblem()}>
          <p class="mt-1 px-0.5 text-[11px] leading-3 text-destructive">{typedProblem()}</p>
        </Show>
      </div>
      <div ref={list} role="listbox" aria-label={t("Times")} class="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        <For each={slots()}>
          {(time) => {
            const selected = () => time === props.value;
            return (
              <button
                type="button"
                role="option"
                data-time={time}
                aria-selected={selected()}
                disabled={!allowed(time)}
                class={cn(
                  "flex h-7 w-full shrink-0 items-center justify-between rounded-md px-2 text-xs tabular-nums transition-colors focus-ring disabled:pointer-events-none disabled:text-muted-foreground/30",
                  selected() ? "bg-primary/15 text-foreground" : "text-foreground hover:bg-accent",
                  typed() === time && !selected() && "bg-accent",
                )}
                onClick={() => pick(time)}
              >
                {time}
                <Show when={selected()}>
                  <Icon name="confirm-check" class="size-4 scale-[2.4] text-primary" />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pickers

/** A day, `YYYY-MM-DD`, between `min` and `max` when given. With a `placeholder`, `""` is no day yet. */
export function DatePicker(props: {
  value: string;
  min?: string;
  max?: string;
  onChange(day: string): void;
  label?: string;
  placeholder?: string;
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  let focusSelected: (() => void) | undefined;
  const day = () => props.value || localDateKey(new Date());

  return (
    <Popover placement="bottom-start" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger type="button" aria-label={props.label} class={cn(triggerClass, props.class)}>
        <Icon name="calendar" class="size-6 shrink-0 text-muted-foreground" />
        <Show when={props.value} fallback={<span class="min-w-0 flex-1 truncate text-muted-foreground">{props.placeholder}</span>}>
          <span class="min-w-0 flex-1 truncate">{DAY_LABEL().format(fromKey(props.value))}</span>
        </Show>
        <Show when={props.value && relativeDay(props.value)}>
          {(label) => <span class="shrink-0 text-xs text-muted-foreground">{label()}</span>}
        </Show>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          data-calendar-keep-popup
          class="z-[10000] w-auto rounded-xl border-white/10 p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            focusSelected?.();
          }}
        >
          <MonthCalendar
            ref={(focus) => (focusSelected = focus)}
            value={day()}
            min={props.min}
            max={props.max}
            onPick={(picked) => {
              props.onChange(picked);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

/** A time of day, `HH:MM`. Times before `min`, when given, can't be picked. */
export function TimePicker(props: {
  value: string;
  min?: string;
  zone?: string;
  disabled?: boolean;
  label?: string;
  onChange(time: string): void;
}) {
  const [open, setOpen] = createSignal(false);
  let show: (() => void) | undefined;

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger type="button" aria-label={props.label} disabled={props.disabled} class={triggerClass}>
        <Icon name="clock" class="size-6 shrink-0 text-muted-foreground" />
        <span class="flex-1 tabular-nums">{props.value}</span>
        <Show when={props.zone}>
          <span class="truncate text-xs text-muted-foreground">{props.zone}</span>
        </Show>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          data-calendar-keep-popup
          class="z-[10000] w-auto rounded-xl border-white/10 p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            show?.();
          }}
        >
          <TimeList
            ref={(fn) => (show = fn)}
            class="max-h-72"
            value={props.value}
            min={props.min}
            onPick={(time) => {
              props.onChange(time);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

/**
 * A day and a time in one field, for tight spaces. The calendar and the time
 * list sit side by side; picking a day keeps it open for the time.
 */
export function DateTimePicker(props: {
  day: string;
  time: string;
  minDay?: string;
  maxDay?: string;
  /** The earliest time on `day`, if any. */
  minTime?: (day: string) => string | undefined;
  label?: string;
  class?: string;
  onChange(day: string, time: string): void;
}) {
  const [open, setOpen] = createSignal(false);
  let focusDay: (() => void) | undefined;
  let showTime: (() => void) | undefined;

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={setOpen}>
      <PopoverTrigger type="button" aria-label={props.label} class={cn(triggerClass, props.class)}>
        <Icon name="calendar" class="size-6 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">
          {relativeDay(props.day) ?? SHORT_DAY_LABEL().format(fromKey(props.day))}
          <span class="text-muted-foreground">, </span>
          <span class="tabular-nums">{props.time}</span>
        </span>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          data-calendar-keep-popup
          class="z-[10000] flex w-auto overflow-hidden rounded-xl border-white/10 p-0"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            showTime?.();
            focusDay?.();
          }}
        >
          <MonthCalendar
            ref={(focus) => (focusDay = focus)}
            value={props.day}
            min={props.minDay}
            max={props.maxDay}
            onPick={(day) => {
              const earliest = props.minTime?.(day);
              props.onChange(day, earliest && props.time < earliest ? earliest : props.time);
            }}
          />
          <TimeList
            ref={(fn) => (showTime = fn)}
            class="h-[19.5rem] border-l border-border-strong"
            value={props.time}
            min={props.minTime?.(props.day)}
            onPick={(time) => {
              props.onChange(props.day, time);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
