/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { localDateKey, shiftDay } from "@/components/calendar/utils";
import { clockAt, momentOf, zonedParts } from "@/lib/time-zone";

const isWeekendDay = (day: string) => {
  const noon = momentOf(day, "12:00");
  if (!noon) return false;
  const { weekday } = zonedParts(noon);
  return weekday === 0 || weekday === 6;
};

export const MOST_A_DAY = 12;

export type SpreadPlan = { startDay: string; times: readonly string[]; every: number; skipWeekends: boolean; after?: Date };

/** Each of `times`, on every `every`th day from `startDay`. A day that's skipped moves the rest along with it. */
export function spread(count: number, plan: SpreadPlan): Date[] {
  const times = [...new Set(plan.times)].sort();
  const out: Date[] = [];
  if (!times.length) return out;
  let day = plan.startDay;
  // A day that doesn't exist names no moment, so this can't count on finding one.
  for (let tries = 0; out.length < count && tries < 3660; tries++) {
    while (plan.skipWeekends && isWeekendDay(day)) day = shiftDay(day, 1);
    for (const time of times) {
      const at = momentOf(day, time);
      if (at && (!plan.after || at > plan.after) && out.length < count) out.push(at);
    }
    day = shiftDay(day, plan.every);
  }
  return out;
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Three hours after the latest, while that's before 23:00; then the middle of the widest gap. */
export function suggestTime(times: readonly string[]): string {
  const sorted = times.map(minutesOf).sort((a, b) => a - b);
  const latest = sorted.at(-1) ?? 9 * 60 - 180;
  if (latest + 180 <= 23 * 60) return clockOf(latest + 180);
  let start = sorted[0]!;
  let widest = 0;
  sorted.forEach((minutes, index) => {
    const gap = (sorted[index + 1] ?? minutes) - minutes;
    if (gap > widest) {
      widest = gap;
      start = minutes;
    }
  });
  return clockOf(start + Math.floor(widest / 2 / 15) * 15);
}

type Timed = { id: string; day: string; time: string; ownTime: boolean };

/** Which posts a plan moves: the selected ones, or else every post nobody timed by hand. */
export function plannedPosts<T extends Timed>(posts: readonly T[], only?: ReadonlySet<string>): T[] {
  return posts.filter((post) => (only ? only.has(post.id) : !post.ownTime));
}

/** A selected post keeps the time it's given, so a later plan for the rest doesn't move it. */
export function assignTimes(posts: Timed[], times: readonly Date[], only?: ReadonlySet<string>): void {
  plannedPosts(posts, only).forEach((post, index) => {
    const at = times[index];
    if (!at) return;
    post.day = localDateKey(at);
    post.time = clockAt(at);
    if (only) post.ownTime = true;
  });
}

export function fillCaptions<T extends { caption: string; ownCaption: boolean }>(posts: T[], template: string, fill: (template: string, post: T, index: number) => string): void {
  posts.forEach((post, index) => {
    if (!post.ownCaption) post.caption = template.trim() ? fill(template, post, index) : "";
  });
}

/** Reads several files at once for speed, while posts still arrive in the files' order. */
export async function readInOrder<In, Out>(
  items: readonly In[],
  read: (item: In) => Promise<Out>,
  onReady: (value: Out) => void,
  onFailed: (item: In) => void,
  limit: number,
): Promise<void> {
  const finished: ({ value: Out } | null | undefined)[] = items.map(() => undefined);
  let nextToRead = 0;
  let nextToHandOver = 0;

  const handOver = () => {
    while (finished[nextToHandOver] !== undefined) {
      const result = finished[nextToHandOver++];
      if (result) onReady(result.value);
    }
  };

  const worker = async () => {
    while (nextToRead < items.length) {
      const index = nextToRead++;
      try {
        finished[index] = { value: await read(items[index]!) };
      } catch {
        finished[index] = null;
        onFailed(items[index]!);
      }
      handOver();
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** A post already on the calendar stays out, so a batch brought back can't be scheduled a second time. */
export function restorablePosts<Post extends { id: string }, File>(
  saved: readonly Post[],
  files: ReadonlyMap<string, File>,
  isOnCalendar: (id: string) => boolean,
): { posts: { post: Post; file: File }[]; missing: number } {
  const waiting = saved.filter((post) => !isOnCalendar(post.id));
  const posts = waiting.flatMap((post) => {
    const file = files.get(post.id);
    return file === undefined ? [] : [{ post, file }];
  });
  return { posts, missing: waiting.length - posts.length };
}

/** Fills down from `start`, past stories, which take no caption. An empty cell gives the post back to the shared caption. */
export function fillDown<T extends { story: boolean; caption: string; ownCaption: boolean }>(posts: T[], start: number, values: readonly string[]): { filled: number; left: number } {
  const open = posts.slice(start).filter((post) => !post.story);
  const filled = Math.min(open.length, values.length);
  for (let index = 0; index < filled; index++) {
    open[index]!.caption = values[index]!;
    open[index]!.ownCaption = !!values[index]!.trim();
  }
  return { filled, left: values.length - filled };
}

export function fillTitlesDown<T extends { title: string }>(posts: T[], start: number, values: readonly string[], takesTitle: (post: T) => boolean): { filled: number; left: number } {
  const open = posts.slice(start).filter(takesTitle);
  const filled = Math.min(open.length, values.length);
  for (let index = 0; index < filled; index++) open[index]!.title = values[index]!;
  return { filled, left: values.length - filled };
}

export function columnFromRows(rows: readonly (readonly string[])[]): string[] {
  const column = rows.map((row) => row[0]?.trim() ?? "");
  while (column.length && !column.at(-1)) column.pop();
  return column;
}

/** Tabs on every line mean cells. Line breaks alone are one caption, and must paste as one. */
export function rowsFromPlainText(text: string): string[][] {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  return lines.length > 1 && lines.every((line) => line.includes("\t")) ? lines.map((line) => line.split("\t")) : [];
}

/** Spreadsheets also copy an HTML table, which is what tells a column of cells from a caption with line breaks. */
export function spreadsheetColumn(html: string, plain: string): string[] {
  const table = /<table/i.test(html) ? new DOMParser().parseFromString(html, "text/html").querySelector("table") : null;
  if (!table) return columnFromRows(rowsFromPlainText(plain));
  const holder = table.ownerDocument.createElement("div");
  return columnFromRows(
    [...table.rows].map((row) => {
      // A line break in a cell is a <br>; breaks in the HTML's own text are only formatting.
      holder.innerHTML = (row.cells[0]?.innerHTML ?? "").replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n");
      return [holder.textContent ?? ""];
    }),
  );
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Always differs from the order it was given, when it can, so the button never seems to do nothing. */
export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const next = [...list];
  for (let index = next.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [next[index], next[other]] = [next[other]!, next[index]!];
  }
  return next.every((item, index) => item === list[index]) ? moveItem(next, 0, next.length - 1) : next;
}
