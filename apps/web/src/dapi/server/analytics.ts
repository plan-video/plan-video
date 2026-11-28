/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The analytics tool on the server: each account's numbers read through the publisher with the agent's own token,
// as lib/analytics-sync reads them in the tab, then the same answer.

import { analyticsAccounts, analyticsAnswer, type AnalyticsArgs } from "@/lib/analytics-answer";
import { DAY_MS, HISTORY_DAYS, postingDayNumbers, withSyncedNumbers, youtubeNumbers, type PostTotals, type SyncedNumbers } from "@/lib/social-analytics";
import { inTimeZone } from "@/lib/time-zone";

import type { AgentAccount, AgentContext } from "./posts";

export interface NetworkReads {
  /** A publisher route the agent's token may ask, such as `tiktok/creator`. */
  network<T>(route: string, body: object): Promise<T>;
}

type Answer = { youtube: Parameters<typeof youtubeNumbers>[0] } | { posts: PostTotals[]; followers?: number | null; perPost: boolean };

const META = new Set(["instagram", "facebook", "threads"]);
const FAILED = "Couldn't load its numbers. Try again later.";

/** UTC is close enough to the Pacific days YouTube counts in. */
const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** As analytics-source accounts are told: by a login of their network, and LinkedIn's by its Page. */
const numbersAccount = (account: AgentAccount) => ({
  id: account.id,
  handle: account.handle,
  platform: account.platform,
  ...(account.ready ? { [account.platform]: account.platform === "linkedin" ? (account.page ? { organizationId: "page" } : {}) : {} } : {}),
});

async function load(reads: NetworkReads, account: AgentAccount, now: number): Promise<Answer | null> {
  const connectionId = account.id;
  if (!account.ready) return null;
  if (account.platform === "youtube") {
    return { youtube: await reads.network("youtube/analytics", { connectionId, startDate: isoDay(now - HISTORY_DAYS * DAY_MS), endDate: isoDay(now) }) };
  }
  if (account.platform === "tiktok") {
    if (!account.scope.split(/[,\s]+/).includes("video.list")) throw new Error("Disconnect TikTok in Connections and connect it again, so plan.video can read its numbers.");
    const found = await reads.network<{ videos?: PostTotals[] }>("tiktok/videos", { connectionId });
    return { posts: found.videos ?? [], perPost: false };
  }
  if (META.has(account.platform) || (account.platform === "linkedin" && account.page)) {
    const found = await reads.network<{ followers?: number | null; videos?: PostTotals[] }>(`${account.platform}/analytics`, { connectionId });
    return { posts: (found.videos ?? []).filter((post) => post.postedAt > 0), followers: found.followers ?? null, perPost: true };
  }
  return null;
}

export async function readAnalytics(reads: NetworkReads, scope: AgentContext, args: AnalyticsArgs, now: number) {
  const accounts = analyticsAccounts(args, scope.connections.map(numbersAccount));
  const answers = new Map<string, Answer>();
  const states = new Map<string, string>();
  await Promise.all(
    accounts.map(async (account) => {
      const key = `${account.platform}:${account.id}`;
      try {
        const found = await load(reads, scope.connections.find((item) => item.id === account.id)!, now);
        if (found) answers.set(key, found);
      } catch (error) {
        states.set(key, error instanceof Error && error.message ? error.message : FAILED);
      }
    }),
  );
  // Days are counted in the person's dashboard time zone, as their tab counts them.
  return inTimeZone(scope.timeZone, () => {
    const numbers = new Map<string, SyncedNumbers>();
    for (const [key, found] of answers) {
      numbers.set(
        key,
        "youtube" in found
          ? youtubeNumbers(found.youtube)
          : { days: postingDayNumbers(found.posts), posts: found.posts, ...(found.perPost ? { followers: found.followers ?? null } : {}) },
      );
    }
    return withSyncedNumbers(numbers, () => analyticsAnswer(args, accounts, (key) => states.get(key), now));
  });
}
