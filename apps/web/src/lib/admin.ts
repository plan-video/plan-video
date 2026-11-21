/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The admin page's numbers: the publisher's report (services/publisher/admin.mjs) and the Assistant's spend
// (services/agent, /api/agent/usage), and the meters, costs and warnings worked out from them.

import { msg, t } from "@/lib/i18n";
import { planOfLevel } from "@/lib/plans";
import { PUBLISHING_PLATFORMS } from "@/lib/social";
import { supabase } from "@/lib/supabase";

export type UsageRow = { day: string; network: string; kind: string; calls: number; failed: number; limited: number; units: number };
export type SeenLimit = { network: string; label: string; scope: string; used: number; limit: number; resetAt: string | null; seenAt: string };
type Deliveries = { platform: string; sent_day: number; failed_day: number; sent_week: number; failed_week: number; waiting: number; overdue: number };

export type AdminReport = {
  at: string;
  deliveries: Deliveries[];
  busiest: { platform: string; posts: number }[];
  youtube_uploads_today: number;
  x_posts_month: number;
  x_links_month: number;
  x_owners: { user_id: string; level: number; posts: number; links: number }[];
  caption_seconds_month: number;
  people: number;
  people_week: number;
  plans: Record<string, number>;
  database_bytes: number;
  api_usage: UsageRow[];
  limits: SeenLimit[];
  networks: string[];
  health: { problems: string[]; lastPass: string | null };
  caps: { youtubeDailyUnits: number; youtubeDailyUploads?: number; xPostsByLevel: Record<string, number>; xLinksByLevel: Record<string, number>; xPostsPerDay: number };
  prices: { xPost: number; xLinkPost: number; captionHour: number };
  costs: { name: string; usd: number }[];
  /** Instagram's and Threads' own count, for the fullest account asked about; null when Meta wasn't asked or didn't answer. */
  publishing?: Record<string, { checked: number; failed: number; posts: Quota | null }> | null;
};

type Quota = { used: number; total: number };

export type AgentUsage = { model: string; usdPerMillion: number; spent: number; budget: number; freeSpent: number; resetsAt: string | null };

/** The ElevenLabs plan behind Auto-captions (services/transcribe, /api/transcribe/usage). Credits are what ElevenLabs calls characters. */
export type ElevenLabsPlan =
  | { problem?: undefined; tier: string | null; status: string | null; used: number | null; limit: number | null; resetsAt: string | null }
  | { problem: "no-key" | "no-answer" | "no-permission" | "refused"; status?: number };

export type Meter = { label: string; used: number; limit: number; unit: "count" | "percent"; resetAt?: string | null };

export type NetworkSummary = {
  id: string;
  configured: boolean;
  calls: number;
  failed: number;
  limited: number;
  sent: number;
  failedPosts: number;
  waiting: number;
  overdue: number;
  meters: Meter[];
};

/** Used when Meta's own count isn't there. Instagram's docs say 50 in some places and 100 in others: the lower. */
const ACCOUNT_POSTS_PER_DAY: Record<string, number> = { instagram: 50, threads: 250 };

/** At or past this share of a limit, the page says so at the top. */
export const NEAR = 0.8;

const LIMIT_LABELS: Record<string, string> = {
  app: msg("App rate limit, this hour"),
  pages: msg("Pages rate limit, this hour"),
  instagram: msg("Instagram rate limit, this hour"),
  "posts-24h": msg("App posts, 24 hours"),
  "account-posts-24h": msg("Last account's posts, 24 hours"),
  "account-points": msg("Last account's rate limit"),
};

const PACIFIC = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

/** As the publisher counts them: YouTube by its quota day (from midnight Pacific), the rest by UTC day. */
export function dayOf(network: string, at: string | number): string {
  const time = typeof at === "string" ? Date.parse(at) : at;
  return network === "youtube" ? PACIFIC.format(time) : new Date(time).toISOString().slice(0, 10);
}

function today(report: AdminReport, network: string) {
  const day = dayOf(network, report.at);
  const rows = report.api_usage.filter((row) => row.network === network && row.day === day);
  const uploads = rows.filter((row) => row.kind === "insert").reduce((total, row) => total + Number(row.calls ?? 0), 0);
  const sum = (name: "calls" | "failed" | "limited" | "units") => rows.reduce((total, row) => total + Number(row[name] ?? 0), 0);
  return { calls: sum("calls"), failed: sum("failed"), limited: sum("limited"), units: sum("units"), uploads };
}

export function networkSummaries(report: AdminReport): NetworkSummary[] {
  return PUBLISHING_PLATFORMS.map((id) => {
    const counted = today(report, id);
    const delivered = report.deliveries.find((row) => row.platform === id);
    const meters: Meter[] = [];
    if (id === "youtube") {
      meters.push({ label: msg("Quota today"), used: counted.units, limit: report.caps.youtubeDailyUnits, unit: "count" });
      // Starting an upload draws on a bucket of its own, for the whole app.
      meters.push({ label: msg("Uploads today, whole app"), used: counted.uploads, limit: report.caps.youtubeDailyUploads ?? 100, unit: "count" });
    }
    for (const seen of report.limits.filter((limit) => limit.network === id)) {
      meters.push({ label: LIMIT_LABELS[seen.label] ?? seen.label, used: seen.used, limit: seen.limit, unit: seen.limit === 100 && seen.scope !== "account" ? "percent" : "count", resetAt: seen.resetAt });
    }
    const live = report.publishing?.[id];
    if (live?.posts) {
      meters.push({ label: msg("Fullest account's posts, 24 hours"), used: live.posts.used, limit: live.posts.total, unit: "count" });
    } else if (ACCOUNT_POSTS_PER_DAY[id]) {
      meters.push({ label: msg("Busiest account, 24 hours (estimate)"), used: report.busiest.find((row) => row.platform === id)?.posts ?? 0, limit: ACCOUNT_POSTS_PER_DAY[id], unit: "count" });
    }
    return {
      id,
      configured: report.networks.includes(id),
      calls: counted.calls,
      failed: counted.failed,
      limited: counted.limited,
      sent: Number(delivered?.sent_day ?? 0),
      failedPosts: Number(delivered?.failed_day ?? 0),
      waiting: Number(delivered?.waiting ?? 0),
      overdue: Number(delivered?.overdue ?? 0),
      meters,
    };
  });
}

/** X bills a post with a link at its own price, not on top of a plain post's. Every X post has an "x" row; one with a link also has an "xlink" row. */
export function xSpend(report: Pick<AdminReport, "x_posts_month" | "x_links_month" | "prices">): number {
  const links = Math.min(report.x_links_month, report.x_posts_month);
  return (report.x_posts_month - links) * report.prices.xPost + links * report.prices.xLinkPost;
}

export const captionSpend = (report: Pick<AdminReport, "caption_seconds_month" | "prices">) => (Number(report.caption_seconds_month) / 3600) * report.prices.captionHour;

export const agentSpend = (agent: AgentUsage) => (agent.spent / 1_000_000) * agent.usdPerMillion;

/** What paid plans bring in a month, as if everyone paid monthly. */
export function monthlyRevenue(plans: Record<string, number>): number {
  return Object.entries(plans).reduce((total, [level, people]) => total + planOfLevel(Number(level)).price.monthly * Number(people), 0);
}

const share = (meter: Pick<Meter, "used" | "limit">) => (meter.limit > 0 ? meter.used / meter.limit : 0);

/** Anything at or near a limit, failing or late, most pressing first. */
export function attention(report: AdminReport, networks: NetworkSummary[], agent: AgentUsage | null, elevenLabs: ElevenLabsPlan | null = null): string[] {
  const found: { weight: number; text: string }[] = [];
  const name = (id: string) => NETWORK_NAMES[id] ?? id;
  for (const problem of report.health.problems) found.push({ weight: 3, text: t("Publisher: {problem}", { problem }) });
  for (const network of networks) {
    if (network.overdue) found.push({ weight: 3, text: t("{network}: {count, plural, one {# post is} other {# posts are}} over 15 minutes late", { network: name(network.id), count: network.overdue }) });
    for (const meter of network.meters) {
      if (share(meter) >= NEAR) found.push({ weight: 2 + share(meter), text: t("{network}: {label} at {percent}", { network: name(network.id), label: t(meter.label), percent: percent(share(meter)) }) });
    }
    if (network.limited) found.push({ weight: 2, text: t("{network} refused {count, plural, one {# call} other {# calls}} for a limit today", { network: name(network.id), count: network.limited }) });
    if (network.failedPosts && network.failedPosts >= network.sent) {
      found.push({ weight: 1, text: t("{network}: {failed} posts failed and {sent} went out in 24 hours", { network: name(network.id), failed: network.failedPosts, sent: network.sent }) });
    }
  }
  for (const owner of report.x_owners) {
    const cap = report.caps.xPostsByLevel[String(owner.level)] ?? 0;
    if (cap && owner.posts / cap >= NEAR) found.push({ weight: 1, text: t("X: one owner has used {posts} of their {cap} posts this month", { posts: owner.posts, cap }) });
  }
  if (elevenLabs && !elevenLabs.problem && elevenLabs.used !== null && elevenLabs.limit && elevenLabs.used / elevenLabs.limit >= NEAR) {
    found.push({ weight: 2 + elevenLabs.used / elevenLabs.limit, text: t("ElevenLabs: {percent} of this period's credits used", { percent: percent(elevenLabs.used / elevenLabs.limit) }) });
  }
  if (agent && agent.budget && agent.spent / agent.budget >= NEAR) found.push({ weight: 2, text: t("Assistant: {percent} of today's spending cap used", { percent: percent(agent.spent / agent.budget) }) });
  return found.sort((a, b) => b.weight - a.weight).map((item) => item.text);
}

export const NETWORK_NAMES: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

export const percent = (value: number) => `${Math.round(value * 100)}%`;

async function bearer(): Promise<string> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to see this page."));
  return `Bearer ${session.access_token}`;
}

export async function isAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
}

export async function loadReport(): Promise<AdminReport> {
  const response = await fetch("/api/publisher/admin/report", { method: "POST", headers: { Authorization: await bearer(), "Content-Type": "application/json" }, body: "{}" });
  const body = await response.json().catch(() => null);
  if (response.status === 404) throw new Error(t("Only admins can see this page. If you're one, the publisher may need updating."));
  if (!response.ok || !body) throw new Error(body?.error || t("The publisher didn't answer ({status}).", { status: response.status }));
  return body as AdminReport;
}

/** Null when the Assistant isn't running or doesn't answer: the rest of the page doesn't wait on it. */
export async function loadAgentUsage(): Promise<AgentUsage | null> {
  const response = await fetch("/api/agent/usage", { headers: { Authorization: await bearer() } }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as AgentUsage | null;
}

/** Null when the captions service doesn't answer: the rest of the page doesn't wait on it. */
export async function loadElevenLabs(): Promise<ElevenLabsPlan | null> {
  const response = await fetch("/api/transcribe/usage", { headers: { Authorization: await bearer() } }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as ElevenLabsPlan | null;
}
