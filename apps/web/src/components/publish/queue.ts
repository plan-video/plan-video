/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where the queue meets the calendar: a slot is open while no timed post
// sits at that day and minute.

import { eventsInDays } from "@/components/calendar/store";
import { shiftDay } from "@/components/calendar/utils";
import { openQueueTimes, type QueueSlot } from "@/lib/queue-slots";
import { dayKeyAt } from "@/lib/time-zone";

import { latestSchedule } from "./save";

/** The day-and-time pairs timed posts hold, from today to the furthest schedulable day. */
function heldSlots(until: Date): Set<string> {
  const last = dayKeyAt(until);
  const days: string[] = [];
  for (let day = dayKeyAt(new Date()); day <= last; day = shiftDay(day, 1)) days.push(day);
  return new Set(eventsInDays(days).filter((event) => !event.allDay).map((event) => `${event.day} ${event.start}`));
}

/**
 * The next `count` open slots. Reads the calendar, so it follows posts as they
 * are added. `alsoHeld` takes `"YYYY-MM-DD HH:MM"` keys for posts not saved yet.
 */
export function nextQueueTimes(count: number, options: { list?: readonly QueueSlot[]; alsoHeld?: Iterable<string> } = {}): Date[] {
  const until = latestSchedule();
  const held = heldSlots(until);
  for (const key of options.alsoHeld ?? []) held.add(key);
  return openQueueTimes(count, {
    until,
    list: options.list,
    from: new Date(Date.now() + 60_000),
    taken: (day, time) => held.has(`${day} ${time}`),
  });
}
