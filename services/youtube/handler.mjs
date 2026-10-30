// The client secret and YouTube's tokens stay on the server: the publisher keeps the login
// (services/publisher/youtube-logins.mjs), so no browser can upload around plan.video's
// share of YouTube's daily quota.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const JSON_MAX = 1024 * 1024;
const SCOPE = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const REPORTS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
/** Covers the analytics page's two years and a little more. */
const ANALYTICS_DAYS = 800;

/** The redirect URIs must match the ones saved on the app exactly. */
export function redirectsFor(site = "https://plan.video") {
  const own = new URL(site);
  const www = new URL(site);
  if (!www.hostname.startsWith("www.")) www.hostname = `www.${www.hostname}`;
  return new Set([`${own.origin}/youtube/callback`, `${www.origin}/youtube/callback`, "http://localhost:5173/youtube/callback"]);
}

export function authorizeUrl(env, { redirectUri, state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

const SESSIONS = new Map();
const WINDOWS = new Map();

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function limit(name, max, seconds) {
  const now = Date.now();
  const entry = WINDOWS.get(name);
  if (!entry || entry.reset <= now) {
    WINDOWS.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, "Too many YouTube requests. Wait a few minutes and try again.");
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
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to connect YouTube.");

  const cached = SESSIONS.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall(env, "/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to connect YouTube.");
  const user = await res.json();
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to connect YouTube.");

  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  if (SESSIONS.size > 5000) SESSIONS.clear();
  SESSIONS.set(token, { user: { id: user.id }, until: Date.now() + 60_000 });
  return { id: user.id };
}

function allowedUpload(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hostname === "www.googleapis.com" &&
      url.pathname.startsWith("/upload/youtube/v3/")
    );
  } catch {
    return false;
  }
}

export function clip(text, max) {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

export function explain(payload) {
  const reason = payload?.error?.errors?.[0]?.reason || (typeof payload?.error === "string" ? payload.error : "");
  const message = payload?.error?.message || payload?.error_description;
  if (reason === "quotaExceeded") return "YouTube's daily limit for this app is used up. Try again tomorrow.";
  if (reason === "uploadLimitExceeded") return "This channel has hit YouTube's upload limit. Try again later.";
  if (reason === "invalidTags" || reason === "invalidTagsTooLong") return "YouTube didn't accept those tags. Each one can be 30 characters.";
  if (reason === "forbidden" || reason === "insufficientPermissions") {
    return "YouTube refused this account. Disconnect it in Connections and connect it again.";
  }
  if (reason === "invalid_grant") return "YouTube login expired. Connect the account again.";
  if (reason === "redirect_uri_mismatch") return "Add this site's /youtube/callback address on the YouTube OAuth client, then try again.";
  if (typeof message === "string" && message.length > 0 && message.length < 300 && !/secret|bearer|client_secret/i.test(message)) return message;
  return "YouTube refused the request.";
}

export function failureText(status) {
  const rejected = {
    copyright: "YouTube rejected it for copyright.",
    duplicate: "YouTube already has this video.",
    inappropriate: "YouTube rejected it.",
    length: "The video is too long for YouTube.",
    termsOfUse: "YouTube rejected it under its terms.",
    claim: "YouTube rejected it because of a claim.",
    trademark: "YouTube rejected it for a trademark.",
    uploaderAccountClosed: "This YouTube channel is closed.",
    uploaderAccountSuspended: "This YouTube channel is suspended.",
  };
  const failed = {
    codec: "YouTube couldn't read this video's format.",
    conversion: "YouTube couldn't process this video.",
    emptyFile: "The video file was empty.",
    invalidFile: "YouTube couldn't read this video.",
    tooSmall: "The video is too small for YouTube.",
    uploadAborted: "The upload was interrupted. Try again.",
  };
  return rejected[status.rejectionReason] || failed[status.failureReason] || "YouTube didn't accept the video. Delete it on YouTube to send it again.";
}

export async function tokenRequest(env, fields) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...fields }),
  });
  const payload = await response.json().catch(() => null);
  // invalid_grant means the person took plan.video's access away, or the login lapsed for good.
  if (!response.ok || !payload?.access_token) return { error: explain(payload), revoked: payload?.error === "invalid_grant" };
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    expiresIn: payload.expires_in || 0,
    scope: payload.scope || "",
  };
}

export async function channelFor(accessToken) {
  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason || "";
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
    // This login can upload without being allowed to read the channel.
    if (reason === "insufficientPermissions" || reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || /insufficient/i.test(message)) {
      return { channelId: "", handle: "YouTube", avatarUrl: "" };
    }
    if (reason === "youtubeSignupRequired") return { error: "This Google account has no YouTube channel. Create one, then connect again." };
    return { error: explain(payload) };
  }
  const item = payload?.items?.[0];
  if (!item?.id) return { error: "This Google account has no YouTube channel. Create one, then connect again." };
  const custom = typeof item.snippet?.customUrl === "string" ? item.snippet.customUrl.replace(/^@+/, "") : "";
  const title = typeof item.snippet?.title === "string" ? item.snippet.title.trim() : "";
  const thumbnails = item.snippet?.thumbnails ?? {};
  const avatar = thumbnails.default?.url || thumbnails.medium?.url || "";
  return { channelId: item.id, handle: custom || title || item.id, avatarUrl: typeof avatar === "string" ? avatar : "" };
}

async function googleGet(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => null);
  return response.ok ? { payload } : { error: explain(payload) };
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export async function analyticsFor(accessToken, startDate, endDate, videoId) {
  const report = (fields) => {
    const url = new URL(REPORTS_URL);
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    url.searchParams.set("metrics", "views,likes,comments");
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
    return googleGet(url, accessToken);
  };
  const [byDay, byVideo] = await Promise.all([
    report({ dimensions: "day", sort: "day", ...(videoId ? { filters: `video==${videoId}` } : {}) }),
    videoId ? { payload: { rows: [] } } : report({ dimensions: "video", sort: "-views", maxResults: "200" }),
  ]);
  if (byDay.error) return { error: byDay.error };
  if (byVideo.error) return { error: byVideo.error };

  const days = (byDay.payload?.rows ?? [])
    .filter((row) => Array.isArray(row) && typeof row[0] === "string")
    .map(([date, views, likes, comments]) => ({ date, views: count(views), likes: count(likes), comments: count(comments) }));

  // The report only names videos that drew views, a day or two late, so the newest uploads are
  // added too, with the live totals YouTube shows on each video.
  const stats = new Map(
    (byVideo.payload?.rows ?? [])
      .filter((row) => Array.isArray(row) && typeof row[0] === "string")
      .map(([id, views, likes, comments]) => [id, { views: count(views), likes: count(likes), comments: count(comments) }]),
  );
  const ids = videoId ? [] : [...new Set([...(await recentUploads(accessToken)), ...stats.keys()])];
  const details = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,statistics");
    url.searchParams.set("id", ids.slice(start, start + 50).join(","));
    url.searchParams.set("maxResults", "50");
    const page = await googleGet(url, accessToken);
    if (page.error) return { error: page.error };
    for (const item of page.payload?.items ?? []) details.set(item.id, { snippet: item.snippet ?? {}, live: item.statistics ?? {} });
  }
  const videos = ids.flatMap((id) => {
    const { snippet, live } = details.get(id) ?? {};
    const postedAt = Date.parse(snippet?.publishedAt ?? "");
    if (!snippet || !Number.isFinite(postedAt)) return [];
    const title = typeof snippet.title === "string" && snippet.title.trim() ? snippet.title.trim() : "Untitled video";
    const thumbnail = snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url;
    const cover = typeof thumbnail === "string" && thumbnail.startsWith("https://i.ytimg.com/") ? thumbnail : "";
    // The live count is current where the report runs days behind. Likes and comments are left
    // out when the channel hides or turns them off.
    const reported = stats.get(id) ?? { views: 0, likes: 0, comments: 0 };
    const now = (key, field) => (live?.[field] !== undefined ? Math.max(count(Number(live[field])), reported[key]) : reported[key]);
    return [{ id, title, postedAt, cover, views: now("views", "viewCount"), likes: now("likes", "likeCount"), comments: now("comments", "commentCount") }];
  });
  return { days, videos };
}

/** Empty when YouTube won't say, so the numbers still load. */
async function recentUploads(accessToken) {
  const channel = await googleGet("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", accessToken);
  const playlistId = channel.payload?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (typeof playlistId !== "string") return [];
  const ids = [];
  let pageToken = "";
  for (let page = 0; page < 2; page++) {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.searchParams.set("part", "contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await googleGet(url, accessToken);
    if (result.error) break;
    for (const item of result.payload?.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (typeof id === "string") ids.push(id);
    }
    pageToken = result.payload?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return ids;
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

export function analyticsProblem(startDate, endDate, videoId) {
  const length = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
  if (!isDay(startDate) || !isDay(endDate) || length < 0 || length > ANALYTICS_DAYS) return "Pick a range of days for YouTube's numbers.";
  if (videoId && !/^[\w-]{6,64}$/.test(videoId)) return "That video id isn't one YouTube would return.";
  return null;
}

function withShorts(title, description, short) {
  if (!short || /#shorts\b/i.test(`${title}\n${description}`)) return description;
  const next = description ? `${description}\n\n#Shorts` : "#Shorts";
  return [...next].length > 5000 ? description : next;
}

export async function startUpload(accessToken, meta) {
  const snippet = {
    title: meta.title,
    description: withShorts(meta.title, meta.description, meta.short),
    categoryId: "22",
  };
  if (meta.tags.length) snippet.tags = meta.tags;
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(meta.videoSize),
      "X-Upload-Content-Type": meta.contentType,
    },
    body: JSON.stringify({
      snippet,
      status: { privacyStatus: meta.privacy, selfDeclaredMadeForKids: meta.madeForKids },
    }),
  });
  if (!response.ok) return { error: explain(await response.json().catch(() => null)) };
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl || !allowedUpload(uploadUrl)) return { error: "YouTube didn't start the upload." };
  return { uploadUrl };
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

function text(body, key) {
  return typeof body[key] === "string" ? body[key] : "";
}

export async function handleYouTube(req, res, path, env) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST." });
    return;
  }
  if (!env.clientId || !env.clientSecret) {
    json(res, 503, { error: "YouTube isn't set up on the server yet." });
    return;
  }

  const user = await userFor(req, env);
  limit(`youtube:${user.id}`, 60, 600);

  const body = JSON.parse((await readBody(req, JSON_MAX)).toString("utf8") || "{}");

  if (path === "/api/youtube/authorize") {
    const redirectUri = text(body, "redirectUri");
    const state = text(body, "state");
    const codeChallenge = text(body, "codeChallenge");
    if (!redirectsFor(env.publicUrl).has(redirectUri) || !state || !codeChallenge) {
      json(res, 400, { error: "That YouTube redirect address isn't allowed." });
      return;
    }
    json(res, 200, { url: authorizeUrl(env, { redirectUri, state, codeChallenge }) });
    return;
  }

  if (path === "/api/youtube/revoke") {
    // A refresh token ends the whole grant.
    const token = text(body, "token");
    if (!token || token.length > 4096) {
      json(res, 400, { error: "There's no YouTube login to end." });
      return;
    }
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    // Google answers invalid_token when the access was already gone, which is what was asked for.
    const payload = response.ok ? null : await response.json().catch(() => null);
    if (!response.ok && payload?.error !== "invalid_token") {
      json(res, 502, { error: "Google didn't confirm that plan.video's access ended. Remove it on your Google account page." });
      return;
    }
    json(res, 200, { revoked: true });
    return;
  }

  json(res, 404, { error: "Unknown YouTube route." });
}
