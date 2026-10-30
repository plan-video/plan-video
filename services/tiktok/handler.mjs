// The client secret stays on the server; the publisher sends videos to TikTok itself, so no
// upload passes through here.

const TIKTOK = "https://open.tiktokapis.com";
const SCOPE = "user.info.basic,video.publish,video.upload";
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const JSON_MAX = 1024 * 1024;

/** The redirect URIs must match the ones saved on the app exactly. */
export function redirectsFor(site = "https://plan.video") {
  const own = new URL(site);
  const www = new URL(site);
  if (!www.hostname.startsWith("www.")) www.hostname = `www.${www.hostname}`;
  return new Set([`${own.origin}/tiktok/callback`, `${www.origin}/tiktok/callback`, "http://localhost:5173/tiktok/callback"]);
}

export function authorizeUrl(env, { redirectUri, state, codeChallenge }) {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", env.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", env.readVideos ? `${SCOPE},video.list` : SCOPE);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

const sessions = new Map();
const windows = new Map();

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function limit(name, max, seconds) {
  const now = Date.now();
  const entry = windows.get(name);
  if (!entry || entry.reset <= now) {
    windows.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, "Too many TikTok requests. Wait a few minutes and try again.");
}

// OAuth-client tokens (Claude's connector, say) carry `client_id` and only work at /mcp.
function grantedToApp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.client_id != null;
  } catch {
    return false;
  }
}

async function supabaseCall(env, path, token, init = {}) {
  return fetch(`${env.supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000),
  });
}

async function userFor(req, env) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to connect TikTok.");

  const cached = sessions.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall(env, "/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to connect TikTok.");
  const user = await res.json();
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to connect TikTok.");

  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  if (sessions.size > 5000) sessions.clear();
  sessions.set(token, { user: { id: user.id }, until: Date.now() + 60_000 });
  return { id: user.id };
}

export async function handleTikTok(req, res, path, env) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST." });
    return;
  }
  if (!env.clientKey || !env.clientSecret) {
    json(res, 503, { error: "TikTok isn't set up on the server yet." });
    return;
  }

  const user = await userFor(req, env);
  limit(`tiktok:${user.id}`, 120, 600);

  const body = JSON.parse((await readBody(req, JSON_MAX)).toString("utf8") || "{}");
  const text = (key) => (typeof body[key] === "string" ? body[key] : "");

  if (path === "/api/tiktok/authorize") {
    const redirectUri = text("redirectUri");
    const state = text("state");
    const codeChallenge = text("codeChallenge");
    if (!redirectsFor(env.publicUrl).has(redirectUri) || !state || !codeChallenge) {
      json(res, 400, { error: "That TikTok redirect address isn't allowed." });
      return;
    }
    json(res, 200, { url: authorizeUrl(env, { redirectUri, state, codeChallenge }) });
    return;
  }

  // Swapping the code and refreshing happen in the publisher (tiktok-logins.mjs), which keeps the
  // login and gives the browser a ticket: no browser is handed TikTok's tokens.
  if (path === "/api/tiktok/exchange" || path === "/api/tiktok/refresh") {
    json(res, 410, { error: "Reload plan.video and connect TikTok again." });
    return;
  }

  const accessToken = text("accessToken");
  if (!accessToken) {
    json(res, 400, { error: "Sign in with TikTok again." });
    return;
  }

  if (path === "/api/tiktok/profile") {
    const profile = await profileFor(accessToken);
    json(res, profile.error ? 400 : 200, profile);
    return;
  }

  if (path === "/api/tiktok/videos") {
    const result = await videosFor(accessToken);
    json(res, result.error ? 400 : 200, result);
    return;
  }

  if (path === "/api/tiktok/creator") {
    json(res, 200, await creatorFor(accessToken));
    return;
  }

  if (path === "/api/tiktok/init") {
    const videoSize = Number(body.videoSize);
    const plan = chunkPlan(videoSize);
    if (!plan) {
      json(res, 400, { error: "Choose a video first." });
      return;
    }
    const postInfo = postInfoFor({ ...body, title: text("title") });
    if (!postInfo) {
      json(res, 400, { error: "Pick who can watch." });
      return;
    }
    const result = await tiktok(accessToken, "POST", "/v2/post/publish/video/init/", {
      post_info: postInfo,
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.total,
      },
    });
    json(res, 200, { ...result, chunkSize: plan.chunkSize, total: plan.total });
    return;
  }

  if (path === "/api/tiktok/inbox") {
    const videoSize = Number(body.videoSize);
    const plan = chunkPlan(videoSize);
    if (!plan) {
      json(res, 400, { error: "Choose a video first." });
      return;
    }
    const result = await tiktok(accessToken, "POST", "/v2/post/publish/inbox/video/init/", {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.total,
      },
    });
    json(res, 200, { ...result, chunkSize: plan.chunkSize, total: plan.total });
    return;
  }

  if (path === "/api/tiktok/status") {
    json(res, 200, await tiktok(accessToken, "POST", "/v2/post/publish/status/fetch/", { publish_id: text("publishId") }));
    return;
  }

  json(res, 404, { error: "Unknown TikTok route." });
}

const PRIVACY = {
  public: "PUBLIC_TO_EVERYONE",
  friends: "MUTUAL_FOLLOW_FRIENDS",
  followers: "FOLLOWER_OF_CREATOR",
  private: "SELF_ONLY",
};

/** Null without a choice of who can watch. */
export function postInfoFor(options) {
  const privacy = PRIVACY[options.privacy];
  if (!privacy) return null;
  const coverMs = Number(options.coverTimeMs);
  const postInfo = {
    title: String(options.title ?? "").slice(0, 2200),
    privacy_level: privacy,
    disable_comment: options.disableComment === true,
    disable_duet: options.disableDuet === true,
    disable_stitch: options.disableStitch === true,
    brand_content_toggle: options.brandContent === true,
    brand_organic_toggle: options.brandOrganic === true,
  };
  if (Number.isFinite(coverMs) && coverMs >= 0) postInfo.video_cover_timestamp_ms = Math.round(coverMs);
  return postInfo;
}

export function chunkPlan(videoSize) {
  if (!Number.isFinite(videoSize) || videoSize <= 0 || videoSize > MAX_VIDEO_BYTES) return null;
  if (videoSize <= 64 * 1024 * 1024) return { chunkSize: videoSize, total: 1 };
  const chunkSize = 10 * 1024 * 1024;
  return { chunkSize, total: Math.floor(videoSize / chunkSize) };
}

export async function tokenRequest(env, fields) {
  const form = new URLSearchParams({ client_key: env.clientKey, client_secret: env.clientSecret, ...fields });
  const response = await fetch(`${TIKTOK}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const payload = await response.json().catch(() => null);
  const token = payload?.data?.access_token ? payload.data : payload;
  const accessToken = token?.access_token;
  const described =
    payload?.error_description || (typeof payload?.error === "string" ? payload.error : payload?.error?.message) || payload?.message;
  if (!response.ok || !accessToken) return { error: described || "TikTok refused the login." };
  return {
    accessToken,
    refreshToken: token?.refresh_token || "",
    expiresIn: token?.expires_in || 0,
    openId: token?.open_id || "",
    scope: token?.scope || "",
  };
}

// An answer that never came back is `unreachable`: TikTok may still have acted on it, so the
// caller decides whether trying again is safe.
export async function tiktok(accessToken, method, path, body) {
  const response = await fetch(`${TIKTOK}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  if (!response) return { error: "plan.video couldn't reach TikTok.", unreachable: true };
  const payload = await response.json().catch(() => null);
  const code = payload?.error?.code;
  if (!response.ok || (code && code !== "ok")) return { error: explain(payload?.error) };
  return { data: payload?.data ?? {} };
}

/** The link expires after a few hours, so it is never saved. */
function coverLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)(tiktokcdn(-[a-z]+)?\.com|tiktokcdn\.us|ibyteimg\.com)$/.test(url.hostname) ? url.toString() : "";
  } catch {
    return "";
  }
}

/** 20 to a page. */
const VIDEO_PAGES = 10;

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** TikTok has no numbers per day. */
export async function videosFor(accessToken) {
  const fields = "id,title,video_description,create_time,cover_image_url,view_count,like_count,comment_count,share_count";
  const videos = [];
  let cursor;
  for (let page = 0; page < VIDEO_PAGES; page++) {
    const result = await tiktok(accessToken, "POST", `/v2/video/list/?fields=${fields}`, { max_count: 20, ...(cursor ? { cursor } : {}) });
    if ("error" in result) return { error: result.error };
    for (const video of result.data?.videos ?? []) {
      if (typeof video?.id !== "string" || !Number.isFinite(video.create_time)) continue;
      const text = [video.title, video.video_description].find((value) => typeof value === "string" && value.trim());
      videos.push({
        id: video.id,
        title: text ? text.trim().split("\n")[0].slice(0, 150) : "Untitled video",
        postedAt: video.create_time * 1000,
        cover: coverLink(video.cover_image_url),
        views: count(video.view_count),
        likes: count(video.like_count),
        comments: count(video.comment_count),
      });
    }
    if (!result.data?.has_more || !result.data?.cursor) break;
    cursor = result.data.cursor;
  }
  return { videos };
}

export async function profileFor(accessToken) {
  const result = await tiktok(accessToken, "GET", "/v2/user/info/?fields=open_id,display_name,avatar_url_100");
  if ("error" in result) return { error: result.error };
  const user = result.data?.user ?? {};
  return {
    openId: user.open_id || "",
    displayName: user.display_name || "",
    avatarUrl: user.avatar_url_100 ? await inlineAvatar(user.avatar_url_100, 64 * 1024) : "",
  };
}

export async function creatorFor(accessToken) {
  const result = await tiktok(accessToken, "POST", "/v2/post/publish/creator_info/query/", {});
  if (result.data?.creator_avatar_url) result.data.creator_avatar_url = await inlineAvatar(result.data.creator_avatar_url);
  return result;
}

/** TikTok's avatar links often won't load on another site, so the picture itself goes back. */
async function inlineAvatar(url, maxBytes = 512 * 1024) {
  try {
    const host = new URL(url).hostname;
    if (!/(^|\.)(tiktokcdn(-[a-z]+)?\.com|tiktokcdn\.us|ibyteimg\.com)$/.test(host)) return "";
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !/^image\/(jpeg|png|webp|gif)/.test(type)) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) return "";
    return `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

export function explain(error) {
  if (error?.code === "unaudited_client_can_only_post_to_private_accounts") {
    return "Set the TikTok account to private, then post again. A sandbox app can only post to a private account, as Only me.";
  }
  if (
    error?.code === "spam_risk_too_many_posts" ||
    error?.code === "spam_risk_user_banned_from_posting" ||
    error?.code === "reached_active_user_cap"
  ) {
    return "TikTok isn't taking more posts from this account right now. Try again later.";
  }
  if (error?.code === "scope_not_authorized") {
    return "Disconnect TikTok in Connections and connect it again, so plan.video has the access it needs.";
  }
  if (error?.code === "url_ownership_unverified") {
    return "TikTok photo posts aren't switched on for plan.video yet. Post a video, or leave TikTok off this post.";
  }
  return error?.message || error?.code || "TikTok refused the request.";
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Refused(413, "That request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function json(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}
