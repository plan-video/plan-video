// Starting X sign-in, and ending it, with OAuth 2.0 (PKCE, confidential
// client). The client secret stays on the server. X bills plan.video for every
// post, so only paid plans can connect, and X's tokens never reach a browser:
// anyone holding one could post through plan.video's X app around their plan's
// limits. The publisher swaps the code X sends back for the login itself
// (x/exchange in services/publisher), keeps it, and does all the posting.

const AUTH_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
const ME_URL = "https://api.x.com/2/users/me?user.fields=profile_image_url";
// Posting with pictures and video, and staying connected so scheduled posts go out later.
const SCOPE = "tweet.read tweet.write users.read media.write offline.access";
const JSON_MAX = 256 * 1024;

/**
 * The redirect URIs saved on the X app, exactly: the site's callback at
 * its own address and its www one (`site` is PUBLIC_URL, plan.video's by
 * default), and the dev server's.
 */
export function redirectsFor(site = "https://plan.video") {
  const own = new URL(site);
  const www = new URL(site);
  if (!www.hostname.startsWith("www.")) www.hostname = `www.${www.hostname}`;
  return new Set([`${own.origin}/x/callback`, `${www.origin}/x/callback`, "http://127.0.0.1:5173/x/callback"]);
}

/** X's consent page for an account, coming back to `redirectUri` (one of redirectsFor()) with `state`. */
export function authorizeUrl(env, { redirectUri, state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
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

function limit(name, max, seconds, message = "Too many X requests. Wait a few minutes and try again.") {
  const now = Date.now();
  const entry = WINDOWS.get(name);
  if (!entry || entry.reset <= now) {
    WINDOWS.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, message);
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

/** The signed-in person, and whether they're on a paid plan. */
async function userFor(req, env) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to connect X.");

  const cached = SESSIONS.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall(env, "/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to connect X.");
  const user = await res.json();
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to connect X.");

  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  const plan = await supabaseCall(env, `/rest/v1/user_data?select=access_level&id=eq.${encodeURIComponent(user.id)}`, token);
  const rows = plan.ok ? await plan.json().catch(() => []) : [];
  const paid = Array.isArray(rows) && typeof rows[0]?.access_level === "number" && rows[0].access_level > 1;

  if (SESSIONS.size > 5000) SESSIONS.clear();
  SESSIONS.set(token, { user: { id: user.id, paid }, until: Date.now() + 60_000 });
  return { id: user.id, paid };
}

export function explain(status, payload) {
  const error = typeof payload?.error === "string" ? payload.error : "";
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : undefined;
  const message =
    typeof payload?.detail === "string"
      ? payload.detail
      : typeof first?.message === "string"
        ? first.message
        : typeof payload?.error_description === "string"
          ? payload.error_description
          : typeof payload?.title === "string"
            ? payload.title
            : "";
  if (status === 401 || error === "invalid_token") return "X login expired. Connect the account again.";
  if (error === "invalid_request" && /redirect/i.test(message)) return "Add this site's /x/callback address on the X app, then try again.";
  if (error === "invalid_request" && /code|verifier/i.test(message)) return "X's login code expired. Start again from Connections.";
  if (error === "invalid_grant") return "X login expired. Connect the account again.";
  if (status === 402) return "plan.video can't post to X right now. Try again later.";
  if (status === 429) return "X is limiting posts from this account for now. Try again later.";
  if (/duplicate/i.test(message)) return "X already has this post.";
  if (status === 403 && !message) return "X didn't let plan.video post for this account. Disconnect it in Connections and connect it again.";
  if (message && message.length < 300 && !/secret|bearer|client_secret/i.test(message)) return message;
  return "X refused the request.";
}

async function x(url, accessToken, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(init.timeout ?? 20_000),
  });
  const payload = await response.json().catch(() => null);
  return response.ok ? { payload } : { error: explain(response.status, payload), status: response.status };
}

function basic(env) {
  return `Basic ${Buffer.from(`${encodeURIComponent(env.clientId)}:${encodeURIComponent(env.clientSecret)}`).toString("base64")}`;
}

/** Asks X for tokens: the login for a code, or a fresh one. */
export async function tokenRequest(env, fields) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(env) },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) return { error: explain(response.status === 401 ? 400 : response.status, payload) };
  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in || 0,
    // X hands out a new refresh token each time, and the old one stops working.
    refreshToken: payload.refresh_token || "",
    scope: payload.scope || "",
  };
}

/** The member's id, @handle and picture. */
export async function memberFor(accessToken) {
  const result = await x(ME_URL, accessToken);
  if (result.error) return { error: result.error };
  const person = result.payload?.data ?? {};
  if (typeof person.id !== "string" || !person.id) return { error: "X didn't say which account this is." };
  const picture = typeof person.profile_image_url === "string" && person.profile_image_url.startsWith("https://") ? person.profile_image_url : "";
  return {
    userId: person.id,
    username: typeof person.username === "string" ? person.username : "",
    // X's own link is a small picture; this is the larger one at the same address.
    avatarUrl: picture.replace(/_normal(\.\w+)$/, "_400x400$1"),
  };
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

const PAID_ONLY = "Posting to X is on paid plans. Upgrade in Billing to connect X.";

export async function handleX(req, res, path, env) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST." });
    return;
  }
  if (!env.clientId || !env.clientSecret) {
    json(res, 503, { error: "X isn't set up on the server yet." });
    return;
  }

  const user = await userFor(req, env);
  limit(`x:${user.id}`, 600, 600);
  // Ending plan.video's access works on any plan, so someone who stopped paying can still disconnect.
  if (!user.paid && path !== "/api/x/revoke") {
    json(res, 403, { error: PAID_ONLY });
    return;
  }

  const body = JSON.parse((await readBody(req, JSON_MAX)).toString("utf8") || "{}");

  if (path === "/api/x/authorize") {
    const redirectUri = text(body, "redirectUri");
    const state = text(body, "state");
    const challenge = text(body, "codeChallenge");
    if (!redirectsFor(env.publicUrl).has(redirectUri) || !state || !/^[\w-]{43,128}$/.test(challenge)) {
      json(res, 400, { error: "That X redirect address isn't allowed." });
      return;
    }
    json(res, 200, { url: authorizeUrl(env, { redirectUri, state, codeChallenge: challenge }) });
    return;
  }

  if (path === "/api/x/revoke") {
    // Ends plan.video's access at X. A token that's already gone is what was asked for.
    const token = text(body, "token");
    if (!token || token.length > 4096) {
      json(res, 400, { error: "There's no X login to end." });
      return;
    }
    const response = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(env) },
      body: new URLSearchParams({ token, token_type_hint: text(body, "hint") === "refresh_token" ? "refresh_token" : "access_token" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response || (!response.ok && response.status !== 400)) {
      json(res, 502, { error: "X didn't confirm that plan.video's access ended. Remove it in X's settings, under Connected apps." });
      return;
    }
    json(res, 200, { revoked: true });
    return;
  }

  json(res, 404, { error: "Unknown X route." });
}
