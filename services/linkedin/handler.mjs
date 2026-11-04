// LinkedIn's API doesn't answer browsers, so every call goes through here and the client
// secret stays on the server. Media go to LinkedIn from the publisher, never through here.

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const REVOKE_URL = "https://www.linkedin.com/oauth/v2/revoke";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const REGISTER_URL = "https://api.linkedin.com/v2/assets?action=registerUpload";
const POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";
// A post with several pictures goes through the versioned API: ugcPosts takes one.
const IMAGES_URL = "https://api.linkedin.com/rest/images?action=initializeUpload";
const REST_POSTS_URL = "https://api.linkedin.com/rest/posts";
/** The versioned API's month. LinkedIn keeps each one for a year. */
const API_VERSION = "202609";
const VERSIONED = { "LinkedIn-Version": API_VERSION };
// No email scope: plan.video has no use for it.
const SCOPE = "openid profile w_member_social";
// A company Page's login comes from a second LinkedIn app: LinkedIn keeps the Community Management API on an app of its own, versioned routes only.
// Comments need their own _feed scope: w_organization_social alone gets a 403 from socialActions, whatever its description says.
const PAGE_SCOPE = "rw_organization_admin w_organization_social w_organization_social_feed";
const PAGE_ROLES = new Set(["ADMINISTRATOR", "CONTENT_ADMINISTRATOR"]);
const MAX_PAGES = 25;
const REST = "https://api.linkedin.com/rest";
const TEXT_LIMIT = 3000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const JSON_MAX = 256 * 1024;

/** The redirect URIs must match the ones saved on the app exactly. */
export function redirectsFor(site = "https://plan.video") {
  const own = new URL(site);
  const www = new URL(site);
  if (!www.hostname.startsWith("www.")) www.hostname = `www.${www.hostname}`;
  return new Set([`${own.origin}/linkedin/callback`, `${www.origin}/linkedin/callback`, "http://localhost:5173/linkedin/callback"]);
}

export function authorizeUrl(env, { redirectUri, state, scope = SCOPE }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", scope);
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
  if (entry.count > max) throw new Refused(429, "Too many LinkedIn requests. Wait a few minutes and try again.");
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
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to connect LinkedIn.");

  const cached = SESSIONS.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall(env, "/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to connect LinkedIn.");
  const user = await res.json();
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to connect LinkedIn.");

  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  if (SESSIONS.size > 5000) SESSIONS.clear();
  SESSIONS.set(token, { user: { id: user.id }, until: Date.now() + 60_000 });
  return { id: user.id };
}

/** The member's token is only ever sent to these. */
export function allowedUpload(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.hostname === "api.linkedin.com" || url.hostname === "www.linkedin.com") &&
      (url.pathname.startsWith("/mediaUpload/") || url.pathname.startsWith("/dms-uploads/"))
    );
  } catch {
    return false;
  }
}

export function explain(status, payload) {
  const code = typeof payload?.code === "string" ? payload.code : "";
  const error = typeof payload?.error === "string" ? payload.error : "";
  // A refused request says why here, under a message that only points to it.
  const detail = payload?.errorDetails?.inputErrors?.[0]?.description;
  const message = typeof detail === "string" ? detail : typeof payload?.message === "string" ? payload.message : typeof payload?.error_description === "string" ? payload.error_description : "";
  if (status === 401 || code === "EXPIRED_ACCESS_TOKEN" || code === "REVOKED_ACCESS_TOKEN" || error === "invalid_token") {
    return "LinkedIn login expired. Connect the account again.";
  }
  if (error === "invalid_redirect_uri" || /redirect_uri/i.test(message)) return "Add this site's /linkedin/callback address on the LinkedIn app, then try again.";
  if (error === "invalid_request" && /authorization code/i.test(message)) return "LinkedIn's login code expired. Start again from Connections.";
  if (status === 429) return "LinkedIn is limiting posts from this account for today. Try again tomorrow.";
  if (status === 403) return "LinkedIn didn't let plan.video post for this account. Disconnect it in Connections and connect it again.";
  if (/duplicate/i.test(message)) return "LinkedIn already has this post.";
  if (message && message.length < 300 && !/secret|bearer|client_secret/i.test(message)) return message;
  return "LinkedIn refused the request.";
}

async function linkedin(url, accessToken, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  return response.ok ? { response, payload } : { error: explain(response.status, payload), status: response.status };
}

export async function tokenRequest(env, fields) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...fields }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) return { error: explain(response.status === 401 ? 400 : response.status, payload) };
  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in || 0,
    // Only partner apps get these. Without one, the member connects again when the login runs out.
    refreshToken: payload.refresh_token || "",
    refreshExpiresIn: payload.refresh_token_expires_in || 0,
    scope: payload.scope || "",
  };
}

export async function memberFor(accessToken) {
  const result = await linkedin(USERINFO_URL, accessToken);
  if (result.error) return { error: result.error };
  const person = result.payload ?? {};
  if (typeof person.sub !== "string" || !person.sub) return { error: "LinkedIn didn't say which account this is." };
  const name = typeof person.name === "string" && person.name.trim() ? person.name.trim() : [person.given_name, person.family_name].filter((part) => typeof part === "string" && part).join(" ");
  return { personId: person.sub, name: name || "LinkedIn", avatarUrl: typeof person.picture === "string" && person.picture.startsWith("https://") ? person.picture : "" };
}

export function clip(text, max) {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

function isPersonId(value) {
  return /^[\w-]{1,64}$/.test(value);
}

function isAsset(value) {
  return /^urn:li:digitalmediaAsset:[\w-]{1,128}$/.test(value);
}

function isImage(value) {
  return typeof value === "string" && /^urn:li:image:[\w-]{1,128}$/.test(value);
}

function isVideo(value) {
  return typeof value === "string" && /^urn:li:video:[\w-]{1,128}$/.test(value);
}

/** Who acts: a person's id, or the URN of a company Page. */
export const pageUrn = (organizationId) => `urn:li:organization:${organizationId}`;
const isPage = (who) => /^urn:li:organization:\d+$/.test(who);
const urnOf = (who) => (isPage(who) ? who : `urn:li:person:${who}`);
const versionedFor = (who) => (isPage(who) ? { headers: VERSIONED } : {});

/** The Pages this member may post to. One LinkedIn won't name still counts: not every role may read a Page's details. */
export async function pagesFor(accessToken) {
  const roles = await linkedin(`${REST}/organizationAcls?q=roleAssignee&state=APPROVED&count=100`, accessToken, { headers: VERSIONED });
  if (roles.error) return { error: roles.error };
  const ids = new Set();
  for (const row of roles.payload?.elements ?? []) {
    if (!PAGE_ROLES.has(row?.role) || row?.state !== "APPROVED") continue;
    const id = /^urn:li:organization:(\d{1,40})$/.exec(row.organization ?? row.organizationTarget ?? "")?.[1];
    if (id) ids.add(id);
  }
  const pages = await Promise.all(
    [...ids].slice(0, MAX_PAGES).map(async (organizationId) => {
      const found = await linkedin(`${REST}/organizations/${organizationId}`, accessToken, { headers: VERSIONED }).catch(() => null);
      const name = found?.payload?.localizedName;
      return { organizationId, name: typeof name === "string" && name.trim() ? name.trim() : "LinkedIn Page" };
    }),
  );
  return { pages };
}

export async function register(accessToken, who, kind) {
  const result = await linkedin(REGISTER_URL, accessToken, {
    method: "POST",
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: [`urn:li:digitalmediaRecipe:feedshare-${kind}`],
        owner: urnOf(who),
        serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
      },
    }),
  });
  if (result.error) return { error: result.error };
  const value = result.payload?.value ?? {};
  const uploadUrl = value.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
  if (typeof uploadUrl !== "string" || !allowedUpload(uploadUrl) || !isAsset(value.asset)) return { error: "LinkedIn didn't start the upload." };
  return { uploadUrl, asset: value.asset };
}

export async function assetState(accessToken, asset) {
  const id = asset.slice("urn:li:digitalmediaAsset:".length);
  const result = await linkedin(`https://api.linkedin.com/v2/assets/${encodeURIComponent(id)}`, accessToken);
  if (result.error) return { error: result.error };
  const states = (result.payload?.recipes ?? []).map((recipe) => recipe?.status).filter((state) => typeof state === "string");
  if (states.some((state) => state === "CLIENT_ERROR" || state === "SERVER_ERROR")) return { error: "LinkedIn couldn't process this file." };
  if (states.length && states.every((state) => state === "AVAILABLE")) return { state: "ready" };
  return { state: "processing" };
}

export async function createPost(accessToken, who, text, media) {
  if (isPage(who)) return createVersionedPost(accessToken, who, text, media ? { media: { id: media.asset } } : undefined);
  const content = {
    shareCommentary: { text },
    shareMediaCategory: media ? (media.kind === "video" ? "VIDEO" : "IMAGE") : "NONE",
    ...(media ? { media: [{ status: "READY", media: media.asset }] } : {}),
  };
  const result = await linkedin(POSTS_URL, accessToken, {
    method: "POST",
    body: JSON.stringify({
      author: urnOf(who),
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": content },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  if (result.error) return { error: result.error };
  const id = result.response.headers.get("x-restli-id") || result.payload?.id || "";
  if (!id) return { error: "LinkedIn took the post but didn't say where it is." };
  return { id };
}

export const COMMENT_LIMIT = 1250;

export async function createComment(accessToken, who, target, text) {
  const result = await linkedin(`${isPage(who) ? REST : "https://api.linkedin.com/v2"}/socialActions/${encodeURIComponent(target)}/comments`, accessToken, {
    method: "POST",
    ...versionedFor(who),
    body: JSON.stringify({ actor: urnOf(who), object: target, message: { text } }),
  });
  if (result.error) return { error: result.error };
  const id = result.response.headers.get("x-restli-id") || result.payload?.$URN || result.payload?.id || "";
  return { id: typeof id === "string" ? id : String(id) };
}

export async function registerImage(accessToken, who) {
  const result = await linkedin(IMAGES_URL, accessToken, {
    method: "POST",
    headers: VERSIONED,
    body: JSON.stringify({ initializeUploadRequest: { owner: urnOf(who) } }),
  });
  if (result.error) return { error: result.error };
  const value = result.payload?.value ?? {};
  if (typeof value.uploadUrl !== "string" || !allowedUpload(value.uploadUrl) || !isImage(value.image)) return { error: "LinkedIn didn't start the upload." };
  return { uploadUrl: value.uploadUrl, image: value.image };
}

const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
const escapeLittle = (text) => text.replace(RESERVED, (char) => `\\${char}`);

/** LinkedIn's reserved characters are escaped, or they cut the post short; a #word stays a hashtag. */
export function littleText(text) {
  let out = "";
  let from = 0;
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}]+)/gu)) {
    const at = (match.index ?? 0) + match[1].length;
    out += `${escapeLittle(text.slice(from, at))}#${match[2]}`;
    from = at + 1 + match[2].length;
  }
  return out + escapeLittle(text.slice(from));
}

export function createImagesPost(accessToken, who, text, images) {
  return createVersionedPost(accessToken, who, text, images.length === 1 ? { media: { id: images[0] } } : { multiImage: { images: images.map((id) => ({ id })) } });
}

// LinkedIn's older uploads refuse a Page as the owner, whatever their docs say, so a Page's video comes through here.
export async function registerVideo(accessToken, who, size) {
  const result = await linkedin(`${REST}/videos?action=initializeUpload`, accessToken, {
    method: "POST",
    headers: VERSIONED,
    body: JSON.stringify({ initializeUploadRequest: { owner: urnOf(who), fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false } }),
  });
  if (result.error) return { error: result.error };
  const value = result.payload?.value ?? {};
  const parts = value.uploadInstructions;
  const usable = Array.isArray(parts) && parts.length > 0 && parts.every((part) => allowedUpload(part?.uploadUrl) && Number.isInteger(part.firstByte) && part.lastByte >= part.firstByte);
  if (!usable || !isVideo(value.video)) return { error: "LinkedIn didn't start the upload." };
  return { video: value.video, uploadToken: typeof value.uploadToken === "string" ? value.uploadToken : "", parts };
}

export async function finishVideo(accessToken, { video, uploadToken }, uploadedPartIds) {
  const result = await linkedin(`${REST}/videos?action=finalizeUpload`, accessToken, {
    method: "POST",
    headers: VERSIONED,
    body: JSON.stringify({ finalizeUploadRequest: { video, uploadToken, uploadedPartIds } }),
  });
  return result.error ? { error: result.error } : {};
}

export async function videoState(accessToken, video) {
  const result = await linkedin(`${REST}/videos/${encodeURIComponent(video)}`, accessToken, { headers: VERSIONED });
  if (result.error) return { error: result.error };
  if (result.payload?.status === "PROCESSING_FAILED") return { error: "LinkedIn couldn't process this file." };
  return { state: result.payload?.status === "AVAILABLE" ? "ready" : "processing" };
}

async function createVersionedPost(accessToken, who, text, content) {
  const result = await linkedin(REST_POSTS_URL, accessToken, {
    method: "POST",
    headers: VERSIONED,
    body: JSON.stringify({
      author: urnOf(who),
      commentary: littleText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (result.error) return { error: result.error };
  const id = result.response.headers.get("x-restli-id") || result.payload?.id || "";
  if (!id) return { error: "LinkedIn took the post but didn't say where it is." };
  return { id };
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

export async function handleLinkedIn(req, res, path, env) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST." });
    return;
  }
  if (!env.clientId || !env.clientSecret) {
    json(res, 503, { error: "LinkedIn isn't set up on the server yet." });
    return;
  }

  const user = await userFor(req, env);
  limit(`linkedin:${user.id}`, 120, 600);

  const body = JSON.parse((await readBody(req, JSON_MAX)).toString("utf8") || "{}");

  if (path === "/api/linkedin/authorize") {
    const redirectUri = text(body, "redirectUri");
    const state = text(body, "state");
    if (!redirectsFor(env.publicUrl).has(redirectUri) || !state) {
      json(res, 400, { error: "That LinkedIn redirect address isn't allowed." });
      return;
    }
    if (body.pages === true) {
      if (!env.pages?.clientId) {
        json(res, 503, { error: "LinkedIn Pages aren't set up on the server yet." });
        return;
      }
      json(res, 200, { url: authorizeUrl(env.pages, { redirectUri, state, scope: PAGE_SCOPE }) });
      return;
    }
    json(res, 200, { url: authorizeUrl(env, { redirectUri, state }) });
    return;
  }

  // The code is swapped in the publisher (linkedin-logins.mjs), which keeps the login and gives
  // the browser a ticket: no browser is handed LinkedIn's tokens.
  if (path === "/api/linkedin/exchange" || path === "/api/linkedin/refresh") {
    json(res, 410, { error: "Reload plan.video and connect LinkedIn again." });
    return;
  }

  if (path === "/api/linkedin/revoke") {
    // A token that's already gone is what was asked for.
    const token = text(body, "token");
    if (!token || token.length > 4096) {
      json(res, 400, { error: "There's no LinkedIn login to end." });
      return;
    }
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, token }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response || (!response.ok && response.status !== 400)) {
      json(res, 502, { error: "LinkedIn didn't confirm that plan.video's access ended. Remove it in LinkedIn's settings, under Data privacy." });
      return;
    }
    json(res, 200, { revoked: true });
    return;
  }

  const accessToken = text(body, "accessToken");
  if (!accessToken) {
    json(res, 400, { error: "Sign in with LinkedIn again." });
    return;
  }

  if (path === "/api/linkedin/profile") {
    const member = await memberFor(accessToken);
    json(res, member.error ? 400 : 200, member);
    return;
  }

  if (path === "/api/linkedin/register") {
    const personId = text(body, "personId");
    const kind = text(body, "kind");
    const size = body.size;
    if (!isPersonId(personId)) {
      json(res, 400, { error: "Connect LinkedIn again, so plan.video knows which account posts." });
      return;
    }
    if (kind !== "video" && kind !== "image") {
      json(res, 400, { error: "LinkedIn takes a video or a picture." });
      return;
    }
    const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (!Number.isInteger(size) || size <= 0 || size > max) {
      json(res, 400, { error: kind === "video" ? "That video is too large for LinkedIn. It can be 200 MB." : "That picture is too large for LinkedIn. It can be 10 MB." });
      return;
    }
    const result = await register(accessToken, personId, kind);
    json(res, result.error ? 400 : 200, result);
    return;
  }

  if (path === "/api/linkedin/asset") {
    const asset = text(body, "asset");
    if (!isAsset(asset)) {
      json(res, 400, { error: "That isn't a file LinkedIn would return." });
      return;
    }
    const result = await assetState(accessToken, asset);
    json(res, result.error ? 400 : 200, result);
    return;
  }

  if (path === "/api/linkedin/post") {
    const personId = text(body, "personId");
    const words = clip(text(body, "text").trim(), TEXT_LIMIT);
    const asset = text(body, "asset");
    const kind = text(body, "kind");
    if (!isPersonId(personId)) {
      json(res, 400, { error: "Connect LinkedIn again, so plan.video knows which account posts." });
      return;
    }
    if (asset && (!isAsset(asset) || (kind !== "video" && kind !== "image"))) {
      json(res, 400, { error: "That isn't a file LinkedIn would return." });
      return;
    }
    if (!words && !asset) {
      json(res, 400, { error: "Write something for LinkedIn, or attach a video or picture." });
      return;
    }
    const result = await createPost(accessToken, personId, words, asset ? { asset, kind } : undefined);
    json(res, result.error ? 400 : 200, result);
    return;
  }

  json(res, 404, { error: "Unknown LinkedIn route." });
}
