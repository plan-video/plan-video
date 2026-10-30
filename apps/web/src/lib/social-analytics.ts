/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A connected account shows only what its network sent. The homepage chart and guest demo draw sample data
// seeded by the date, so it stays put between visits.

import { createSignal } from "solid-js";

import { intlLocale, localized, msg, t } from "@/lib/i18n";
import type { PlatformId } from "@/lib/social";
import { zonedParts, zonedTime } from "@/lib/time-zone";

export type AnalyticsPlatformId = Extract<PlatformId, "tiktok" | "youtube" | "instagram" | "facebook" | "threads">;
export type AnalyticsMetric = "views" | "likes" | "comments";

export type AnalyticsPlatform = {
  id: AnalyticsPlatformId;
  name: string;
  /** Reads on a dark chart; TikTok's own black does not. */
  color: string;
};

export const ANALYTICS_PLATFORMS: readonly AnalyticsPlatform[] = [
  { id: "tiktok", name: "TikTok", color: "#2fd6e6" },
  { id: "youtube", name: "YouTube", color: "#ff4d4d" },
  { id: "instagram", name: "Instagram", color: "#d65cf0" },
  { id: "facebook", name: "Facebook", color: "#4a8cff" },
  { id: "threads", name: "Threads", color: "#b8bcc6" },
];

export const ANALYTICS_METRICS: readonly { id: AnalyticsMetric; label: string }[] = [
  { id: "views", label: msg("Views") },
  { id: "likes", label: msg("Likes") },
  { id: "comments", label: msg("Comments") },
];

export type Totals = Record<AnalyticsMetric, number>;

export type Interval = "hour" | "day" | "week" | "month";

export const INTERVALS: readonly { id: Interval; label: string }[] = [
  { id: "hour", label: msg("Hourly") },
  { id: "day", label: msg("Daily") },
  { id: "week", label: msg("Weekly") },
  { id: "month", label: msg("Monthly") },
];

/** In milliseconds, end excluded. */
export type Span = { start: number; end: number };

export type AnalyticsSource = {
  key: string;
  platform: AnalyticsPlatformId;
  account?: string;
  handle?: string;
  /** As in guest mode's demo. */
  sample?: boolean;
};

export type AnalyticsPost = Totals & {
  id: string;
  /** For asking the network about this one post. */
  networkId?: string;
  cover?: string;
  /** When the network said. */
  url?: string;
  title: string;
  platform: AnalyticsPlatformId;
  /** `key` of the source it was posted from. */
  source: string;
  handle?: string;
  postedAt: number;
};

export type AnalyticsReport = {
  sample: boolean;
  interval: Interval;
  buckets: readonly Span[];
  /** The last bucket is still filling up. */
  live: boolean;
  /** Per source `key`. */
  series: Record<string, readonly Totals[]>;
  /** Counted once over the whole span, so rounding each bucket doesn't add up wrong. */
  totals: Record<string, Totals>;
  /** The same length of time just before. */
  previous: Record<string, Totals>;
  posts: readonly AnalyticsPost[];
};

/** `days` by day number. */
export type SyncedNumbers = {
  days: ReadonlyMap<number, Totals>;
  posts: readonly (Totals & { id: string; title: string; postedAt: number; cover?: string; url?: string })[];
  followers?: number | null;
};

const [synced, setSynced] = createSignal<ReadonlyMap<string, SyncedNumbers>>(new Map());

/** By `AnalyticsSource.key`. */
export function setSyncedNumbers(key: string, numbers: SyncedNumbers) {
  setSynced((current) => new Map(current).set(key, numbers));
}

/** Null when its network didn't say. */
export function followersOf(key: string): number | null {
  return synced().get(key)?.followers ?? null;
}

export function hasSyncedNumbers(key: string) {
  return synced().has(key);
}

/** Counted the way the charts count days. */
export function dayOfKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / DAY_MS);
}

export const HISTORY_DAYS = 730;

type Profile = {
  views: number;
  growth: number;
  likeRate: number;
  commentRate: number;
  weekend: number;
  postRate: number;
  peak: number;
};

const PROFILES: Record<AnalyticsPlatformId, Profile> = {
  tiktok: { views: 14200, growth: 0.0055, likeRate: 0.071, commentRate: 0.0041, weekend: 1.18, postRate: 0.45, peak: 20.5 },
  youtube: { views: 5300, growth: 0.0038, likeRate: 0.042, commentRate: 0.0032, weekend: 1.26, postRate: 0.18, peak: 18.5 },
  instagram: { views: 7700, growth: 0.0024, likeRate: 0.057, commentRate: 0.0025, weekend: 1.08, postRate: 0.34, peak: 19.5 },
  facebook: { views: 2300, growth: -0.0018, likeRate: 0.025, commentRate: 0.0019, weekend: 0.92, postRate: 0.22, peak: 13 },
  threads: { views: 3100, growth: 0.0042, likeRate: 0.048, commentRate: 0.0062, weekend: 1.02, postRate: 0.5, peak: 21 },
};

const TITLES = [
  msg("Founder Q&A"),
  msg("Studio tour"),
  msg("Weekly tip"),
  msg("Podcast clip"),
  msg("Case study"),
  msg("On set"),
  msg("Launch teaser"),
  msg("How it works"),
  msg("Walkthrough"),
  msg("BTS reel"),
  msg("Q&A clip"),
  msg("Sunday vlog"),
  msg("Launch recap"),
  msg("Two-minute edit"),
  msg("Before and after"),
  msg("Day in the studio"),
  msg("Five hooks that work"),
  msg("Client shoot"),
  msg("What we use to film"),
  msg("Captions, start to finish"),
];

const COVERS = ["creator", "surf", "sunset", "vlogger", "wave", "ride", "golden", "shore"].map((name) => `/site/${name}.webp`);

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** In the dashboard's time zone, counted from 1970. */
function dayNumber(date: Date) {
  const parts = zonedParts(date);
  return Math.floor(Date.UTC(parts.year, parts.month, parts.date) / DAY_MS);
}

/** In the dashboard's time zone. */
export function dayKeyOf(time: number) {
  return new Date(dayNumber(new Date(time)) * DAY_MS).toISOString().slice(0, 10);
}

/** In the dashboard's time zone. */
export function startOfDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return zonedTime(year!, month! - 1, day!);
}

function startOf(time: number, interval: Interval) {
  const parts = zonedParts(time);
  if (interval === "hour") return Math.floor(time / 1000) * 1000 - (parts.minutes * 60 + parts.seconds) * 1000;
  if (interval === "day") return zonedTime(parts.year, parts.month, parts.date);
  if (interval === "week") return zonedTime(parts.year, parts.month, parts.date - ((parts.weekday + 6) % 7));
  return zonedTime(parts.year, parts.month, 1);
}

function advance(time: number, interval: Interval) {
  if (interval === "hour") return startOf(time + HOUR_MS, "hour");
  const parts = zonedParts(time);
  if (interval === "day") return zonedTime(parts.year, parts.month, parts.date + 1);
  if (interval === "week") return zonedTime(parts.year, parts.month, parts.date + 7);
  return zonedTime(parts.year, parts.month + 1, 1);
}

/** Cut to the span at either end. */
export function bucketsFor(span: Span, interval: Interval): Span[] {
  const list: Span[] = [];
  for (let cursor = startOf(span.start, interval); cursor < span.end; cursor = advance(cursor, interval)) {
    list.push({ start: Math.max(cursor, span.start), end: Math.min(advance(cursor, interval), span.end) });
  }
  return list;
}

export function intervalsFor(span: Span): Interval[] {
  const days = (span.end - span.start) / DAY_MS;
  const list: Interval[] = [];
  if (days <= 14) list.push("hour");
  if (days > 2) list.push("day");
  if (days >= 14) list.push("week");
  if (days >= 60) list.push("month");
  return list;
}

export function defaultInterval(span: Span): Interval {
  const days = (span.end - span.start) / DAY_MS;
  if (days <= 2) return "hour";
  if (days <= 120) return "day";
  if (days <= 400) return "week";
  return "month";
}

/** 0 to 1, deterministic. */
function noise(...parts: (string | number)[]) {
  let hash = 2166136261;
  for (const char of parts.join(":")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}

function burst(seed: string, day: number) {
  return noise(seed, day, "burst") < 0.07 ? 1.4 + noise(seed, day, "size") * 2.4 : 0;
}

/** Growth that flattens further back, so two years ago is smaller without being nothing. */
function trend(profile: Profile, day: number, today: number) {
  return Math.exp(profile.growth * 180 * Math.tanh((day - today) / 180));
}

function bell(value: number, center: number, width: number) {
  return Math.exp(-((value - center) ** 2) / (2 * width * width));
}

const ZERO: Totals = { views: 0, likes: 0, comments: 0 };

const fromNetwork = (source: AnalyticsSource) => !!source.account && !source.sample;
const dayCache = new Map<string, Totals>();
const hourCache = new Map<string, number[]>();

function dayStats(source: AnalyticsSource, day: number, today: number): Totals {
  // An account never shows sample numbers: until its network answers, it has none.
  if (fromNetwork(source)) return synced().get(source.key)?.days.get(day) ?? ZERO;
  if (day < today - HISTORY_DAYS || day > today) return ZERO;
  const key = `${source.key}:${day}:${today}`;
  const cached = dayCache.get(key);
  if (cached) return cached;
  const seed = source.key;
  const profile = PROFILES[source.platform];
  const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
  const lift = 1 + burst(seed, day) + 0.45 * burst(seed, day - 1) + 0.15 * burst(seed, day - 2);
  const views =
    profile.views * trend(profile, day, today) * lift * (weekday >= 5 ? profile.weekend : 1) * (0.84 + 0.32 * noise(seed, day, "views"));
  const stats = {
    views,
    likes: views * profile.likeRate * (0.85 + 0.3 * noise(seed, day, "likes")),
    comments: views * profile.commentRate * (0.7 + 0.6 * noise(seed, day, "comments")),
  };
  dayCache.set(key, stats);
  return stats;
}

/** Adds up to 1. */
function hourShares(source: AnalyticsSource, day: number) {
  const key = `${source.key}:${day}`;
  const cached = hourCache.get(key);
  if (cached) return cached;
  const profile = PROFILES[source.platform];
  const weekend = (new Date(day * DAY_MS).getUTCDay() + 6) % 7 >= 5;
  const peak = profile.peak + (weekend ? 1 : 0);
  const raw = Array.from({ length: 24 }, (_, hour) =>
    (bell(hour, peak, 2.4) + 0.5 * bell(hour, 12.5, 1.3) + 0.2 * bell(hour, 8, 1.4) + 0.04) * (0.7 + 0.6 * noise(source.key, day, hour, "hour")),
  );
  const total = raw.reduce((sum, value) => sum + value, 0);
  const shares = raw.map((value) => value / total);
  hourCache.set(key, shares);
  return shares;
}

function add(total: Totals, row: Totals, share = 1): Totals {
  return {
    views: total.views + row.views * share,
    likes: total.likes + row.likes * share,
    comments: total.comments + row.comments * share,
  };
}

function round(row: Totals): Totals {
  return { views: Math.round(row.views), likes: Math.round(row.likes), comments: Math.round(row.comments) };
}

function spanTotals(source: AnalyticsSource, span: Span, today: number): Totals {
  let total = ZERO;
  let cursor = span.start;
  while (cursor < span.end) {
    const date = new Date(cursor);
    const parts = zonedParts(date);
    const dayStart = zonedTime(parts.year, parts.month, parts.date);
    const dayEnd = zonedTime(parts.year, parts.month, parts.date + 1);
    const stop = Math.min(span.end, dayEnd);
    const day = dayNumber(date);
    const stats = dayStats(source, day, today);
    if (cursor === dayStart && stop === dayEnd) {
      total = add(total, stats);
    } else if (fromNetwork(source)) {
      // Networks count whole days: a day counts where it starts, so today counts as far as it has got.
      if (cursor === dayStart) total = add(total, stats);
    } else if (stats.views) {
      const shares = hourShares(source, day);
      let share = 0;
      for (let hour = 0; hour < 24; hour++) {
        const from = zonedTime(parts.year, parts.month, parts.date, hour);
        const overlap = Math.min(stop, from + HOUR_MS) - Math.max(cursor, from);
        if (overlap > 0) share += shares[hour]! * (overlap / HOUR_MS);
      }
      total = add(total, stats, share);
    }
    cursor = stop;
  }
  return total;
}

function sum(rows: readonly Totals[]): Totals {
  return rows.reduce((total, row) => ({
    views: total.views + row.views,
    likes: total.likes + row.likes,
    comments: total.comments + row.comments,
  }), ZERO);
}

function posts(sources: readonly AnalyticsSource[], span: Span, today: number): AnalyticsPost[] {
  const list: AnalyticsPost[] = [];
  const first = dayNumber(new Date(span.start));
  const last = dayNumber(new Date(span.end - 1));
  for (const source of sources) {
    const { platform, key: seed } = source;
    if (fromNetwork(source)) {
      for (const post of synced().get(seed)?.posts ?? []) {
        if (post.postedAt < span.start || post.postedAt >= span.end) continue;
        list.push({ ...post, id: `${seed}-${post.id}`, networkId: post.id, platform, source: seed, handle: source.handle });
      }
      continue;
    }
    const profile = PROFILES[platform];
    for (let day = Math.max(first, today - HISTORY_DAYS); day <= Math.min(last, today); day++) {
      if (noise(seed, day, "post") >= profile.postRate) continue;
      const [year, month, date] = new Date(day * DAY_MS).toISOString().slice(0, 10).split("-").map(Number);
      const postedAt = zonedTime(year!, month! - 1, date!, 9 + Math.floor(noise(seed, day, "at") * 13), 0);
      if (postedAt < span.start || postedAt >= span.end) continue;
      const reach = 0.35 + 3.2 * noise(seed, day, "reach") ** 3 + burst(seed, day);
      const views = Math.round(profile.views * reach * trend(profile, day, today));
      list.push({
        id: `${seed}-${day}`,
        title: t(TITLES[Math.floor(noise(seed, day, "title") * TITLES.length)]!),
        cover: COVERS[Math.floor(noise(seed, day, "cover") * COVERS.length)]!,
        platform,
        source: source.key,
        handle: source.handle,
        postedAt,
        views,
        likes: Math.round(views * profile.likeRate * (0.75 + 0.5 * noise(seed, day, "post-likes"))),
        comments: Math.round(views * profile.commentRate * (0.6 + 0.9 * noise(seed, day, "post-comments"))),
      });
    }
  }
  return list;
}

/** Monday first, hour 0 to 23, from 0 to 1. */
export function activityGrid(platforms: readonly AnalyticsPlatformId[]): number[][] {
  const grid = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => {
      let value = 0;
      for (const id of platforms) {
        const profile = PROFILES[id];
        const peak = profile.peak + (weekday >= 5 ? 1 : 0);
        value += profile.views * (bell(hour, peak, 2.4) + 0.5 * bell(hour, 12.5, 1.3) + 0.2 * bell(hour, 8, 1.4) + 0.04);
      }
      const day = weekday === 4 ? 1.12 : weekday >= 5 ? 1.08 : weekday === 0 ? 0.9 : 1;
      return value * day * (0.9 + 0.2 * noise("activity", weekday, hour));
    }),
  );
  const max = Math.max(...grid.flat());
  return grid.map((row) => row.map((value) => (max ? value / max : 0)));
}

/** For the homepage's chart. */
export function sampleSources(): AnalyticsSource[] {
  return ANALYTICS_PLATFORMS.map(({ id: platform }) => ({ key: platform, platform }));
}

type NumbersAccount = { platform: string; youtube?: unknown; tiktok?: unknown; instagram?: unknown; facebook?: unknown; threads?: unknown };

export function reportsNumbers(account: NumbersAccount) {
  const { platform } = account;
  return (
    (platform === "youtube" || platform === "tiktok" || platform === "instagram" || platform === "facebook" || platform === "threads") &&
    !!account[platform]
  );
}

/** With `sample` (guest demo), the accounts have no logins and show sample numbers. */
export function analyticsSources(
  accounts: readonly ({ id: string; handle: string } & NumbersAccount)[],
  { sample = false } = {},
): AnalyticsSource[] {
  return ANALYTICS_PLATFORMS.flatMap(({ id: platform }) =>
    accounts
      .filter((account) => account.platform === platform && (sample || reportsNumbers(account)))
      .map((account) => ({ key: `${platform}:${account.id}`, platform, account: account.id, handle: account.handle, ...(sample ? { sample } : {}) })),
  );
}

export function analyticsReport(span: Span, interval: Interval, sources: readonly AnalyticsSource[], now = Date.now()): AnalyticsReport {
  const today = dayNumber(new Date(now));
  const clipped = { start: span.start, end: Math.max(span.start + 60_000, Math.min(span.end, now)) };
  const buckets = bucketsFor(clipped, interval);
  const length = clipped.end - clipped.start;
  const series: Record<string, Totals[]> = {};
  const previous: Record<string, Totals> = {};
  const whole: Record<string, Totals> = {};
  for (const source of sources) {
    series[source.key] = buckets.map((bucket) => round(spanTotals(source, bucket, today)));
    whole[source.key] = round(spanTotals(source, clipped, today));
    previous[source.key] = round(spanTotals(source, { start: clipped.start - length, end: clipped.start }, today));
  }
  const last = buckets.at(-1);
  const live = !!last && span.end >= now - 60_000 && last.end < advance(startOf(last.start, interval), interval);
  const sample = sources.some((source) => !synced().has(source.key));
  return { sample, interval, buckets, live, series, totals: whole, previous, posts: posts(sources, clipped, today) };
}

export type PostTimeline = {
  interval: Interval;
  buckets: readonly Span[];
  live: boolean;
  series: readonly Totals[];
};

/** Networks count whole days, so the chart starts at the start of that day. */
export function postTimeline(days: ReadonlyMap<number, Totals>, postedAt: number, now = Date.now()): PostTimeline {
  const start = startOf(postedAt, "day");
  const end = Math.max(postedAt + 60_000, now);
  const interval: Interval = (end - start) / DAY_MS <= 90 ? "day" : "week";
  const buckets = bucketsFor({ start, end }, interval);
  const series = buckets.map((bucket) => {
    let total = ZERO;
    for (let cursor = bucket.start; cursor < bucket.end; cursor = advance(cursor, "day")) {
      total = add(total, days.get(dayNumber(new Date(cursor))) ?? ZERO);
    }
    return total;
  });
  const last = buckets.at(-1);
  const live = !!last && last.end < advance(startOf(last.start, interval), interval);
  return { interval, buckets, live, series };
}

/** Most come in the first few days. */
export function samplePostDays(post: AnalyticsPost, now = Date.now()): ReadonlyMap<number, Totals> {
  const first = dayNumber(new Date(post.postedAt));
  const last = Math.max(first, dayNumber(new Date(now)));
  const weights: number[] = [];
  for (let day = first; day <= last; day++) weights.push(Math.exp(-(day - first) / 2.5) * (0.75 + 0.5 * noise(post.id, day, "day")));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  return new Map(weights.map((weight, index) => [first + index, round({ views: post.views * (weight / sum), likes: post.likes * (weight / sum), comments: post.comments * (weight / sum) })]));
}

export function totals(rows: readonly Totals[]): Totals {
  return sum(rows);
}

export function engagement(row: Totals) {
  return row.views ? (row.likes + row.comments) / row.views : 0;
}

/** As a fraction. Undefined with nothing to compare. */
export function change(current: number, before: number) {
  return before ? (current - before) / before : undefined;
}

const compact = localized((locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), "en");
const whole = localized((locale) => new Intl.NumberFormat(locale), "en");

export function compactNumber(value: number) {
  return compact().format(value);
}

export function fullNumber(value: number) {
  return whole().format(value);
}

export function percent(value: number, digits = 1) {
  const locale = intlLocale();
  // English keeps its fixed form; other languages write a percentage their way.
  if (!locale) return `${(value * 100).toFixed(digits)}%`;
  return new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
