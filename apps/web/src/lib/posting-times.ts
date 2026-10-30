/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// When the person's posts do best, from their own numbers: each post counts
// for the weekday and hour it went out, in the dashboard time zone. The middle
// post's views lead, so one post that took off doesn't make its day look best.
// Best times on the Analytics page and the agent's analytics tool both read
// this, so they never disagree.

import { msg } from "@/lib/i18n";
import { engagement, totals, type AnalyticsPost } from "@/lib/social-analytics";
import { zonedParts } from "@/lib/time-zone";

export type SlotStats = {
  posts: number;
  medianViews: number;
  averageViews: number;
  /** Likes and comments per view, over the slot's posts. */
  engagement: number;
};

/** Monday first, as the calendar has it. Index 0 is Monday. */
export const WEEKDAY_NAMES = [msg("Monday"), msg("Tuesday"), msg("Wednesday"), msg("Thursday"), msg("Friday"), msg("Saturday"), msg("Sunday")];
export const WEEKDAY_SHORT = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")];

/** Fewer posts than this can't tell one time from another. */
export const ENOUGH_POSTS = 5;

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function slotStats(posts: readonly AnalyticsPost[]): SlotStats {
  if (!posts.length) return { posts: 0, medianViews: 0, averageViews: 0, engagement: 0 };
  const sum = totals(posts);
  return {
    posts: posts.length,
    medianViews: Math.round(median(posts.map((post) => post.views))),
    averageViews: Math.round(sum.views / posts.length),
    engagement: engagement(sum),
  };
}

/** Monday-first weekday, 0 to 6, and hour, 0 to 23, a post went out at. */
export function postedAt(post: AnalyticsPost) {
  const parts = zonedParts(post.postedAt);
  return { day: (parts.weekday + 6) % 7, hour: parts.hours };
}

export type PostingTimes = {
  posts: number;
  /** Seven entries, Monday first; days without posts have none. */
  weekdays: (SlotStats & { day: number })[];
  /** Twenty-four entries, from midnight. */
  hours: (SlotStats & { hour: number })[];
  /** Weekday and hour pairs, best first. Pairs with two or more posts lead, as one post proves little. */
  slots: (SlotStats & { day: number; hour: number })[];
};

export function postingTimes(posts: readonly AnalyticsPost[]): PostingTimes {
  const placed = posts.map((post) => ({ post, ...postedAt(post) }));
  const weekdays = Array.from({ length: 7 }, (_, day) => ({ day, ...slotStats(placed.filter((row) => row.day === day).map((row) => row.post)) }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, ...slotStats(placed.filter((row) => row.hour === hour).map((row) => row.post)) }));

  const byPair = new Map<string, AnalyticsPost[]>();
  for (const row of placed) {
    const key = `${row.day}:${row.hour}`;
    byPair.set(key, [...(byPair.get(key) ?? []), row.post]);
  }
  const slots = [...byPair.entries()]
    .map(([key, list]) => {
      const [day, hour] = key.split(":").map(Number);
      return { day: day!, hour: hour!, ...slotStats(list) };
    })
    .sort((a, b) => Number(b.posts > 1) - Number(a.posts > 1) || b.medianViews - a.medianViews || b.posts - a.posts);

  return { posts: posts.length, weekdays, hours, slots };
}
