// The admin page's numbers: the database's counts (admin_usage_report), the calls counted since the last
// flush, the limits networks reported, the sending's health, and the caps and prices the page measures
// against. Only people in public.admins get it; anyone else is told the route doesn't exist.

import { X_LINK_POSTS_BY_LEVEL, X_POSTS_BY_LEVEL, X_POSTS_PER_DAY, YOUTUBE_UPLOADS_BY_LEVEL } from "./plans.mjs";

/** What each X post costs plan.video, in US dollars (developer console pricing, pay per use). */
export const X_POST_USD = 0.015;
export const X_LINK_POST_USD = 0.2;
/** ElevenLabs Scribe, per hour of audio Auto-Captions sends. */
export const CAPTION_HOUR_USD = 0.22;
/** Google's default daily quota for a project's YouTube Data API. */
export const YOUTUBE_DAILY_UNITS = 10_000;

/** "Hetzner=7.5,Supabase=25" from ADMIN_MONTHLY_COSTS: fixed monthly costs in US dollars, for the page's cost table. */
export function monthlyCosts(text) {
  return String(text ?? "")
    .split(",")
    .map((part) => part.split("="))
    .map(([name, amount]) => ({ name: String(name ?? "").trim().slice(0, 60), usd: Number(amount) }))
    .filter((cost) => cost.name && Number.isFinite(cost.usd) && cost.usd >= 0);
}

/** Today's counts in memory, added to the rows the database has. */
export function withPending(rows, pending) {
  const merged = new Map(rows.map((row) => [`${row.day}|${row.network}|${row.kind}`, { ...row }]));
  for (const row of pending) {
    const key = `${row.day}|${row.network}|${row.kind}`;
    const before = merged.get(key);
    if (!before) merged.set(key, { ...row });
    else for (const name of ["calls", "failed", "limited", "units"]) before[name] = Number(before[name] ?? 0) + row[name];
  }
  return [...merged.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

export function createAdmin({ db, usage, networks, health, passes, youtubeDailyUnits, xCaps, youtubeShares, costs = [], now = () => Date.now() }) {
  const allowed = async (userId) => !!(await db.selectOne("admins", { user_id: userId }, "user_id").catch(() => null));

  async function report() {
    const counted = (await db.rpc("admin_usage_report")) ?? {};
    return {
      ...counted,
      at: new Date(now()).toISOString(),
      api_usage: withPending(counted.api_usage ?? [], usage.pending()),
      limits: usage.limits().map((limit) => ({ ...limit, seenAt: new Date(limit.seenAt).toISOString(), resetAt: limit.resetAt ? new Date(limit.resetAt).toISOString() : null })),
      networks: Object.keys(networks).sort(),
      health: { problems: health.report(), lastPass: passes.last() },
      caps: {
        youtubeDailyUnits: youtubeDailyUnits || YOUTUBE_DAILY_UNITS,
        youtubeUploadsByLevel: youtubeShares ?? YOUTUBE_UPLOADS_BY_LEVEL,
        xPostsByLevel: xCaps?.posts ?? X_POSTS_BY_LEVEL,
        xLinksByLevel: xCaps?.links ?? X_LINK_POSTS_BY_LEVEL,
        xPostsPerDay: X_POSTS_PER_DAY,
      },
      prices: { xPost: X_POST_USD, xLinkPost: X_LINK_POST_USD, captionHour: CAPTION_HOUR_USD },
      costs,
    };
  }

  return { allowed, report };
}
