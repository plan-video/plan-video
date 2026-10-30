/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the analytics pages are showing, kept outside them: the sections share
// one time range and one account filter, and the sidebar sets that filter.

import { createSignal } from "solid-js";

import type { AnalyticsMetric, Interval } from "@/lib/social-analytics";

import type { AnalyticsRange } from "./analytics-range";
import type { AnalyticsSection, DashboardView } from "./types";

export const [analyticsRange, setAnalyticsRange] = createSignal<AnalyticsRange>({ preset: "28d" });
/** The interval picked by hand. Null follows the range. */
export const [analyticsInterval, setAnalyticsInterval] = createSignal<Interval | null>(null);
export const [analyticsMetric, setAnalyticsMetric] = createSignal<AnalyticsMetric>("views");
/**
 * Source keys switched off. Everything else shows, so a newly connected
 * account shows from the start.
 */
export const [analyticsHidden, setAnalyticsHidden] = createSignal<ReadonlySet<string>>(new Set());

export const ANALYTICS_SECTIONS: Record<AnalyticsSection, DashboardView> = {
  overview: "analytics",
  posts: "analytics-posts",
  platforms: "analytics-platforms",
  times: "analytics-times",
};

/** The section a view opens, or null when it is not an analytics view. */
export function analyticsSectionOf(view: DashboardView): AnalyticsSection | null {
  const entry = Object.entries(ANALYTICS_SECTIONS).find(([, value]) => value === view);
  return entry ? (entry[0] as AnalyticsSection) : null;
}
