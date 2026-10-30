// LinkedIn sign-in and posting to a member's own profile, through the "Share
// on LinkedIn" product (w_member_social). LinkedIn's API doesn't answer
// browsers, so every call goes through here, and the client secret stays on
// the server. Videos and pictures go to LinkedIn from the publisher, never
// through here.

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
// Who the member is, and posting as them. No email: plan.video has no use for it.
const SCOPE = "openid profile w_member_social";
/** The longest post LinkedIn takes, in characters. */
const TEXT_LIMIT = 3000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const JSON_MAX = 256 * 1024;

/**
 * The redirect URIs saved on the LinkedIn app, exactly: the site's callback at
 * its own address and its www one (`site` is PUBLIC_URL, plan.video's by
 * default), and the dev server's.
 */
export function redirectsFor(site = "https://plan.video") {
  const own = new URL(site);
  const www = new URL(site);
  if (!www.hostname.startsWith("www.")) www.hostname = `www.${www.hostname}`;
  return new Set([`${own.origin}/linkedin/callback`, `${www.origin}/linkedin/callback`, "http://localhost:5173/linkedin/callback"]);
}

/** LinkedIn's sign-in page for a member, coming back to `redirectUri` (one of redirectsFor()) with `state`. */
export function authorizeUrl(env, { redirectUri, state }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPE);
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

/**
 * Whether a token was granted to an outside app (Claude's connector, say)
 * instead of signed in here. Those carry the OAuth client's `client_id` and
 * are only good at /mcp. One that can't be read isn't a token Supabase made,
 * and Supabase turns it away.
 */
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

/** LinkedIn's own upload addresses. The member's token is only ever sent to these. */
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
  const message = typeof payload?.message === "string" ? payload.message : typeof payload?.error_description === "string" ? payload.error_description : "";
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

/** The member's id, name and picture, from Sign In with LinkedIn. */
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

export async function register(accessToken, personId, kind) {
  const result = await linkedin(REGISTER_URL, accessToken, {
    method: "POST",
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: [`urn:li:digitalmediaRecipe:feedshare-${kind}`],
        owner: `urn:li:person:${personId}`,
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

/** Where LinkedIn is with an uploaded file: still working on it, ready to post, or turned down. */
export async function assetState(accessToken, asset) {
  const id = asset.slice("urn:li:digitalmediaAsset:".length);
  const result = await linkedin(`https://api.linkedin.com/v2/assets/${encodeURIComponent(id)}`, accessToken);
  if (result.error) return { error: result.error };
  const states = (result.payload?.recipes ?? []).map((recipe) => recipe?.status).filter((state) => typeof state === "string");
  if (states.some((state) => state === "CLIENT_ERROR" || state === "SERVER_ERROR")) return { error: "LinkedIn couldn't process this file." };
  if (states.length && states.every((state) => state === "AVAILABLE")) return { state: "ready" };
  return { state: "processing" };
}

export async function createPost(accessToken, personId, text, media) {
  const content = {
    shareCommentary: { text },
    shareMediaCategory: media ? (media.kind === "video" ? "VIDEO" : "IMAGE") : "NONE",
    ...(media ? { media: [{ status: "READY", media: media.asset }] } : {}),
  };
  const result = await linkedin(POSTS_URL, accessToken, {
    method: "POST",
    body: JSON.stringify({
      author: `urn:li:person:${personId}`,
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

/** The longest comment LinkedIn takes, in characters. */
export const COMMENT_LIMIT = 1250;

/** A comment from the member on `target`, a post's urn, as a thread's follow-up. */
export async function createComment(accessToken, personId, target, text) {
  const result = await linkedin(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(target)}/comments`, accessToken, {
    method: "POST",
    body: JSON.stringify({ actor: `urn:li:person:${personId}`, object: target, message: { text } }),
  });
  if (result.error) return { error: result.error };
  const id = result.response.headers.get("x-restli-id") || result.payload?.$URN || result.payload?.id || "";
  return { id: typeof id === "string" ? id : String(id) };
}

/** Starts the upload of one picture for a post with several. The bytes go to `uploadUrl`. */
export async function registerImage(accessToken, personId) {
  const result = await linkedin(IMAGES_URL, accessToken, {
    method: "POST",
    headers: { "LinkedIn-Version": API_VERSION },
    body: JSON.stringify({ initializeUploadRequest: { owner: `urn:li:person:${personId}` } }),
  });
  if (result.error) return { error: result.error };
  const value = result.payload?.value ?? {};
  if (typeof value.uploadUrl !== "string" || !allowedUpload(value.uploadUrl) || !isImage(value.image)) return { error: "LinkedIn didn't start the upload." };
  return { uploadUrl: value.uploadUrl, image: value.image };
}

const RESERVED = /[\\|{}@[\]()<>#*_~]/g;
const escapeLittle = (text) => text.replace(RESERVED, (char) => `\\${char}`);

/**
 * Words as LinkedIn's versioned posts read them: its reserved characters are
 * escaped, so they show as typed instead of cutting the post short, and a
 * #word stays a hashtag.
 */
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

/** Makes a post with 2 to 20 pictures, uploaded with registerImage. */
export async function createImagesPost(accessToken, personId, text, images) {
  const result = await linkedin(REST_POSTS_URL, accessToken, {
    method: "POST",
    headers: { "LinkedIn-Version": API_VERSION },
    body: JSON.stringify({
      author: `urn:li:person:${personId}`,
      commentary: littleText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { multiImage: { images: images.map((id) => ({ id })) } },
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
    json(res, 200, { url: authorizeUrl(env, { redirectUri, state }) });
    return;
  }

  // Swapping the code happens in the publisher (linkedin-logins.mjs), which keeps the login and
  // gives the browser a ticket: no browser is handed LinkedIn's tokens, which last about 60 days.
  if (path === "/api/linkedin/exchange" || path === "/api/linkedin/refresh") {
    json(res, 410, { error: "Reload plan.video and connect LinkedIn again." });
    return;
  }

  if (path === "/api/linkedin/revoke") {
    // Ends plan.video's access at LinkedIn. A token that's already gone is what was asked for.
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
