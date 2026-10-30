/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Fetches connected accounts' real numbers for the analytics pages. Each
// account is asked once per visit; until it answers, it shows no numbers.
//
// YouTube sends each day's numbers. TikTok, Instagram, Facebook and Threads
// only send each post's totals so far, so those count on the day the post
// went out. The last three also say how many follow the account.

import { createSignal } from "solid-js";

import { t } from "@/lib/i18n";
import { isMetaNetwork, type MetaNetwork } from "@/lib/meta";
import { askMeta } from "@/lib/publishing";
import { DAY_MS, HISTORY_DAYS, dayKeyOf, dayOfKey, setSyncedNumbers, type AnalyticsPost, type Totals } from "@/lib/social-analytics";
import { socialConnections, type SocialConnection } from "@/lib/social-connections";
import { loadTikTokVideos, tiktokAllows } from "@/lib/tiktok";
import { loadYouTubeAnalytics } from "@/lib/youtube";

/**
 * Each account's request for its numbers, by `AnalyticsSource.key`: once per
 * visit, and again when the account is connected anew with other permissions,
 * so reconnecting clears what was missing without a reload.
 */
const asked = new Map<string, { scope: string; run: Promise<void> }>();
/** "loading" for a source whose numbers are on the way, or what went wrong. Gone once they arrive. */
const [pending, setPending] = createSignal<ReadonlyMap<string, string>>(new Map());

/** "loading", or why a source has no numbers, by `AnalyticsSource.key`. Undefined once it has them. */
export function syncState(key: string) {
  return pending().get(key);
}

function mark(key: string, state: string | null) {
  setPending((current) => {
    const next = new Map(current);
    if (state) next.set(key, state);
    else next.delete(key);
    return next;
  });
}

function byDay(days: readonly { date: string; views: number; likes: number; comments: number }[]) {
  const map = new Map<number, Totals>();
  for (const row of days) map.set(dayOfKey(row.date), { views: row.views, likes: row.likes, comments: row.comments });
  return map;
}

/** YYYY-MM-DD in UTC, which is close enough to the Pacific days YouTube counts in. */
function isoDay(time: number) {
  return new Date(time).toISOString().slice(0, 10);
}

async function syncYouTube(account: SocialConnection) {
  const now = Date.now();
  const { days, videos } = await loadYouTubeAnalytics(account.id, isoDay(now - HISTORY_DAYS * DAY_MS), isoDay(now));
  setSyncedNumbers(`youtube:${account.id}`, { days: byDay(days), posts: videos });
}

/**
 * TikTok only reports each video's numbers so far, so they count on the day the video went out:
 * a range shows what the videos posted in it have drawn, the same as its post list.
 */
async function syncTikTok(account: SocialConnection, session: NonNullable<SocialConnection["tiktok"]>) {
  if (!tiktokAllows(session.scope, "video.list")) {
    throw new Error(t("Disconnect TikTok in Connections and connect it again, so plan.video can read its numbers."));
  }
  const videos = await loadTikTokVideos(account.id);
  const days = new Map<number, Totals>();
  for (const video of videos) {
    const day = dayOfKey(dayKeyOf(video.postedAt));
    const before = days.get(day);
    days.set(day, {
      views: (before?.views ?? 0) + video.views,
      likes: (before?.likes ?? 0) + video.likes,
      comments: (before?.comments ?? 0) + video.comments,
    });
  }
  setSyncedNumbers(`tiktok:${account.id}`, { days, posts: videos });
}

/** Totals per day, from posts' totals so far, each on the day it went out. */
function onPostingDays(posts: readonly (Totals & { postedAt: number })[]) {
  const days = new Map<number, Totals>();
  for (const post of posts) {
    const day = dayOfKey(dayKeyOf(post.postedAt));
    const before = days.get(day);
    days.set(day, {
      views: (before?.views ?? 0) + post.views,
      likes: (before?.likes ?? 0) + post.likes,
      comments: (before?.comments ?? 0) + post.comments,
    });
  }
  return days;
}

type MetaNumbers = { followers?: number | null; videos?: (Totals & { id: string; title: string; postedAt: number; cover?: string; url?: string })[] };

/** An Instagram account's, Facebook Page's or Threads profile's recent posts and followers, read by the publisher. */
async function syncMeta(account: SocialConnection, network: MetaNetwork) {
  const found = await askMeta<MetaNumbers>(network, "analytics", { connectionId: account.id }, t("Couldn't load its numbers. Try again later."));
  const posts = (found.videos ?? []).filter((post) => post.postedAt > 0);
  setSyncedNumbers(`${network}:${account.id}`, { days: onPostingDays(posts), posts, followers: found.followers ?? null });
}

/** One post's numbers for each day since it went out. Only YouTube counts a post's days. */
export async function loadPostDays(userId: string | undefined, post: AnalyticsPost): Promise<ReadonlyMap<number, Totals>> {
  const account = socialConnections().find((item) => `${item.platform}:${item.id}` === post.source);
  if (!userId || !account?.youtube || !post.networkId) throw new Error(t("This post's account isn't connected anymore."));
  const { days } = await loadYouTubeAnalytics(account.id, isoDay(post.postedAt), isoDay(Date.now()), post.networkId);
  return byDay(days);
}

/** Asks every connected account that can report its numbers, once each. */
export function syncAnalytics(userId: string | undefined, accounts: readonly SocialConnection[]) {
  if (!userId) return;
  for (const account of accounts) {
    const key = `${account.platform}:${account.id}`;
    const platform = account.platform;
    const meta = isMetaNetwork(platform) ? account[platform] : undefined;
    const scope = account.youtube?.scope ?? account.tiktok?.scope ?? meta?.scope ?? "";
    if (asked.get(key)?.scope === scope) continue;
    const run =
      account.platform === "youtube" && account.youtube
        ? syncYouTube(account)
        : account.platform === "tiktok" && account.tiktok
          ? syncTikTok(account, account.tiktok)
          : isMetaNetwork(platform) && meta
            ? syncMeta(account, platform)
            : null;
    if (!run) continue;
    mark(key, "loading");
    asked.set(key, {
      scope,
      run: run.then(
        () => mark(key, null),
        (error: unknown) => mark(key, error instanceof Error && error.message ? error.message : t("Couldn't load its numbers. Try again later.")),
      ),
    });
  }
}

/** Asks every account that can report its numbers, and waits until each has answered or failed. */
export async function analyticsSynced(userId: string | undefined, accounts: readonly SocialConnection[]) {
  syncAnalytics(userId, accounts);
  await Promise.all(accounts.map((account) => asked.get(`${account.platform}:${account.id}`)?.run));
}
