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
