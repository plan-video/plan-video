// The numbers the dashboard shows for Instagram, Facebook Page and Threads
// accounts: each recent post's views, likes and comments so far, and how many
// follow the account. Like TikTok's, a post's numbers are its totals, which
// the dashboard counts on the day it went out.
//
// Views come from each network's insights, which older posts and some kinds
// of post don't have: those count no views, rather than failing the lot.

import { API, META_NAMES, metaFetch } from "./meta.mjs";

/** Recent posts read, newest first. */
const MOST = 100;
const PAGE = 50;
/** Threads' numbers are asked post by post, this many at once. */
const AT_ONCE = 5;

const count = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const title = (text) => (typeof text === "string" ? text.trim().split("\n")[0].slice(0, 120) : "");

/** One insight's number from Meta's `{ data: [{ name, values: [{ value }] | total_value: { value } }] }`. */
function insight(insights, name) {
  const found = (insights?.data ?? []).find((item) => item?.name === name);
  return count(found?.total_value?.value ?? found?.values?.[0]?.value);
}

/**
 * Reads pages of a list, up to MOST items. When the first page fails, tries
 * each of `fallbacks` in turn, asking for less: insights fail for posts that
 * have none, and some fields need a permission the login may not have.
 */
async function listOf(url, token, ...fallbacks) {
  const items = [];
  let next = url;
  let first = true;
  while (next && items.length < MOST) {
    let page = await metaFetch(next, { token: first ? token : undefined });
    for (const fallback of first ? fallbacks : []) {
      if (page.ok) break;
      page = await metaFetch(fallback, { token });
    }
    if (!page.ok) {
      if (first) return { error: page.error };
      break;
    }
    items.push(...(page.data?.data ?? []));
    next = typeof page.data?.paging?.next === "string" ? page.data.paging.next : null;
    first = false;
  }
  return { items: items.slice(0, MOST) };
}

async function instagram(session) {
  const fields = "id,caption,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count";
  const base = `${API.instagram}/me/media?limit=${PAGE}&fields=`;
  const [listed, me] = await Promise.all([
    listOf(`${base}${encodeURIComponent(`${fields},insights.metric(views)`)}`, session.accessToken, `${base}${encodeURIComponent(fields)}`),
    metaFetch(`${API.instagram}/me?fields=followers_count`, { token: session.accessToken }),
  ]);
  if (listed.error) return { error: listed.error.message || "Couldn't read the Instagram account's posts." };
  return {
    followers: me.ok ? count(me.data?.followers_count) : null,
    videos: listed.items.map((item) => ({
      id: String(item.id),
      title: title(item.caption),
      postedAt: Date.parse(item.timestamp) || 0,
      cover: item.thumbnail_url || item.media_url || "",
      url: item.permalink || "",
      views: insight(item.insights, "views"),
      likes: count(item.like_count),
      comments: count(item.comments_count),
    })),
  };
}

async function facebook(session) {
  const fields = "id,message,created_time,permalink_url,full_picture";
  // Reactions and comments come from other people, so Meta wants
  // pages_read_user_content for them: a Page logged in without it still gets
  // its posts and views, with no likes or comments.
  const people = ",reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";
  const views = ",insights.metric(post_media_view)";
  const base = `${API.facebook}/${session.accountId}/published_posts?limit=${PAGE}&fields=`;
  const ask = (more) => `${base}${encodeURIComponent(fields + more)}`;
  const [listed, page] = await Promise.all([
    listOf(ask(people + views), session.accessToken, ask(views), ask(people), ask("")),
    metaFetch(`${API.facebook}/${session.accountId}?fields=followers_count,fan_count`, { token: session.accessToken }),
  ]);
  if (listed.error) return { error: listed.error.message || "Couldn't read the Page's posts." };
  return {
    followers: page.ok ? count(page.data?.followers_count ?? page.data?.fan_count) : null,
    videos: listed.items.map((item) => ({
      id: String(item.id),
      title: title(item.message),
      postedAt: Date.parse(item.created_time) || 0,
      cover: item.full_picture || "",
      url: item.permalink_url || "",
      views: insight(item.insights, "post_media_view"),
      likes: count(item.reactions?.summary?.total_count),
      comments: count(item.comments?.summary?.total_count),
    })),
  };
}

async function threads(session) {
  const fields = "id,text,timestamp,permalink,thumbnail_url,media_url,media_type";
  const [listed, followers] = await Promise.all([
    listOf(`${API.threads}/me/threads?limit=${PAGE}&fields=${encodeURIComponent(fields)}`, session.accessToken),
    metaFetch(`${API.threads}/me/threads_insights?metric=followers_count`, { token: session.accessToken }),
  ]);
  if (listed.error) return { error: listed.error.message || "Couldn't read the Threads profile's posts." };
  // Reposts of other people's posts have no numbers of their own.
  const own = listed.items.filter((item) => item.media_type !== "REPOST_FACADE");
  const numbers = new Map();
  for (let at = 0; at < own.length; at += AT_ONCE) {
    await Promise.all(
      own.slice(at, at + AT_ONCE).map(async (item) => {
        const answer = await metaFetch(`${API.threads}/${item.id}/insights?metric=views,likes,replies`, { token: session.accessToken });
        if (answer.ok) numbers.set(item.id, answer.data);
      }),
    );
  }
  return {
    followers: followers.ok ? insight(followers.data, "followers_count") : null,
    videos: own.map((item) => ({
      id: String(item.id),
      title: title(item.text),
      postedAt: Date.parse(item.timestamp) || 0,
      cover: item.thumbnail_url || (item.media_type === "IMAGE" ? item.media_url || "" : ""),
      url: item.permalink || "",
      views: insight(numbers.get(item.id), "views"),
      likes: insight(numbers.get(item.id), "likes"),
      comments: insight(numbers.get(item.id), "replies"),
    })),
  };
}

/** An account's recent posts with their numbers, and its followers: `{ followers, videos }`, or `{ error }`. */
export async function analyticsFor(network, session) {
  try {
    if (network === "instagram") return await instagram(session);
    if (network === "facebook") return await facebook(session);
    return await threads(session);
  } catch {
    return { error: `Couldn't reach ${META_NAMES[network]}. Try again in a moment.` };
  }
}
