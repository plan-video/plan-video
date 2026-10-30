/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { intlLocale } from "@/lib/i18n";

const STORAGE_KEY = "plan.video.time-zone";

// Cached and re-read when the tab is shown: asking Intl builds a formatter each time, which was slow on phones.
let deviceZone: string | undefined;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") deviceZone = undefined;
  });
}

export function deviceTimeZone(): string {
  return (deviceZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function isZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function readSaved(): string | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && isZone(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Null follows the device. */
const [chosenZone, setChosenZone] = createSignal<string | null>(readSaved());

export { chosenZone };

export function timeZone(): string {
  return chosenZone() ?? deviceTimeZone();
}

const listeners = new Set<(from: string, to: string) => void>();

export function onTimeZoneChange(listener: (from: string, to: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Null follows the device again. */
export function setTimeZone(zone: string | null) {
  if (zone !== null && !isZone(zone)) return;
  const from = timeZone();
  const next = zone === deviceTimeZone() ? null : zone;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Kept for this session only.
  }
  setChosenZone(next);
  const to = timeZone();
  if (from !== to) for (const listener of listeners) listener(from, to);
  queueAccountSync();
}

/** After another browser changed it. */
export function reloadTimeZone() {
  const next = readSaved();
  if (next === chosenZone()) return;
  const from = timeZone();
  setChosenZone(next);
  const to = timeZone();
  if (from !== to) for (const listener of listeners) listener(from, to);
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partFormatter(zone: string) {
  let formatter = partFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    });
    partFormatters.set(zone, formatter);
  }
  return formatter;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** `month` counts from 0 and `weekday` from Sunday, like `Date`. */
export type ZonedParts = { year: number; month: number; date: number; hours: number; minutes: number; seconds: number; weekday: number };

export function zonedParts(moment: Date | number, zone = timeZone()): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of partFormatter(zone).formatToParts(moment)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    date: Number(parts.day),
    hours: Number(parts.hour) % 24,
    minutes: Number(parts.minute),
    seconds: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday!),
  };
}

function offsetAt(time: number, zone: string) {
  const parts = zonedParts(time, zone);
  const wall = Date.UTC(parts.year, parts.month, parts.date, parts.hours, parts.minutes, parts.seconds);
  return wall - Math.floor(time / 1000) * 1000;
}

/** Fields overflow like `new Date(...)`. A time skipped by a daylight-saving change lands just after it. */
export function zonedTime(year: number, month: number, date = 1, hours = 0, minutes = 0, zone = timeZone()): number {
  const wall = Date.UTC(year, month, date, hours, minutes);
  const first = wall - offsetAt(wall, zone);
  const second = wall - offsetAt(first, zone);
  return second;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function dayKeyAt(moment: Date | number, zone = timeZone()): string {
  const parts = zonedParts(moment, zone);
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.date)}`;
}

export function clockAt(moment: Date | number, zone = timeZone()): string {
  const parts = zonedParts(moment, zone);
  return `${pad(parts.hours)}:${pad(parts.minutes)}`;
}

export function minutesAt(moment: Date | number, zone = timeZone()): number {
  const parts = zonedParts(moment, zone);
  return parts.hours * 60 + parts.minutes;
}

export function momentOf(day: string, time = "00:00", zone = timeZone()): Date | null {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  if (![year, month, date, hours, minutes].every(Number.isFinite)) return null;
  return new Date(zonedTime(year!, month! - 1, date!, hours!, minutes!, zone));
}

export function convertWallClock(day: string, time: string, from: string, to: string): { day: string; time: string } {
  const moment = momentOf(day, time, from);
  return moment ? { day: dayKeyAt(moment, to), time: clockAt(moment, to) } : { day, time };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** `english` is the locale used in English; undefined is the browser's own. Tracks zone and language in JSX or a memo. */
export function zonedFormat(options: Intl.DateTimeFormatOptions, english?: string) {
  const get = () => {
    const zone = timeZone();
    const locale = intlLocale(english);
    const key = `${locale ?? ""}|${zone}|${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
      formatters.set(key, formatter);
    }
    return formatter;
  };
  return {
    format: (moment: Date | number) => get().format(moment),
    formatToParts: (moment: Date | number) => get().formatToParts(moment),
  };
}

/** Falls back to the zone's own short name when it has none better. */
export function zoneOffsetLabel(zone: string, at: Date | number = Date.now()): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return name === "GMT" ? "GMT+0" : (name ?? "");
}

export function zoneCity(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

export function allTimeZones(): string[] {
  const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  const zones = list.length ? [...list] : [deviceTimeZone()];
  if (!zones.includes("UTC")) zones.unshift("UTC");
  return zones;
}
