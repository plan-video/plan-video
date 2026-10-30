/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Adapted from next16-calendar (github.com/aurorascharff/next16-calendar, MIT).

import type { JSX } from "solid-js";
import { localized, msg, t } from "@/lib/i18n";
import { dayKeyAt, minutesAt } from "@/lib/time-zone";
import type { CalendarColor, CalendarEvent, CalendarView, PostStatus, PostStatusFilter } from "./types";

// A date key is `YYYY-MM-DD`; all math on it is in UTC so it never drifts across DST.

const dayFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }), "en-GB");
const dayLongFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", weekday: "long", timeZone: "UTC" }), "en-GB");
const monthFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }), "en-GB");
const weekdayFormatter = localized((locale) => new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }), "en-GB");

export function dateFromKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function localDateKey(date: Date) {
  return dayKeyAt(date);
}

export function localMinutes(date: Date) {
  return minutesAt(date);
}

export function isDateKey(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateFromKey(value);
  return !Number.isNaN(date.valueOf()) && dateKey(date) === value;
}

export function formatDay(value: string) {
  return dayFormatter().format(dateFromKey(value));
}

export function formatDayLong(value: string) {
  return dayLongFormatter().format(dateFromKey(value));
}

export function formatMonth(value: string) {
  return monthFormatter().format(dateFromKey(value));
}

export function formatWeekday(value: string) {
  return weekdayFormatter().format(dateFromKey(value));
}

export function formatDayParts(value: string) {
  const short = dayFormatter().formatToParts(dateFromKey(value));
  const long = dayLongFormatter().formatToParts(dateFromKey(value));
  return {
    day: short.find((part) => part.type === "day")?.value ?? "",
    weekday: long.find((part) => part.type === "weekday")?.value ?? "",
    weekdayShort: short.find((part) => part.type === "weekday")?.value ?? "",
  };
}

export function getWeekDays(value: string) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + index);
    return dateKey(day);
  });
}

export function getMonthDays(value: string) {
  const date = dateFromKey(value);
  date.setUTCDate(1);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + index);
    return dateKey(day);
  });
}

export function shiftDay(value: string, direction: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + direction);
  return dateKey(date);
}

export function shiftWeek(value: string, direction: number) {
  return shiftDay(value, direction * 7);
}

export function shiftMonth(value: string, direction: number) {
  const date = dateFromKey(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return dateKey(date);
}

export function shiftPeriod(value: string, view: CalendarView, direction: number) {
  return view === "week" ? shiftWeek(value, direction) : shiftMonth(value, direction);
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

// Recurrence is `weekday` (Mon-Fri), `every:N:unit` from the first day, or an old
// weekday name. Skipped occurrences are kept as exception days.

export const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export type RepeatUnit = "day" | "week" | "month";
export type Cadence = { unit: "weekday" } | { unit: RepeatUnit; every: number };

export const MAX_REPEAT_EVERY = 99;

export function weekdayName(day: string) {
  return WEEKDAY_NAMES[dateFromKey(day).getUTCDay()];
}

export function isWeekdayName(recurrence: string | null | undefined): boolean {
  return (WEEKDAY_NAMES as readonly (string | null | undefined)[]).includes(recurrence);
}

export function everyRecurrence(every: number, unit: RepeatUnit) {
  return `every:${every}:${unit}`;
}

export function parseRecurrence(recurrence: string | null | undefined): Cadence | null {
  if (!recurrence) return null;
  if (recurrence === "weekday") return { unit: "weekday" };
  if (isWeekdayName(recurrence)) return { unit: "week", every: 1 };
  const match = /^every:(\d{1,2}):(day|week|month)$/.exec(recurrence);
  const every = Number(match?.[1]);
  return match && every >= 1 ? { unit: match[2] as RepeatUnit, every } : null;
}

export function daysBetween(from: string, to: string) {
  return Math.round((dateFromKey(to).getTime() - dateFromKey(from).getTime()) / 86_400_000);
}

const monthIndex = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const monthLength = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

/** A monthly post on the 31st lands on the last day of shorter months. */
export function matchesRecurrence(recurrence: string | null | undefined, day: string, first: string) {
  const date = dateFromKey(day);
  const weekday = date.getUTCDay();
  if (isWeekdayName(recurrence)) return recurrence === WEEKDAY_NAMES[weekday];
  const cadence = parseRecurrence(recurrence);
  if (!cadence || day < first) return false;
  if (cadence.unit === "weekday") return weekday >= 1 && weekday <= 5;
  if (cadence.unit === "day") return daysBetween(first, day) % cadence.every === 0;
  if (cadence.unit === "week") return daysBetween(first, day) % (7 * cadence.every) === 0;
  const start = dateFromKey(first);
  if ((monthIndex(date) - monthIndex(start)) % cadence.every !== 0) return false;
  return date.getUTCDate() === Math.min(start.getUTCDate(), monthLength(date));
}

export function occurrenceId(sourceId: string, day: string) {
  return `${sourceId}:${day}`;
}

export function recurrenceAfterMove(recurrence: string, day: string) {
  return recurrence === "weekday" ? "weekday" : weekdayName(day);
}

type CadenceWords = Record<"named" | "weekday" | RepeatUnit | "weekOn" | "monthOn", string>;

const CADENCE_LABELS: CadenceWords = {
  named: msg("Every {weekday}"),
  weekday: msg("Every weekday"),
  day: msg("{count, plural, =1 {Every day} other {Every # days}}"),
  week: msg("{count, plural, =1 {Every week} other {Every # weeks}}"),
  month: msg("{count, plural, =1 {Every month} other {Every # months}}"),
  weekOn: msg("{count, plural, =1 {Every {weekday}} other {Every # weeks on {weekday}}}"),
  monthOn: msg(
    "{count, plural, =1 {Every month on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}} other {Every # months on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}}}",
  ),
};

const CADENCE_PHRASES: CadenceWords = {
  named: msg("every {weekday}"),
  weekday: msg("every weekday"),
  day: msg("{count, plural, =1 {every day} other {every # days}}"),
  week: msg("{count, plural, =1 {every week} other {every # weeks}}"),
  month: msg("{count, plural, =1 {every month} other {every # months}}"),
  weekOn: msg("{count, plural, =1 {every {weekday}} other {every # weeks on {weekday}}}"),
  monthOn: msg(
    "{count, plural, =1 {every month on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}} other {every # months on the {day, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}}}",
  ),
};

function cadenceWords(recurrence: string | null | undefined, first: string | undefined, words: CadenceWords) {
  if (isWeekdayName(recurrence)) {
    // A weekday's name from before cadences, as Intl writes it. 7 January 2024 was a Sunday, the first of WEEKDAY_NAMES.
    const weekday = formatWeekday(shiftDay("2024-01-07", (WEEKDAY_NAMES as readonly string[]).indexOf(recurrence!)));
    return t(words.named, { weekday });
  }
  const cadence = parseRecurrence(recurrence);
  if (!cadence) return null;
  if (cadence.unit === "weekday") return t(words.weekday);
  const count = cadence.every;
  if (cadence.unit === "day" || !first) return t(words[cadence.unit], { count });
  if (cadence.unit === "week") return t(words.weekOn, { count, weekday: formatWeekday(first) });
  return t(words.monthOn, { count, day: dateFromKey(first).getUTCDate() });
}

export function cadenceLabel(recurrence: string | null | undefined, first?: string) {
  return cadenceWords(recurrence, first, CADENCE_LABELS);
}

export function cadencePhrase(recurrence: string | null | undefined, first?: string) {
  return cadenceWords(recurrence, first, CADENCE_PHRASES);
}

export function recurrenceLabel(recurrence: string | null, first?: string, end?: string | null) {
  if (!recurrence) return null;
  const cadence = cadencePhrase(recurrence, first);
  const label = cadence ? t("Repeats {cadence}", { cadence }) : t("Repeats");
  return end ? t("{repeats} until {date}", { repeats: label, date: formatDay(end) }) : label;
}

/** A run every 99 months spans a little over eight years. */
const RUN_SEARCH_DAYS = 3100;

/** Skipped days still count. */
export function nthRunDay(recurrence: string, first: string, count: number): string | null {
  let found = 0;
  for (let offset = 0; offset <= RUN_SEARCH_DAYS; offset++) {
    const day = shiftDay(first, offset);
    if (matchesRecurrence(recurrence, day, first) && ++found === count) return day;
  }
  return null;
}

export function runsUntil(recurrence: string, first: string, end: string): number {
  let count = 0;
  for (let day = first; day <= end; day = shiftDay(day, 1)) if (matchesRecurrence(recurrence, day, first)) count++;
  return count;
}

export const MAX_REPEAT_RUNS = 99;

/** Null: it keeps going, or the end makes no sense. */
export function resolveRepeatEnd(end: string | undefined, recurrence: string, first: string): string | null {
  const on = /^on:(\d{4}-\d{2}-\d{2})$/.exec(end ?? "")?.[1];
  if (on) return on;
  const after = Number(/^after:(\d{1,2})$/.exec(end ?? "")?.[1]);
  return after >= 1 ? nthRunDay(recurrence, first, after) : null;
}

// The week grid runs 06:00 to 06:00 so a late-night post stays on its own day.

export const HOUR_HEIGHT = 64;
export const MIN_CHIP_HEIGHT = 42;
export const START_HOUR = 6;
export const HOURS = Array.from({ length: 24 }, (_, index) => (START_HOUR + index) % 24);
export const START_MINUTES = START_HOUR * 60;
export const END_MINUTES = (24 + START_HOUR) * 60;
export const GRID_HEIGHT = HOURS.length * HOUR_HEIGHT;
export const MIDNIGHT_LINE = ((24 * 60 - START_MINUTES) / 60) * HOUR_HEIGHT;
export const DEFAULT_SCROLL_TOP = ((8 * 60 - START_MINUTES) / 60) * HOUR_HEIGHT;
export const SNAP_MINUTES = 15;
export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 24 * 60];
const MIN_PACK_DURATION = Math.ceil(((MIN_CHIP_HEIGHT + 3) / HOUR_HEIGHT) * 60);

export type Placement = { col: number; cols: number };

export function displayMinutes(minutes: number) {
  return minutes < START_MINUTES ? minutes + 24 * 60 : minutes;
}

export function eventStartMinutes(start: string) {
  return displayMinutes(timeToMinutes(start));
}

export function gridDayFromCalendarDay(day: string, startMinutes: number) {
  return startMinutes >= 24 * 60 ? shiftDay(day, -1) : day;
}

export function calendarDayFromGridDay(day: string, startMinutes: number) {
  return startMinutes >= 24 * 60 ? shiftDay(day, 1) : day;
}

export function packDay(events: Pick<CalendarEvent, "duration" | "id" | "start">[]): Map<string, Placement> {
  const items = events
    .map((event) => ({
      end: eventStartMinutes(event.start) + Math.max(event.duration, MIN_PACK_DURATION),
      id: event.id,
      start: eventStartMinutes(event.start),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placement = new Map<string, Placement>();
  let cluster: typeof items = [];

  const flush = () => {
    const columnEnds: number[] = [];
    for (const item of cluster) {
      let col = columnEnds.findIndex((end) => end <= item.start);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(item.end);
      } else {
        columnEnds[col] = item.end;
      }
      placement.set(item.id, { col, cols: 0 });
    }
    for (const item of cluster) placement.get(item.id)!.cols = columnEnds.length;
    cluster = [];
  };

  let clusterEnd = -1;
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();

  return placement;
}

export function snapMinutes(clientY: number, boundsTop: number) {
  const offset = Math.max(0, Math.min(GRID_HEIGHT, clientY - boundsTop));
  const raw = START_MINUTES + (offset / HOUR_HEIGHT) * 60;
  const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(START_MINUTES, Math.min(END_MINUTES, snapped));
}

export function minutesToTime(minutes: number) {
  const wrapped = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

export function timeRangeLabel(startMin: number, duration: number, compact = false) {
  const start = minutesToTime(startMin);
  const end = minutesToTime(startMin + duration);
  return compact ? `${start}–${end}` : `${start} – ${end}`;
}

export function nearestDuration(minutes: number) {
  return Math.max(SNAP_MINUTES, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES);
}

export function topFor(minutes: number) {
  return ((displayMinutes(minutes) - START_MINUTES) / 60) * HOUR_HEIGHT;
}

export function eventHeight(duration: number) {
  return Math.max(MIN_CHIP_HEIGHT, (duration / 60) * HOUR_HEIGHT - 3);
}

export function durationLabel(minutes: number) {
  if (minutes < 60) return t("{count, plural, one {# minute} other {# minutes}}", { count: minutes });
  if (minutes % 60 === 0) return t("{count, plural, one {# hour} other {# hours}}", { count: minutes / 60 });
  return t("{hours} hr {minutes} min", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export const CALENDAR_COLOR_PRESETS = [
  "rose",
  "orange",
  "amber",
  "green",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "magenta",
  "pink",
] as const;

type ColorPreset = (typeof CALENDAR_COLOR_PRESETS)[number];

const PRESET_HEX: Record<ColorPreset, string> = {
  rose: "#E5484F",
  orange: "#D96B32",
  amber: "#C48A22",
  green: "#3A9558",
  teal: "#2C8F7C",
  cyan: "#2A8498",
  sky: "#3A7FA8",
  blue: "#3B6FBF",
  indigo: "#5A5EC4",
  violet: "#6F5FB8",
  fuchsia: "#A84A8E",
  magenta: "#B85498",
  pink: "#C45A6E",
};

const PRESETS = new Set<string>(CALENDAR_COLOR_PRESETS);

export function isColorPreset(value: string): value is ColorPreset {
  return PRESETS.has(value);
}

export function normalizeColor(value: string): string | null {
  const trimmed = value.trim();
  if (isColorPreset(trimmed)) return trimmed;
  let hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const short = hex.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1];
    hex = `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

export function colorHex(color: CalendarColor) {
  const normalized = normalizeColor(color);
  if (!normalized) return PRESET_HEX.sky;
  return isColorPreset(normalized) ? PRESET_HEX[normalized] : normalized;
}

export function chipStyle(color: CalendarColor): JSX.CSSProperties {
  return { "--cal-color": colorHex(color) };
}

export function swatchStyle(color: CalendarColor): JSX.CSSProperties {
  return { "background-color": colorHex(color) };
}

export const STATUS_OPTIONS: { label: string; value: PostStatus }[] = [
  { label: msg("Draft"), value: "draft" },
  { label: msg("Scheduled"), value: "scheduled" },
  { label: msg("Posted"), value: "posted" },
];

export const STATUS_FILTERS: { label: string; value: PostStatusFilter }[] = [
  { label: msg("All"), value: "all" },
  ...STATUS_OPTIONS,
];

export function statusLabel(status: PostStatus) {
  return t(STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Draft");
}

export function matchesStatus(event: Pick<CalendarEvent, "status" | "delivery">, filter: PostStatusFilter) {
  if (filter === "failed") return event.delivery === "failed";
  return filter === "all" || event.status === filter;
}

export const PLATFORMS = [
  { id: "x", name: "Twitter/X", short: "X" },
  { id: "instagram", name: "Instagram", short: "IG" },
  { id: "tiktok", name: "TikTok", short: "TT" },
  { id: "youtube", name: "YouTube", short: "YT" },
  { id: "linkedin", name: "LinkedIn", short: "in" },
  { id: "facebook", name: "Facebook", short: "FB" },
  { id: "threads", name: "Threads", short: "TH" },
  { id: "bluesky", name: "Bluesky", short: "BS" },
  { id: "pinterest", name: "Pinterest", short: "PI" },
] as const;

const PLATFORM_IDS = new Set<string>(PLATFORMS.map((platform) => platform.id));

export function normalizePlatforms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const order = PLATFORMS.map((platform) => platform.id as string);
  return [...new Set(value.filter((item): item is string => typeof item === "string" && PLATFORM_IDS.has(item)))].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
}

export function platformName(id: string) {
  return PLATFORMS.find((platform) => platform.id === id)?.name ?? id;
}

export function platformShort(id: string) {
  return PLATFORMS.find((platform) => platform.id === id)?.short ?? id.slice(0, 2).toUpperCase();
}

export function displayLink(link: string) {
  try {
    const url = new URL(link);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return link;
  }
}

/**
 * Joins class names without tailwind-merge, which reads the theme's `text-xxs`
 * size as a color and drops it next to a text color.
 */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
