/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import type { AnalyticsMetric, Interval } from "@/lib/social-analytics";

import type { AnalyticsRange } from "./analytics-range";
import type { AnalyticsSection, DashboardView } from "./types";

export const [analyticsRange, setAnalyticsRange] = createSignal<AnalyticsRange>({ preset: "28d" });
/** Null follows the range. */
export const [analyticsInterval, setAnalyticsInterval] = createSignal<Interval | null>(null);
export const [analyticsMetric, setAnalyticsMetric] = createSignal<AnalyticsMetric>("views");
/** Keys switched off rather than on, so a newly connected account shows from the start. */
export const [analyticsHidden, setAnalyticsHidden] = createSignal<ReadonlySet<string>>(new Set());

export type PostColumn = AnalyticsMetric | "engagement";

export const POST_COLUMNS: readonly PostColumn[] = ["views", "likes", "comments", "engagement"];
const POST_COLUMNS_KEY = "plan.video.analytics.columns";

/** Anything unknown is dropped and a column missing from an older save goes last, so every column always shows once. */
export function readPostColumns(saved: string | null): PostColumn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(saved ?? "[]");
  } catch {
    parsed = [];
  }
  const list: unknown[] = Array.isArray(parsed) ? parsed : [];
  const known = POST_COLUMNS.filter((id) => list.includes(id)).sort((a, b) => list.indexOf(a) - list.indexOf(b));
  return [...known, ...POST_COLUMNS.filter((id) => !known.includes(id))];
}

/** `before` is the place to land in `columns` as it stands, with `id` still in it; `columns.length` means last. */
export function movePostColumn(columns: readonly PostColumn[], id: PostColumn, before: number): PostColumn[] {
  const from = columns.indexOf(id);
  const next = columns.filter((column) => column !== id);
  next.splice(before > from ? before - 1 : before, 0, id);
  return next;
}

export function postColumnsMoved(columns: readonly PostColumn[]): boolean {
  return columns.some((id, index) => id !== POST_COLUMNS[index]);
}

function savedPostColumns(): PostColumn[] {
  try {
    return readPostColumns(localStorage.getItem(POST_COLUMNS_KEY));
  } catch {
    return [...POST_COLUMNS];
  }
}

const [postColumns, setColumns] = createSignal<readonly PostColumn[]>(savedPostColumns());
export { postColumns };

export function setPostColumns(next: readonly PostColumn[]) {
  setColumns(next);
  try {
    if (postColumnsMoved(next)) localStorage.setItem(POST_COLUMNS_KEY, JSON.stringify(next));
    else localStorage.removeItem(POST_COLUMNS_KEY);
  } catch {
    // Private windows can refuse storage; the order still holds until the page closes.
  }
}

export const ANALYTICS_SECTIONS: Record<AnalyticsSection, DashboardView> = {
  overview: "analytics",
  posts: "analytics-posts",
  platforms: "analytics-platforms",
  times: "analytics-times",
};

export function analyticsSectionOf(view: DashboardView): AnalyticsSection | null {
  const entry = Object.entries(ANALYTICS_SECTIONS).find(([, value]) => value === view);
  return entry ? (entry[0] as AnalyticsSection) : null;
}
