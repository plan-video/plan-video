/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The agent's analytics tool: the numbers the Analytics page shows, summed up
// so the model can pick days and times from how the person's posts did.

import { DapiError, type analyticsTool } from "@plan.video/dapi";
import type { z } from "zod";

import { analyticsSynced, syncState } from "@/lib/analytics-sync";
import { postingTimes, WEEKDAY_NAMES } from "@/lib/posting-times";
import { PLATFORM_IDS, socialPlatform, type PlatformId } from "@/lib/social";
import { analyticsReport, analyticsSources, dayKeyOf, reportsNumbers, type Totals } from "@/lib/social-analytics";
import { socialConnections } from "@/lib/social-connections";
import { timeZone, zonedParts, zonedTime } from "@/lib/time-zone";

type Args = z.output<typeof analyticsTool.input>;
type Output = z.output<typeof analyticsTool.output>;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOP_POSTS = 8;
/** Fewer posts than this can't tell one day from another. */
const ENOUGH_POSTS = 10;

const pad = (value: number) => String(value).padStart(2, "0");

const platformName = (id: string) => ((PLATFORM_IDS as readonly string[]).includes(id) ? socialPlatform(id as PlatformId).name : id);

/** A slot's numbers as the model reads them. */
const shown = <T extends { posts: number; medianViews: number; averageViews: number; engagement: number }>(slot: T) => ({
  posts: slot.posts,
  medianViews: slot.medianViews,
  averageViews: slot.averageViews,
  engagement: Math.round(slot.engagement * 10_000) / 10_000,
});

const numbers = (row: Totals | undefined) => ({ views: row?.views ?? 0, likes: row?.likes ?? 0, comments: row?.comments ?? 0 });

export async function readAnalytics(args: Args, userId: string): Promise<Output> {
  const accounts = socialConnections().filter(
    (account) => (!args.platform || account.platform === args.platform) && (!args.account || account.id === args.account),
  );
  if (args.account && !accounts.length) {
    throw new DapiError("not-found", "No connected account has that id. Call social_accounts for the ids.");
  }
  await analyticsSynced(userId, accounts);

  const now = Date.now();
  const today = zonedParts(now);
  const days = args.days ?? 90;
  const span = { start: zonedTime(today.year, today.month, today.date - (days - 1)), end: now };
  const sources = analyticsSources(accounts);
  // Whole months keep the chart's buckets few: only the totals and posts are read.
  const report = analyticsReport(span, "month", sources, now);
  const posts = report.posts;

  const times = postingTimes(posts);
  const stamp = (time: number) => {
    const parts = zonedParts(time);
    return `${dayKeyOf(time)} ${pad(parts.hours)}:${pad(parts.minutes)}, ${WEEKDAYS[parts.weekday]}`;
  };

  let note: string | undefined;
  if (!sources.length) {
    note = "No connected account sends its numbers. plan.video reads TikTok, YouTube, Instagram, Facebook Pages and Threads: they can connect one in Connections.";
  } else if (posts.length < ENOUGH_POSTS) {
    note = `Only ${posts.length} ${posts.length === 1 ? "post" : "posts"} went out in these days: too few to tell which days or hours do best. Look further back with days, or say so.`;
  }

  return {
    timeZone: timeZone(),
    from: dayKeyOf(span.start),
    to: dayKeyOf(now),
    accounts: sources.map((source) => ({
      platform: source.platform,
      accountId: source.account ?? "",
      handle: source.handle ?? "",
      state: syncState(source.key) ?? "ready",
      totals: numbers(report.totals[source.key]),
      previous: numbers(report.previous[source.key]),
      posts: posts.filter((post) => post.source === source.key).length,
    })),
    noNumbers: accounts.filter((account) => !reportsNumbers(account)).map((account) => `${platformName(account.platform)} @${account.handle}`),
    // Monday first, as the calendar has it.
    byWeekday: times.weekdays.filter((slot) => slot.posts).map((slot) => ({ weekday: WEEKDAY_NAMES[slot.day]!, ...shown(slot) })),
    byHour: times.hours.filter((slot) => slot.posts).map((slot) => ({ hour: `${pad(slot.hour)}:00`, ...shown(slot) })),
    topPosts: [...posts]
      .sort((a, b) => b.views - a.views)
      .slice(0, TOP_POSTS)
      .map((post) => ({
        title: post.title,
        platform: post.platform,
        handle: post.handle ?? "",
        postedAt: stamp(post.postedAt),
        views: post.views,
        likes: post.likes,
        comments: post.comments,
      })),
    ...(note ? { note } : {}),
  };
}
