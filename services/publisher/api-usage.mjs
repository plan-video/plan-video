// Counts every call the publisher makes to a network, for the admin page: calls, failures and refusals
// for a rate limit or quota, by day, kept in api_usage. The limits networks report in their answers'
// headers are kept in memory, latest first. Counting never fails or delays a call.

const FLUSH_MS = 60_000;
const PACIFIC = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
/** The day a call counts on: YouTube's quota day starts at midnight Pacific time, everything else's at midnight UTC. */
export const dayOf = (network, at) => (network === "youtube" ? PACIFIC.format(at) : new Date(at).toISOString().slice(0, 10));
/** Error codes Meta answers when an app, page or account is over a rate limit or its publishing limit. */
const META_LIMITED = new Set([4, 17, 32, 613, 80001, 80002, 80004, 80005, 80006, 80008, 80014]);
const META_PUBLISH_LIMIT = 2207042;
const YOUTUBE_LIMITED = /"reason":\s*"(quotaExceeded|rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|uploadLimitExceeded)"/;

/** The network a URL belongs to, or null for anything else (the database, storage, email…). */
export function networkOf(url) {
  const host = url.hostname;
  if (host === "www.googleapis.com" && /^\/(upload\/)?youtube\//.test(url.pathname)) return "youtube";
  if (host === "youtubeanalytics.googleapis.com" || host === "oauth2.googleapis.com") return "youtube";
  if (host.endsWith(".tiktokapis.com")) return "tiktok";
  if (host === "api.linkedin.com" || (host === "www.linkedin.com" && url.pathname.startsWith("/oauth/"))) return "linkedin";
  if (host === "api.x.com" || host === "api.twitter.com" || host === "upload.twitter.com") return "x";
  if (host === "graph.instagram.com" || host === "api.instagram.com") return "instagram";
  if (host === "graph.threads.net") return "threads";
  if (host === "graph.facebook.com" || host === "graph-video.facebook.com" || host === "rupload.facebook.com") return "facebook";
  // Every Bluesky server answers the same API, wherever it's hosted.
  if (url.pathname.startsWith("/xrpc/")) return "bluesky";
  return null;
}

export function kindOf(network, url, method) {
  const path = url.pathname;
  if (/oauth|\/token\b|access_token|refreshSession|createSession/.test(path)) return "login";
  if (network === "youtube" && url.hostname === "youtubeanalytics.googleapis.com") return "analytics";
  // Starting an upload and searching each have their own daily bucket of calls, apart from the units.
  if (network === "youtube" && isUploadStart(url, method)) return "insert";
  if (network === "youtube" && url.pathname.startsWith("/youtube/v3/search")) return "search";
  if (/upload/.test(url.hostname) || /upload/i.test(path) || url.hostname === "graph-video.facebook.com") return "upload";
  return method === "GET" || method === "HEAD" ? "read" : "post";
}

const isUploadStart = (url, method) => method === "POST" && url.hostname === "www.googleapis.com" && url.pathname.startsWith("/upload/youtube/v3/videos") && !url.searchParams.has("upload_id");

/** What a call costs from YouTube's 10,000 daily units, as its quota table prices it. Uploads and searches have buckets of their own; the Analytics API's quota is apart. */
export function youtubeUnits(url, method) {
  if (url.hostname !== "www.googleapis.com") return 0;
  const path = url.pathname;
  if (path.startsWith("/upload/youtube/v3/videos") || path.startsWith("/youtube/v3/search")) return 0;
  if (path.startsWith("/upload/youtube/v3/thumbnails")) return 50;
  if (!path.startsWith("/youtube/v3/")) return 0;
  if (method !== "GET") return 50;
  return path.startsWith("/youtube/v3/search") ? 100 : 1;
}

const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const percent = (entry) => Math.max(number(entry?.call_count) ?? 0, number(entry?.total_cputime) ?? 0, number(entry?.total_time) ?? 0);

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The limits a network reports in an answer's headers: { label, scope, used, limit, resetAt }. */
export function limitsIn(network, headers, at) {
  const found = [];
  const get = (name) => headers.get(name);
  if (network === "facebook" || network === "instagram" || network === "threads") {
    const app = parse(get("x-app-usage"));
    if (app) found.push({ label: "app", scope: "app", used: percent(app), limit: 100 });
    // One entry per business use: pages, instagram, ads… each a share of its own hourly limit.
    const business = parse(get("x-business-use-case-usage"));
    if (business && typeof business === "object") {
      const byType = new Map();
      for (const entries of Object.values(business)) {
        for (const entry of Array.isArray(entries) ? entries : []) {
          const type = typeof entry?.type === "string" ? entry.type.toLowerCase().replace(/[^a-z_]/g, "").slice(0, 40) : "";
          if (!type) continue;
          const wait = number(entry.estimated_time_to_regain_access) ?? 0;
          const before = byType.get(type);
          if (!before || percent(entry) > before.used) {
            byType.set(type, { label: type, scope: "business", used: percent(entry), limit: 100, resetAt: wait > 0 ? at + wait * 60_000 : null });
          }
        }
      }
      found.push(...byType.values());
    }
  }
  if (network === "x") {
    for (const [prefix, label, scope] of [["x-app-limit-24hour", "posts-24h", "app"], ["x-user-limit-24hour", "account-posts-24h", "account"]]) {
      const limit = number(get(`${prefix}-limit`));
      const remaining = number(get(`${prefix}-remaining`));
      if (limit === null || remaining === null) continue;
      const reset = number(get(`${prefix}-reset`));
      found.push({ label, scope, used: Math.max(0, limit - remaining), limit, resetAt: reset ? reset * 1000 : null });
    }
  }
  if (network === "bluesky") {
    const limit = number(get("ratelimit-limit"));
    const remaining = number(get("ratelimit-remaining"));
    if (limit !== null && remaining !== null) {
      const reset = number(get("ratelimit-reset"));
      found.push({ label: "account-points", scope: "account", used: Math.max(0, limit - remaining), limit, resetAt: reset ? reset * 1000 : null });
    }
  }
  return found;
}

/** True when an error answer says a limit or quota was hit. Only read for 4xx answers that aren't a plain 429. */
export function saysLimited(network, status, text) {
  if (network === "youtube") return status === 403 && YOUTUBE_LIMITED.test(text);
  if (network === "facebook" || network === "instagram" || network === "threads") {
    const error = parse(text)?.error;
    return META_LIMITED.has(Number(error?.code)) || Number(error?.error_subcode) === META_PUBLISH_LIMIT;
  }
  if (network === "tiktok") return /rate_limit_exceeded|spam_risk_too_many_posts/.test(text);
  return false;
}

function urlOf(input) {
  try {
    return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input?.url);
  } catch {
    return null;
  }
}

export function createApiUsage({ db, now = () => Date.now(), log = console } = {}) {
  /** Counts not yet in the database, by "day|network|kind". */
  let pending = new Map();
  /** The latest of each limit seen, by "network|label". */
  const limits = new Map();
  /** Only the first of a run of failed flushes is logged: before its migration, every one fails. */
  let failing = false;

  function add(day, network, kind, counts) {
    const key = `${day}|${network}|${kind}`;
    const row = pending.get(key) ?? { day, network, kind, calls: 0, failed: 0, limited: 0, units: 0 };
    for (const [name, value] of Object.entries(counts)) row[name] += value;
    pending.set(key, row);
  }

  /** `response` is null when the call got no answer. */
  function record(input, init, response) {
    const url = urlOf(input);
    const network = url && networkOf(url);
    if (!network) return;
    const at = now();
    const day = dayOf(network, at);
    const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
    const kind = kindOf(network, url, method);
    const status = response?.status ?? 0;
    add(day, network, kind, {
      calls: 1,
      failed: status === 0 || status >= 500 ? 1 : 0,
      limited: status === 429 ? 1 : 0,
      units: network === "youtube" && status && status < 500 ? youtubeUnits(url, method) : 0,
    });
    if (!response) return;
    for (const limit of limitsIn(network, response.headers, at)) limits.set(`${network}|${limit.label}`, { network, ...limit, seenAt: at });
    if (status >= 400 && status < 500 && status !== 429 && (network === "youtube" || network === "tiktok" || network === "facebook" || network === "instagram" || network === "threads")) {
      // A copy, so the caller still reads the answer; error answers are small.
      response
        .clone()
        .text()
        .then((text) => {
          if (saysLimited(network, status, text)) add(day, network, kind, { limited: 1 });
        })
        .catch(() => {});
    }
  }

  function safely(input, init, response) {
    try {
      record(input, init, response);
    } catch (error) {
      log.warn?.("[publisher] counting an API call failed", error instanceof Error ? error.message : error);
    }
  }

  /** The same fetch, counted. */
  function wrap(fetch) {
    return async function countedFetch(input, init) {
      let response;
      try {
        response = await fetch(input, init);
      } catch (error) {
        safely(input, init, null);
        throw error;
      }
      safely(input, init, response);
      return response;
    };
  }

  /** Writes what's counted; on failure it stays to go with the next flush. */
  async function flush() {
    if (!pending.size) return;
    const rows = [...pending.values()];
    pending = new Map();
    try {
      await db.rpc("add_api_usage", { rows });
      failing = false;
    } catch (error) {
      for (const row of rows) add(row.day, row.network, row.kind, { calls: row.calls, failed: row.failed, limited: row.limited, units: row.units });
      if (!failing) log.error?.("[publisher] keeping API usage failed; counts wait in memory until it works", error instanceof Error ? error.message : error);
      failing = true;
    }
  }

  function start() {
    const timer = setInterval(() => void flush(), FLUSH_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return {
    wrap,
    flush,
    start,
    /** Counts not yet written, so a report adds them to what the database has. */
    pending: () => [...pending.values()].map((row) => ({ ...row })),
    limits: () => [...limits.values()].sort((a, b) => b.seenAt - a.seenAt),
  };
}
