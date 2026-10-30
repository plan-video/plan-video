/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";

import { cn, dateFromKey, formatMonth, getMonthDays, shiftMonth } from "@/components/calendar/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { localized, msg, rich, t } from "@/lib/i18n";
import { DAY_MS, HISTORY_DAYS, dayKeyOf, startOfDayKey, type Span } from "@/lib/social-analytics";
import { zonedParts, zonedTime } from "@/lib/time-zone";

export type RangePreset = "today" | "7d" | "28d" | "90d" | "12m" | "month" | "last-month" | "year" | "all";
export type AnalyticsRange = { preset: RangePreset } | { preset: "custom"; from: string; to: string };

const PRESETS: readonly { id: RangePreset; label: string; compare: string }[] = [
  { id: "today", label: msg("Today"), compare: msg("Compared with the same length of time before") },
  { id: "7d", label: msg("Last 7 days"), compare: msg("Compared with the 7 days before") },
  { id: "28d", label: msg("Last 28 days"), compare: msg("Compared with the 28 days before") },
  { id: "90d", label: msg("Last 90 days"), compare: msg("Compared with the 90 days before") },
  { id: "12m", label: msg("Last 12 months"), compare: msg("Compared with the 12 months before") },
  { id: "month", label: msg("This month"), compare: msg("Compared with the same length of time before") },
  { id: "last-month", label: msg("Last month"), compare: msg("Compared with the month before") },
  { id: "year", label: msg("This year"), compare: msg("Compared with the same length of time before") },
  { id: "all", label: msg("All time"), compare: msg("Compared with the same length of time before") },
];

/** Monday first, a letter or so each (2024-01-01 was a Monday). */
const WEEKDAY_LABELS = localized((locale) => {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, index) => weekday.format(Date.UTC(2024, 0, 1 + index)));
}, "en");
// Day keys name a calendar day, so they format in UTC whatever the zone.
const dayFormat = localized((locale) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }), "en");
const dayYearFormat = localized((locale) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }), "en");

function midnight(time: number, offsetDays = 0) {
  const date = zonedParts(time);
  return zonedTime(date.year, date.month, date.date + offsetDays);
}

/** The moments a range covers, as of `now`. */
export function resolveRange(range: AnalyticsRange, now = Date.now()): Span {
  const date = zonedParts(now);
  switch (range.preset) {
    case "today":
      return { start: midnight(now), end: now };
    case "7d":
      return { start: midnight(now, -6), end: now };
    case "28d":
      return { start: midnight(now, -27), end: now };
    case "90d":
      return { start: midnight(now, -89), end: now };
    case "12m":
      return { start: zonedTime(date.year - 1, date.month, date.date + 1), end: now };
    case "month":
      return { start: zonedTime(date.year, date.month, 1), end: now };
    case "last-month":
      return {
        start: zonedTime(date.year, date.month - 1, 1),
        end: zonedTime(date.year, date.month, 1),
      };
    case "year":
      return { start: zonedTime(date.year, 0, 1), end: now };
    case "all":
      return { start: midnight(now, -HISTORY_DAYS), end: now };
    case "custom":
      return { start: startOfDayKey(range.from), end: Math.min(now, startOfDayKey(range.to) + DAY_MS) };
  }
}

function formatDayKey(key: string, withYear: boolean) {
  return (withYear ? dayYearFormat : dayFormat)().format(dateFromKey(key));
}

function customLabel(from: string, to: string) {
  const thisYear = dayKeyOf(Date.now()).slice(0, 4);
  const withYear = from.slice(0, 4) !== thisYear || to.slice(0, 4) !== thisYear;
  return from === to ? formatDayKey(from, withYear) : `${formatDayKey(from, withYear)} – ${formatDayKey(to, withYear)}`;
}

export function rangeLabel(range: AnalyticsRange) {
  if (range.preset === "custom") return customLabel(range.from, range.to);
  return t(PRESETS.find((item) => item.id === range.preset)!.label);
}

/** What the change figures are measured against. */
export function compareLabel(range: AnalyticsRange) {
  if (range.preset === "custom") return t("Compared with the same length of time before");
  return t(PRESETS.find((item) => item.id === range.preset)!.compare);
}

export function AnalyticsRangePicker(props: { value: AnalyticsRange; onChange(range: AnalyticsRange): void }) {
  const [open, setOpen] = createSignal(false);
  const [from, setFrom] = createSignal<string | null>(null);
  const [to, setTo] = createSignal<string | null>(null);
  const [hover, setHover] = createSignal<string | null>(null);
  const [month, setMonth] = createSignal("");

  const today = () => dayKeyOf(Date.now());
  const earliest = () => dayKeyOf(midnight(Date.now(), -HISTORY_DAYS));

  const openChange = (next: boolean) => {
    if (next) {
      const span = resolveRange(props.value);
      const start = dayKeyOf(span.start);
      const end = dayKeyOf(span.end - 1);
      setFrom(start);
      setTo(end);
      setHover(null);
      setMonth(shiftMonth(`${end.slice(0, 7)}-01`, -1));
    }
    setOpen(next);
  };

  const pickPreset = (preset: RangePreset) => {
    props.onChange({ preset });
    setOpen(false);
  };

  const pickDay = (day: string) => {
    const start = from();
    if (!start || to()) {
      setFrom(day);
      setTo(null);
      return;
    }
    if (day < start) {
      setFrom(day);
      setTo(start);
    } else {
      setTo(day);
    }
  };

  const bounds = createMemo(() => {
    const start = from();
    const end = to() ?? hover();
    if (!start) return null;
    if (!end) return { start, end: start };
    return start <= end ? { start, end } : { start: end, end: start };
  });

  const apply = () => {
    const range = bounds();
    if (!range || !to()) return;
    props.onChange({ preset: "custom", from: range.start, to: range.end });
    setOpen(false);
  };

  const latestMonth = () => `${today().slice(0, 7)}-01`;
  const earliestMonth = () => `${earliest().slice(0, 7)}-01`;
  const months = () => [month(), shiftMonth(month(), 1)];

  return (
    <Popover placement="bottom-end" open={open()} onOpenChange={openChange}>
      <PopoverTrigger
        type="button"
        class={cn(
          "flex h-7 shrink-0 items-center gap-1 rounded-md border border-(--border-input) bg-input pl-1 pr-1.5 text-xs text-foreground press hover:bg-accent focus-ring",
          open() && "border-primary",
        )}
      >
        <Icon name="calendar" class="size-5 text-muted-foreground" />
        <span class="cap-centered whitespace-nowrap">{rangeLabel(props.value)}</span>
        <Icon name="chevron-down" class="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="flex w-auto overflow-hidden rounded-xl border-(--plane-border-strong) p-0">
          <div class="flex w-40 shrink-0 flex-col gap-px border-r border-border-strong p-1.5">
            <For each={PRESETS}>
              {(item) => {
                const active = () => props.value.preset === item.id;
                return (
                  <button
                    type="button"
                    class={cn(
                      "flex h-7 items-center justify-between rounded-md px-2 text-left text-xs transition-colors focus-ring",
                      active() ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => pickPreset(item.id)}
                  >
                    {t(item.label)}
                    <Show when={active()}>
                      <Icon name="confirm-check" class="size-4 text-primary" />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>

          <div class="flex flex-col">
            <div class="flex gap-5 p-3">
              <For each={months()}>
                {(shown, index) => (
                  <div class="w-56">
                    <div class="mb-1.5 flex h-6 items-center">
                      <Show when={index() === 0} fallback={<span class="size-6" />}>
                        <button
                          type="button"
                          aria-label={t("Previous month")}
                          disabled={month() <= earliestMonth()}
                          class="grid size-6 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => setMonth((value) => shiftMonth(value, -1))}
                        >
                          <Icon name="chevron-left" class="size-5" />
                        </button>
                      </Show>
                      <span class="flex-1 text-center text-xs font-medium text-foreground">{formatMonth(shown)}</span>
                      <Show when={index() === 1} fallback={<span class="size-6" />}>
                        <button
                          type="button"
                          aria-label={t("Next month")}
                          disabled={shiftMonth(month(), 1) >= latestMonth()}
                          class="grid size-6 place-items-center rounded-md text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => setMonth((value) => shiftMonth(value, 1))}
                        >
                          <Icon name="chevron-right" class="size-5" />
                        </button>
                      </Show>
                    </div>
                    <div class="mb-0.5 grid grid-cols-7 text-center text-xxs text-muted-foreground">
                      <For each={WEEKDAY_LABELS()}>{(label) => <span>{label}</span>}</For>
                    </div>
                    <div class="grid grid-cols-7 gap-y-0.5" onPointerLeave={() => setHover(null)}>
                      <For each={getMonthDays(shown)}>
                        {(day) => {
                          const outside = () => day.slice(0, 7) !== shown.slice(0, 7);
                          const disabled = () => day > today() || day < earliest();
                          const range = () => bounds();
                          const edgeStart = () => range()?.start === day;
                          const edgeEnd = () => range()?.end === day;
                          const inside = () => !!range() && day >= range()!.start && day <= range()!.end;
                          return (
                            <Show when={!outside()} fallback={<span class="h-7" />}>
                              <button
                                type="button"
                                aria-label={day}
                                disabled={disabled()}
                                class={cn(
                                  "grid h-7 w-full place-items-center focus-ring disabled:pointer-events-none",
                                  inside() && "bg-primary/14",
                                  edgeStart() && "rounded-l-md",
                                  edgeEnd() && "rounded-r-md",
                                )}
                                onPointerEnter={() => setHover(day)}
                                onClick={() => pickDay(day)}
                              >
                                <span
                                  class={cn(
                                    "grid size-7 place-items-center rounded-md text-xs tabular-nums press",
                                    (edgeStart() || edgeEnd()) && "bg-primary font-medium text-primary-foreground",
                                    !edgeStart() && !edgeEnd() && !inside() && "text-foreground hover:bg-accent",
                                    !edgeStart() && !edgeEnd() && inside() && "text-foreground",
                                    disabled() && "text-muted-foreground/35",
                                    day === today() && !edgeStart() && !edgeEnd() && "ring-1 ring-inset ring-(--plane-border-strong-1)",
                                  )}
                                >
                                  {Number(day.slice(-2))}
                                </span>
                              </button>
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <div class="flex items-center gap-2 border-t border-border-strong px-3 py-2.5">
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                <Show when={bounds()} fallback={t("Pick a start day")}>
                  {(range) => (
                    <Show
                      when={to()}
                      fallback={rich("From {day}, now pick an end day", {
                        day: <span class="text-foreground">{customLabel(range().start, range().start)}</span>,
                      })}
                    >
                      <span class="text-foreground">{customLabel(range().start, range().end)}</span>
                    </Show>
                  )}
                </Show>
              </span>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button class="px-2.5" disabled={!to()} onClick={apply}>
                {t("Apply")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
