// Instagram's and Threads' own count of what each account may still publish in 24 hours, for the admin page.
// Read for the accounts that posted in the last day, with their logins as kept (never renewed or saved
// here), and only the numbers go out: no account, login or name. Kept a few minutes, so opening the page
// again doesn't ask Meta again.

import { API, metaFetch } from "./meta.mjs";

const DAY_MS = 24 * 60 * 60_000;
const KEEP_MS = 5 * 60_000;
/** The most accounts asked about at once; the busiest come first. */
const MOST = 25;

const ASK = {
  instagram: (id) => `${API.instagram}/${encodeURIComponent(id)}/content_publishing_limit?fields=quota_usage,config`,
  threads: (id) => `${API.threads}/${encodeURIComponent(id)}/threads_publishing_limit?fields=quota_usage,config,reply_quota_usage,reply_config`,
};

const quota = (used, config) => {
  const total = Number(config?.quota_total);
  return Number.isFinite(total) && total > 0 ? { used: Math.max(0, Number(used) || 0), total } : null;
};

/** The fuller of two quotas, by share used. */
const fuller = (a, b) => (!a ? b : !b ? a : b.used / b.total > a.used / a.total ? b : a);

/** What one account has used: `posts`, and for Threads `replies` too. Null when Meta didn't say. */
export function readQuota(network, data) {
  const entry = Array.isArray(data?.data) ? data.data[0] : null;
  if (!entry) return null;
  const posts = quota(entry.quota_usage, entry.config);
  if (!posts) return null;
  return network === "threads" ? { posts, replies: quota(entry.reply_quota_usage, entry.reply_config) } : { posts };
}

export function createPublishingLimits({ db, vault, now = () => Date.now(), fetchQuota = metaFetch }) {
  let kept = null;
  let asking = null;

  /** Accounts that sent in the last day, busiest first; for a network with none, any one login, to show its limit. */
  async function accounts() {
    const since = new Date(now() - DAY_MS).toISOString();
    const sent = await db.call("GET", `post_deliveries?select=user_id,connection_id,platform&platform=in.(instagram,threads)&state=eq.sent&updated_at=gte.${since}&limit=1000`);
    const counts = new Map();
    for (const row of sent ?? []) {
      const key = `${row.platform}|${row.user_id}|${row.connection_id}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const picked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key.split("|"));
    for (const network of Object.keys(ASK)) {
      if (picked.some(([platform]) => platform === network)) continue;
      const [any] = await db.select("social_tokens", { platform: network }, "user_id,connection_id", "&limit=1");
      if (any) picked.push([network, any.user_id, any.connection_id]);
    }
    return picked.slice(0, MOST).map(([network, userId, connectionId]) => ({ network, userId, connectionId }));
  }

  async function ask() {
    const found = { instagram: { checked: 0, failed: 0, posts: null }, threads: { checked: 0, failed: 0, posts: null, replies: null } };
    for (const { network, userId, connectionId } of await accounts()) {
      const login = await vault.read(userId, connectionId).catch(() => null);
      const session = login?.platform === network ? login.session : null;
      if (!session?.accountId || !session?.accessToken || (session.expiresAt && session.expiresAt <= now())) continue;
      const answer = await fetchQuota(ASK[network](session.accountId), { token: session.accessToken, timeout: 10_000 });
      const used = answer.ok ? readQuota(network, answer.data) : null;
      const result = found[network];
      if (!used) {
        result.failed += 1;
        continue;
      }
      result.checked += 1;
      result.posts = fuller(result.posts, used.posts);
      if (network === "threads") result.replies = fuller(result.replies, used.replies);
    }
    return found;
  }

  return {
    /** Per network, the fullest account's posts (and Threads' replies) against the limit Meta reports. */
    async read() {
      if (kept && now() - kept.at < KEEP_MS) return kept.value;
      asking ??= ask()
        .then((value) => {
          kept = { at: now(), value };
          return value;
        })
        .finally(() => {
          asking = null;
        });
      return asking;
    },
  };
}
