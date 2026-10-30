/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { eventsInDays } from "@/components/calendar/store";
import { shiftDay } from "@/components/calendar/utils";
import type { PlatformId } from "@/lib/social";
import { ANALYTICS_PLATFORMS, activityGrid, type AnalyticsPlatformId } from "@/lib/social-analytics";
import { dayKeyAt, momentOf, zonedParts } from "@/lib/time-zone";

import { latestSchedule } from "./save";

export type TimeSuggestion = {
  at: Date;
  score: number;
};

const LOOKAHEAD_DAYS = 7;
const LEAD_MS = 30 * 60_000;

export function heatmapPlatforms(platforms: readonly PlatformId[]): { ids: AnalyticsPlatformId[]; matched: boolean } {
  const ids = ANALYTICS_PLATFORMS.map((platform) => platform.id).filter((id) => platforms.includes(id));
  return ids.length ? { ids, matched: true } : { ids: ANALYTICS_PLATFORMS.map((platform) => platform.id), matched: false };
}

export function audienceAt(grid: readonly (readonly number[])[], at: Date): number {
  const parts = zonedParts(at);
  return grid[(parts.weekday + 6) % 7]?.[parts.hours] ?? 0;
}

function heldHours(days: string[]): Set<string> {
  return new Set(eventsInDays(days).filter((event) => !event.allDay).map((event) => `${event.day} ${event.start.slice(0, 2)}`));
}

export function suggestTimes(platforms: readonly PlatformId[], count = 3, now = Date.now()): TimeSuggestion[] {
  return busiestEachDay(platforms, LOOKAHEAD_DAYS + 1, now, now + LOOKAHEAD_DAYS * 86_400_000)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

export function dailyBestTimes(platforms: readonly PlatformId[], count: number, now = Date.now()): TimeSuggestion[] {
  const wanted: TimeSuggestion[] = [];
  for (let days = count; wanted.length < count; days += count) {
    const found = busiestEachDay(platforms, days, now, Infinity);
    if (found.length === wanted.length) break;
    wanted.splice(0, wanted.length, ...found.slice(0, count));
  }
  return wanted;
}

function busiestEachDay(platforms: readonly PlatformId[], dayCount: number, now: number, before: number): TimeSuggestion[] {
  const grid = activityGrid(heatmapPlatforms(platforms).ids);
  const until = Math.min(latestSchedule().getTime(), before);
  const first = dayKeyAt(now);
  const days = Array.from({ length: dayCount }, (_, offset) => shiftDay(first, offset));
  const held = heldHours(days);

  const best: TimeSuggestion[] = [];
  for (const day of days) {
    let top: TimeSuggestion | null = null;
    for (let hour = 0; hour < 24; hour++) {
      const clock = `${String(hour).padStart(2, "0")}`;
      const at = momentOf(day, `${clock}:00`);
      if (!at || at.getTime() < now + LEAD_MS || at.getTime() > until || held.has(`${day} ${clock}`)) continue;
      const score = audienceAt(grid, at);
      if (!top || score > top.score) top = { at, score };
    }
    if (top) best.push(top);
  }
  return best;
}
