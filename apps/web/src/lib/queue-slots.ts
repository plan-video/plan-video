/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A queued post takes the next slot no other post holds. Slots belong to the
// workspace they were made in, and are read in the dashboard's time zone.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { localized, msg, t } from "@/lib/i18n";
import { clockAt, dayKeyAt, momentOf, zonedParts } from "@/lib/time-zone";
import { workspaceKey } from "@/lib/workspaces";

export type QueueSlot = {
  id: string;
  /** From Sunday, like `Date`. */
  weekday: number;
  /** `HH:MM`. */
  time: string;
};

/** Monday first, as the calendar shows a week. */
export const QUEUE_WEEKDAYS = [
  { weekday: 1, short: msg("Mon"), name: msg("Monday") },
  { weekday: 2, short: msg("Tue"), name: msg("Tuesday") },
  { weekday: 3, short: msg("Wed"), name: msg("Wednesday") },
  { weekday: 4, short: msg("Thu"), name: msg("Thursday") },
  { weekday: 5, short: msg("Fri"), name: msg("Friday") },
  { weekday: 6, short: msg("Sat"), name: msg("Saturday") },
  { weekday: 0, short: msg("Sun"), name: msg("Sunday") },
] as const;

export const MAX_QUEUE_SLOTS = 70;

const [slots, setSlots] = createSignal<QueueSlot[]>([]);
let loadedKey: string | undefined;

export { slots as queueSlots };

const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function isSlot(value: unknown): value is QueueSlot {
  if (!value || typeof value !== "object") return false;
  const row = value as QueueSlot;
  return typeof row.id === "string" && Number.isInteger(row.weekday) && row.weekday >= 0 && row.weekday <= 6 && isTime(row.time);
}

const order = (slot: QueueSlot) => ((slot.weekday + 6) % 7) * 1440 + Number(slot.time.slice(0, 2)) * 60 + Number(slot.time.slice(3));
const sorted = (list: QueueSlot[]) => [...list].sort((a, b) => order(a) - order(b));

/** Forces a reread; `loadQueueSlots` skips a key already loaded. */
export function reloadQueueSlots(userId: string | undefined) {
  loadedKey = undefined;
  loadQueueSlots(userId);
}

/** Reads the active workspace, so calling this in an effect reloads after a switch. */
export function loadQueueSlots(userId: string | undefined) {
  userId = ownerOf(userId);
  if (!userId) {
    loadedKey = undefined;
    setSlots([]);
    return;
  }
  const key = workspaceKey("plan.video.queue", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setSlots(Array.isArray(parsed) ? sorted(parsed.filter(isSlot)) : []);
  } catch {
    setSlots([]);
  }
}

function write(next: QueueSlot[]) {
  if (!loadedKey) return;
  setSlots(sorted(next));
  try {
    localStorage.setItem(loadedKey, JSON.stringify(slots()));
  } catch {
    // Storage full or blocked: the change holds until the page reloads.
    return;
  }
  queueAccountSync();
}

export function addQueueSlots(userId: string, weekdays: readonly number[], time: string): number {
  loadQueueSlots(userId);
  if (!isTime(time)) return 0;
  const fresh = weekdays
    .filter((weekday) => !slots().some((slot) => slot.weekday === weekday && slot.time === time))
    .map((weekday) => ({ id: crypto.randomUUID(), weekday, time }));
  const room = Math.max(0, MAX_QUEUE_SLOTS - slots().length);
  const added = fresh.slice(0, room);
  if (added.length) write([...slots(), ...added]);
  return added.length;
}

export function removeQueueSlot(userId: string, id: string) {
  loadQueueSlots(userId);
  write(slots().filter((slot) => slot.id !== id));
}

/** Returns an undo, which leaves any other workspace alone. */
export function clearQueueSlots(userId: string): () => void {
  loadQueueSlots(userId);
  const key = loadedKey;
  const cleared = slots();
  write([]);
  return () => {
    loadQueueSlots(userId);
    if (loadedKey !== key) return;
    const since = slots().filter((slot) => !cleared.some((old) => old.weekday === slot.weekday && old.time === slot.time));
    write([...cleared, ...since].slice(0, MAX_QUEUE_SLOTS));
  };
}

/** A slot taken by one post is free for none after it. */
export function openQueueTimes(
  count: number,
  options: { from?: Date; until: Date; taken(day: string, time: string): boolean; list?: readonly QueueSlot[] },
): Date[] {
  const list = options.list ?? slots();
  if (!list.length || count <= 0) return [];
  const from = options.from ?? new Date();
  const found: Date[] = [];
  const start = zonedParts(from);
  for (let offset = 0; found.length < count; offset++) {
    const day = dayKeyAt(momentOf(dayKeyAt(from), "12:00")!.getTime() + offset * 86_400_000);
    const dayMoment = momentOf(day, "00:00");
    if (!dayMoment || dayMoment > options.until) break;
    const weekday = (start.weekday + offset) % 7;
    for (const slot of list) {
      if (slot.weekday !== weekday) continue;
      const at = momentOf(day, slot.time);
      if (!at || at <= from || at > options.until || options.taken(day, slot.time)) continue;
      found.push(at);
      if (found.length === count) break;
    }
  }
  return found;
}

/** Each slot's soonest time in `times`, by id. A slot left out has none free. */
export function firstOpenBySlot(times: readonly Date[], list: readonly QueueSlot[] = slots()): Map<string, Date> {
  const first = new Map<string, Date>();
  for (const at of times) {
    const { weekday } = zonedParts(at);
    const time = clockAt(at);
    const slot = list.find((row) => row.weekday === weekday && row.time === time);
    if (slot && !first.has(slot.id)) first.set(slot.id, at);
  }
  return first;
}

/** Joins weekdays as the language does; en-GB's has no comma before "and". */
const DAY_LIST = localized((locale) => new Intl.ListFormat(locale, { type: "conjunction" }), "en-GB");

export function describeQueue(list: readonly QueueSlot[] = slots()): string {
  if (!list.length) return t("No times yet");
  const byTime = new Map<string, number[]>();
  for (const slot of list) byTime.set(slot.time, [...(byTime.get(slot.time) ?? []), slot.weekday]);
  if (byTime.size > 2) return t("{count, plural, one {# time a week} other {# times a week}}", { count: list.length });
  const names = (weekdays: number[]) => {
    const labels = QUEUE_WEEKDAYS.filter((day) => weekdays.includes(day.weekday)).map((day) => t(day.short));
    if (labels.length === 7) return t("Every day");
    return labels.length > 1 ? DAY_LIST().format(labels) : labels[0]!;
  };
  return [...byTime].map(([time, weekdays]) => t("{days} at {time}", { days: names(weekdays), time })).join("; ");
}
