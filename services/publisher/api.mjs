// What a signed-in browser asks the publisher, all under /api/publisher:
//
//   login/save     keep a login made in Connections, sealed, on the server
//   login/access   a working access token for one of the person's own connected
//                  Bluesky accounts, for an older browser that still calls
//                  Bluesky itself. Never in a shared workspace, and never
//                  YouTube's, X's, TikTok's or LinkedIn's: see youtube-logins.mjs,
//                  x-logins.mjs, tiktok-logins.mjs and linkedin-logins.mjs
//   login/forget   end plan.video's access at the network, and drop the login,
//                  and for a YouTube channel what plan.video kept of its videos
//   logins         which connected accounts have their login on the server
//   youtube/exchange   swap the code Google sent back for a ticket to the channel's login
//   tiktok/exchange    swap the code TikTok sent back for a ticket to the account's login
//   linkedin/exchange  swap the code LinkedIn sent back for a ticket to the member's login
//   youtube/profile    a YouTube channel's name and picture
//   youtube/analytics  a YouTube channel's or video's numbers
//   tiktok/profile     a TikTok account's name and picture
//   tiktok/videos      a TikTok account's newest videos and their numbers
//   tiktok/creator     what TikTok lets the account post now (creator info)
//   linkedin/profile   a LinkedIn member's name and picture
//   x/exchange     swap the code X sent back for a ticket to the account's login, on paid plans
//   instagram/authorize, facebook/authorize, threads/authorize
//                  where to send the person to sign in to one of Meta's networks
//   instagram/exchange, facebook/exchange, threads/exchange
//                  swap the code Meta sent back for a ticket to each account's
//                  login: a Facebook login gives one per Page shared
//   instagram/profile, facebook/profile, threads/profile
//                  the account's name and picture
//   instagram/analytics, facebook/analytics, threads/analytics
//                  the account's recent posts with their numbers, and its followers
//   send           "Post now": queue the post's networks and send them
//   team/invite    email someone the invite to a workspace they were just asked into
//   connect-link/current, connect-link/create, connect-link/revoke
//                  the workspace's client connect link: the one open, a new one
//                  in its place, or none (connect-links.mjs)
//   account/delete delete the person's account, and everything of theirs
//                  elsewhere first (see account-deletion.mjs)
//
// Refresh tokens never leave the server, and no browser is given a network's
// access token, not even when it connects the account: connecting gives a
// ticket only this service opens, once, within 15 minutes, for the person and
// workspace it was made for. (A Bluesky app-password login is the one
// exception, for its owner, through login/access.) The dashboard asks the
// routes above, which call the network here and send back what it said,
// never a token: someone taken out of a workspace has nothing left to post with.
//
// A client connect link's own routes, connect-link/open, connect-link/authorize
// and connect-link/exchange, need no sign-in: the link is the client's way in,
// to one workspace's Connections and nothing else (connect-links.mjs).
//
// A request about a workspace shared with the person names it as `team`:
// `{ owner, workspace }`. Supabase says what their role there is, and they act
// for the owner as far as it allows: a member reaches only that workspace's
// accounts and posts, and only the owner and admins connect or remove accounts.

import { memberFor } from "../linkedin/handler.mjs";
import { creatorFor, profileFor, videosFor } from "../tiktok/handler.mjs";
import { analyticsFor, analyticsProblem, channelFor } from "../youtube/handler.mjs";

import { connectWithin } from "./accounts.mjs";
import { PublishError, Refused } from "./errors.mjs";
import { analyticsFor as metaAnalyticsFor } from "./meta-analytics.mjs";
import { META_NAMES, isMetaNetwork, profileFor as metaProfileFor } from "./meta.mjs";
import { pdsFetch } from "./pds-fetch.mjs";
import { clientIp } from "./support.mjs";
import { xBasic } from "./vault.mjs";
import { clearYouTubeConnection } from "./youtube-check.mjs";

const JSON_MAX = 64 * 1024;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(["tiktok", "youtube", "linkedin", "bluesky", "x", "instagram", "facebook", "threads"]);
/** Networks whose tokens no browser is given: the publisher makes their calls itself. */
const SERVER_ONLY = new Set(["youtube", "x", "tiktok", "linkedin", "instagram", "facebook", "threads"]);
/** Meta's networks' routes: `/api/publisher/<network>/<action>`. */
const META_ROUTE = /^\/api\/publisher\/(instagram|facebook|threads)\/(authorize|exchange|profile|analytics)$/;
/** A client connect link's routes, for someone with the link and no sign-in. */
const LINK_ROUTE = /^\/api\/publisher\/connect-link\/(open|authorize|exchange)$/;
/** The reads a browser asks the publisher to make with an account's login, by route. */
const NETWORK_READS = {
  "/api/publisher/tiktok/profile": { platform: "tiktok", read: profileFor },
  "/api/publisher/tiktok/videos": { platform: "tiktok", read: videosFor },
  "/api/publisher/tiktok/creator": { platform: "tiktok", read: creatorFor },
  "/api/publisher/linkedin/profile": { platform: "linkedin", read: memberFor },
};

export function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function readBody(req, max = JSON_MAX) {
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
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Refused(400, "That request isn't JSON."));
      }
    });
    req.on("error", reject);
  });
}

/** What a browser may hold of a login: never a refresh token, nor a "Sign in with Bluesky" session. */
function forBrowser(platform, session) {
  if (platform === "bluesky") return session.oauth ? { did: session.did, oauth: true } : { did: session.did, pds: session.pds, accessJwt: session.accessJwt };
  return { accessToken: session.accessToken, expiresAt: session.expiresAt, scope: session.scope };
}

/** Ends plan.video's access at the network. True when the network confirmed it, or the access was already gone. */
export async function revoke(platform, session, env, bluesky) {
  // Meta has no way for an app to end its own access to one account: the login is dropped, and the person removes the app in the network's settings.
  if (isMetaNetwork(platform)) return false;
  if (platform === "bluesky" && session.oauth) {
    await bluesky?.revoke(session.owner, session.did);
    return true;
  }
  const form = (url, fields) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  if (platform === "youtube") {
    const response = await form("https://oauth2.googleapis.com/revoke", { token: session.refreshToken || session.accessToken });
    return !!response && (response.ok || response.status === 400);
  }
  if (platform === "linkedin") {
    const response = await form("https://www.linkedin.com/oauth/v2/revoke", { client_id: env.linkedin.clientId, client_secret: env.linkedin.clientSecret, token: session.accessToken });
    return !!response && (response.ok || response.status === 400);
  }
  if (platform === "tiktok") {
    const response = await form("https://open.tiktokapis.com/v2/oauth/revoke/", { client_key: env.tiktok.clientKey, client_secret: env.tiktok.clientSecret, token: session.accessToken });
    return !!response && response.ok;
  }
  if (platform === "x") {
    const response = await fetch("https://api.x.com/2/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: xBasic(env.x) },
      body: new URLSearchParams({ token: session.refreshToken || session.accessToken, token_type_hint: session.refreshToken ? "refresh_token" : "access_token" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    return !!response && (response.ok || response.status === 400);
  }
  if (platform === "bluesky") {
    const response = await pdsFetch(session.pds, "com.atproto.server.deleteSession", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.refreshJwt}` },
    }).catch(() => null);
    return !!response;
  }
  return false;
}

export function createApi({ env, vault, worker, users, kick, bluesky, limits, db, mailer, deletion, youtube, x, tiktok, linkedin, meta, links, now = () => Date.now() }) {
  const windows = new Map();

  function limit(name, max, seconds) {
    const now = Date.now();
    const entry = windows.get(name);
    if (!entry || entry.reset <= now) {
      if (windows.size > 20_000) windows.clear();
      windows.set(name, { count: 1, reset: now + seconds * 1000 });
      return;
    }
    entry.count += 1;
    if (entry.count > max) throw new Refused(429, "Too many requests. Wait a few minutes and try again.");
  }

  /** Whether another of the person's connections still uses this "Sign in with Bluesky" account. */
  async function sameBlueskyAccount(userId, did) {
    for (const login of await vault.list(userId)) {
      if (login.platform !== "bluesky") continue;
      const other = await vault.read(userId, login.connectionId).catch(() => null);
      if (other?.session?.oauth && other.session.did === did) return true;
    }
    return false;
  }

  const connectionOf = (body) => {
    const id = typeof body.connectionId === "string" ? body.connectionId : "";
    if (!ID.test(id)) throw new Refused(400, "That isn't a connected account.");
    return id;
  };

  /**
   * Whose accounts the request is about: the person's own, or, with `team`,
   * the owner of a workspace they're in, with their role there. `workspace`
   * is set only for someone acting for another owner.
   */
  async function scopeOf(req, user, body) {
    if (body.team === undefined || body.team === null) return { actor: user.id, role: "owner" };
    const owner = typeof body.team.owner === "string" ? body.team.owner : "";
    const workspace = typeof body.team.workspace === "string" ? body.team.workspace : "";
    if (!UUID.test(owner) || !ID.test(workspace)) throw new Refused(400, "That isn't a workspace.");
    const access = await users.access(req, owner, workspace);
    if (!access) throw new Refused(403, "You're not in this workspace anymore.");
    if (access.role === "owner") return { actor: user.id, role: "owner" };
    return { actor: owner, role: access.role, workspace };
  }

  /** Who a connect ticket is for: this person, in this workspace (ticketBinding in vault.mjs). */
  const holderOf = (user, scope) => ({ person: user.id, owner: scope.actor, workspace: scope.workspace ?? "" });

  // The connect tickets login/save has taken, by nonce, until they run out, so
  // each attaches its login once. Kept in memory: the publisher is one process
  // and a ticket lasts 15 minutes, so a restart can only let a ticket taken
  // just before it be shown again, by the same person in the same workspace.
  const spent = new Map();

  /** Takes a ticket for one connection. The same save again (a retry, another tab) waits for the first's answer. */
  function spend(ticket, connectionId, save) {
    const before = spent.get(ticket.nonce);
    if (before) {
      if (before.connectionId !== connectionId) throw new Refused(403, "That login was already used. Connect the account again.");
      return before.saving;
    }
    const at = now();
    for (const [nonce, entry] of spent) if (entry.until <= at) spent.delete(nonce);
    const saving = save();
    spent.set(ticket.nonce, { connectionId, until: ticket.until, saving });
    // A save that didn't keep the login leaves the ticket for another try.
    saving.then(
      (most) => most !== null && spent.delete(ticket.nonce),
      () => spent.delete(ticket.nonce),
    );
    return saving;
  }

  function mustManage(scope) {
    if (scope.role !== "owner" && scope.role !== "admin") throw new Refused(403, "Only the workspace's owner and admins can connect or remove accounts.");
  }

  /** The workspaces of the owner's that list each connected account, by its id. */
  async function listedIn(owner) {
    const listed = new Map();
    for (const row of (await db.rpc("publisher_workspace_connections", { owner })) ?? []) {
      listed.set(row.connection_id, [...(listed.get(row.connection_id) ?? []), row.workspace_id]);
    }
    return listed;
  }

  /** Someone acting for an owner reaches only the accounts of their workspace. */
  async function mustBeListed(scope, connectionId) {
    if (!scope.workspace) return;
    if (!(await listedIn(scope.actor)).get(connectionId)?.includes(scope.workspace)) throw new Refused(403, "That account isn't in this workspace.");
  }

  /** And connects or removes none that another of the owner's workspaces has. */
  async function mustNotBeElsewhere(scope, connectionId) {
    if (!scope.workspace) return;
    if (((await listedIn(scope.actor)).get(connectionId) ?? []).some((id) => id !== scope.workspace)) {
      throw new Refused(403, "That account belongs to another workspace.");
    }
  }

  return async function handle(req, res, path) {
    // The client's metadata and public key, which Bluesky servers fetch.
    if (req.method === "GET" && bluesky && path === "/api/publisher/bluesky/client.json") {
      json(res, 200, bluesky.metadata());
      return;
    }
    if (req.method === "GET" && bluesky && path === "/api/publisher/bluesky/jwks.json") {
      json(res, 200, bluesky.jwks());
      return;
    }
    if (req.method !== "POST") throw new Refused(405, "Use POST.");

    // Anyone signed in, let in yet or not, can delete their account.
    if (path === "/api/publisher/account/delete" && deletion) {
      const user = await users.from(req, { waiting: true });
      limit(`delete:${user.id}`, 5, 3600);
      await deletion.remove(user.id, users.token(req));
      users.forget(req);
      json(res, 200, { deleted: true });
      return;
    }

    // A client with a connect link, who isn't signed in: limited by their network and by the link.
    const linkRoute = LINK_ROUTE.exec(path);
    if (linkRoute) {
      if (!links) throw new Refused(503, "Connect links aren't available right now.");
      const [, action] = linkRoute;
      limit(`link-ip:${clientIp(req)}`, action === "open" ? 120 : 40, 600);
      const body = await readBody(req);
      const link = typeof body.link === "string" ? body.link : "";
      limit(`link:${link.slice(0, 16)}`, action === "open" ? 300 : 100, 3600);
      json(res, 200, action === "open" ? await links.open(link) : action === "authorize" ? await links.authorize(link, body) : await links.exchange(link, body));
      return;
    }

    const user = await users.from(req);
    limit(`api:${user.id}`, 600, 600);
    const body = await readBody(req);

    if (path === "/api/publisher/team/invite") {
      const id = typeof body.invite === "string" && UUID.test(body.invite) ? body.invite : "";
      if (!id) throw new Refused(400, "That isn't an invite.");
      limit(`invite:${user.id}`, 30, 3600);
      const invite = await db.selectOne("workspace_members", { id }, "id,owner_id,workspace_id,email,user_id,invited_by");
      if (!invite || invite.user_id) throw new Refused(404, "This invite isn't open anymore.");
      const access = await users.access(req, invite.owner_id, invite.workspace_id);
      if (access?.role !== "owner" && access?.role !== "admin") throw new Refused(403, "Only the workspace's owner and admins can invite people.");
      limit(`invite-to:${invite.email}`, 3, 3600);
      json(res, 200, { emailed: await mailer.invite(invite) });
      return;
    }

    const scope = await scopeOf(req, user, body);

    if (path === "/api/publisher/login/save") {
      const connectionId = connectionOf(body);
      const platform = typeof body.platform === "string" ? body.platform : "";
      if (!PLATFORMS.has(platform)) throw new Refused(400, "plan.video can't keep a login for that network.");
      limit(`save:${user.id}`, 60, 600);
      mustManage(scope);
      await mustNotBeElsewhere(scope, connectionId);
      // Tickets open only for the person who connected the account, in the workspace they connected it in.
      const holder = holderOf(user, scope);
      let session = body.session;
      let ticket = null;
      // A "Sign in with Bluesky" account is attached only with the ticket its sign-in gave this person.
      if (platform === "bluesky" && session?.oauth === true) {
        ticket = bluesky?.openTicket(holder, session.did, session.ticket) ?? null;
        if (!ticket) throw new Refused(403, "Sign in with Bluesky again to connect this account.");
      }
      // A YouTube channel comes with the ticket youtube/exchange gave this person, which holds its login.
      if (platform === "youtube" && typeof session?.ticket === "string") {
        ticket = youtube?.open(holder, session.ticket) ?? null;
        if (!ticket) throw new Refused(403, "Connect YouTube again to keep this channel's login.");
        session = ticket.session;
      }
      // TikTok and LinkedIn accounts come with the ticket their exchange gave this person. A raw login is
      // one a browser got before their tokens stayed on the server, still on its way here.
      if ((platform === "tiktok" || platform === "linkedin") && typeof session?.ticket === "string") {
        ticket = (platform === "tiktok" ? tiktok : linkedin)?.open(holder, session.ticket) ?? null;
        if (!ticket) throw new Refused(403, `Connect ${platform === "tiktok" ? "TikTok" : "LinkedIn"} again to keep this account's login.`);
        session = ticket.session;
      }
      // An X account only ever comes with the ticket x/exchange gave this person: no browser has X's tokens to hand over.
      if (platform === "x") {
        ticket = typeof session?.ticket === "string" ? (x?.open(holder, session.ticket) ?? null) : null;
        if (!ticket) throw new Refused(403, "Connect X again to keep this account's login.");
        session = ticket.session;
      }
      // An Instagram, Facebook Page or Threads account only ever comes with the ticket its exchange gave this person.
      if (isMetaNetwork(platform)) {
        ticket = typeof session?.ticket === "string" ? (meta?.open(holder, platform, session.ticket) ?? null) : null;
        if (!ticket) throw new Refused(403, `Connect ${META_NAMES[platform]} again to keep this account's login.`);
        session = ticket.session;
      }
      // A new account counts against the plan's social accounts; a login for one already connected doesn't.
      const save = () =>
        connectWithin({ vault, limits, userId: scope.actor, connectionId }, () =>
          vault.put(scope.actor, connectionId, platform, session, { replace: body.replace !== false, allowOAuth: true }),
        );
      const most = await (ticket ? spend(ticket, connectionId, save) : save());
      if (most !== null) throw new Refused(403, `Your plan connects ${most} social accounts, and they're all in use. Upgrade, or add accounts in Billing, to connect another.`);
      json(res, 200, { saved: true });
      return;
    }

    if (path === "/api/publisher/connect-link/current" || path === "/api/publisher/connect-link/create" || path === "/api/publisher/connect-link/revoke") {
      if (!links) throw new Refused(503, "Connect links aren't available right now.");
      mustManage(scope);
      // An admin's is the workspace they act in; an owner names which of their own.
      const workspace = scope.workspace ?? (typeof body.workspace === "string" && ID.test(body.workspace) ? body.workspace : "");
      if (!workspace) throw new Refused(400, "That isn't a workspace.");
      if (path.endsWith("/current")) {
        json(res, 200, { link: await links.current(scope.actor, workspace) });
        return;
      }
      limit(`connect-link:${user.id}`, 30, 3600);
      if (path.endsWith("/revoke")) {
        await links.revoke(scope.actor, workspace);
        json(res, 200, { link: null });
        return;
      }
      json(res, 200, { link: await links.create({ owner: scope.actor, workspace, person: user.id, workspaceName: body.workspaceName, fromName: body.fromName }) });
      return;
    }

    if (path === "/api/publisher/login/access") {
      const connectionId = connectionOf(body);
      // Only the owner's own browser: a token handed to an admin or member would keep
      // posting for weeks after they leave the workspace, and nothing could take it back.
      if (scope.workspace || scope.role !== "owner") throw new Refused(403, "This account's login stays on plan.video's server.");
      const login = await vault.fresh(scope.actor, connectionId);
      if (SERVER_ONLY.has(login.platform)) throw new Refused(403, "This account's login stays on plan.video's server.");
      json(res, 200, { platform: login.platform, ...forBrowser(login.platform, login.session) });
      return;
    }

    if (path === "/api/publisher/login/forget") {
      const connectionId = connectionOf(body);
      mustManage(scope);
      await mustNotBeElsewhere(scope, connectionId);
      const found = await vault.read(scope.actor, connectionId).catch(() => null);
      await vault.remove(scope.actor, connectionId);
      // What plan.video kept of a YouTube channel's videos goes with its login. If that fails, the daily check clears it (youtube-check.mjs).
      if (!found || found.platform === "youtube") {
        await clearYouTubeConnection(db, scope.actor, connectionId).catch((error) => console.error("[publisher] clearing a channel's videos failed", error instanceof Error ? error.message : error));
      }
      // One Bluesky sign-in can be connected in several workspaces; it ends with the last of them.
      const shared = found?.session?.oauth && (await sameBlueskyAccount(scope.actor, found.session.did));
      const revoked = !found || shared ? true : await revoke(found.platform, found.session, env, bluesky);
      json(res, 200, { revoked });
      return;
    }

    if (path === "/api/publisher/logins") {
      const logins = await vault.list(scope.actor);
      if (!scope.workspace) {
        json(res, 200, { connections: logins });
        return;
      }
      const listed = await listedIn(scope.actor);
      json(res, 200, { connections: logins.filter((login) => listed.get(login.connectionId)?.includes(scope.workspace)) });
      return;
    }

    if (path === "/api/publisher/youtube/exchange") {
      if (!youtube) throw new Refused(503, "YouTube isn't set up on the server yet.");
      limit(`youtube-connect:${user.id}`, 20, 600);
      mustManage(scope);
      const text = (key) => (typeof body[key] === "string" ? body[key].slice(0, 4000) : "");
      json(res, 200, await youtube.exchange(holderOf(user, scope), { code: text("code"), redirectUri: text("redirectUri"), codeVerifier: text("codeVerifier") }));
      return;
    }

    if (path === "/api/publisher/tiktok/exchange" || path === "/api/publisher/linkedin/exchange") {
      const network = path.includes("/tiktok/") ? "tiktok" : "linkedin";
      const logins = network === "tiktok" ? tiktok : linkedin;
      if (!logins) throw new Refused(503, `${network === "tiktok" ? "TikTok" : "LinkedIn"} isn't set up on the server yet.`);
      limit(`${network}-connect:${user.id}`, 20, 600);
      mustManage(scope);
      const text = (key) => (typeof body[key] === "string" ? body[key].slice(0, 4000) : "");
      json(res, 200, await logins.exchange(holderOf(user, scope), { code: text("code"), redirectUri: text("redirectUri"), codeVerifier: text("codeVerifier") }));
      return;
    }

    if (path === "/api/publisher/x/exchange") {
      if (!x) throw new Refused(503, "X isn't set up on the server yet.");
      limit(`x-connect:${user.id}`, 20, 600);
      mustManage(scope);
      // X bills plan.video for every post, so its accounts connect on paid plans. A shared workspace is on its owner's.
      const plan = await db.selectOne("user_data", { id: scope.actor }, "access_level");
      if (!(typeof plan?.access_level === "number" && plan.access_level > 1)) throw new Refused(403, "Posting to X is on paid plans. Upgrade in Billing to connect X.");
      const text = (key) => (typeof body[key] === "string" ? body[key].slice(0, 4000) : "");
      json(res, 200, await x.exchange(holderOf(user, scope), { code: text("code"), redirectUri: text("redirectUri"), codeVerifier: text("codeVerifier") }));
      return;
    }

    const metaRoute = META_ROUTE.exec(path);
    if (metaRoute) {
      const [, network, action] = metaRoute;
      if (!meta) throw new Refused(503, `${META_NAMES[network]} isn't set up on the server yet.`);
      const text = (key) => (typeof body[key] === "string" ? body[key].slice(0, 4000) : "");
      if (action === "authorize" || action === "exchange") {
        limit(`${network}-connect:${user.id}`, 20, 600);
        mustManage(scope);
        json(res, 200, action === "authorize"
          ? meta.authorize(network, { redirectUri: text("redirectUri"), state: text("state") })
          : await meta.exchange(holderOf(user, scope), network, { code: text("code"), redirectUri: text("redirectUri") }));
        return;
      }
      // Anyone in the workspace may read these; the answer never carries a token.
      const connectionId = connectionOf(body);
      limit(`${network}:${user.id}`, 120, 600);
      await mustBeListed(scope, connectionId);
      const login = await vault.fresh(scope.actor, connectionId);
      if (login.platform !== network) throw new Refused(400, `That isn't a ${META_NAMES[network]} account.`);
      const result = action === "profile" ? await metaProfileFor(network, login.session) : await metaAnalyticsFor(network, login.session);
      json(res, result.error ? 400 : 200, result.error ? { error: result.error } : result);
      return;
    }

    if (path === "/api/publisher/youtube/profile" || path === "/api/publisher/youtube/analytics") {
      const connectionId = connectionOf(body);
      limit(`youtube:${user.id}`, 60, 600);
      await mustBeListed(scope, connectionId);
      const startDate = typeof body.startDate === "string" ? body.startDate : "";
      const endDate = typeof body.endDate === "string" ? body.endDate : "";
      const videoId = typeof body.videoId === "string" ? body.videoId : "";
      const analytics = path.endsWith("/analytics");
      const problem = analytics && analyticsProblem(startDate, endDate, videoId);
      if (problem) throw new Refused(400, problem);
      const login = await vault.fresh(scope.actor, connectionId);
      if (login.platform !== "youtube") throw new Refused(400, "That isn't a YouTube channel.");
      const result = analytics ? await analyticsFor(login.session.accessToken, startDate, endDate, videoId) : await channelFor(login.session.accessToken);
      json(res, result.error ? 400 : 200, result);
      return;
    }

    // TikTok's and LinkedIn's calls the dashboard makes, made here with the account's login.
    // Anyone in the workspace may read them; the answer never carries a token.
    if (Object.hasOwn(NETWORK_READS, path)) {
      const { platform, read } = NETWORK_READS[path];
      const connectionId = connectionOf(body);
      limit(`${platform}:${user.id}`, 120, 600);
      await mustBeListed(scope, connectionId);
      const login = await vault.fresh(scope.actor, connectionId);
      if (login.platform !== platform) throw new Refused(400, platform === "tiktok" ? "That isn't a TikTok account." : "That isn't a LinkedIn account.");
      const result = await read(login.session.accessToken);
      json(res, result.error ? 400 : 200, result.error ? { error: result.error } : result);
      return;
    }

    if (path === "/api/publisher/bluesky/authorize") {
      if (!bluesky) throw new Refused(503, "Sign in with Bluesky isn't available right now. Use an app password.");
      limit(`bluesky:${user.id}`, 20, 600);
      mustManage(scope);
      const handle = typeof body.handle === "string" ? body.handle.trim().replace(/^@+/, "").slice(0, 300) : "";
      json(res, 200, { url: await bluesky.authorize(scope.actor, handle) });
      return;
    }

    if (path === "/api/publisher/bluesky/callback") {
      if (!bluesky) throw new Refused(503, "Sign in with Bluesky isn't available right now. Use an app password.");
      mustManage(scope);
      const query = typeof body.query === "string" ? body.query.slice(0, 4000) : "";
      json(res, 200, await bluesky.callback(holderOf(user, scope), query));
      return;
    }

    if (path === "/api/publisher/send") {
      const postId = typeof body.postId === "string" && ID.test(body.postId) ? body.postId : "";
      if (!postId) throw new Refused(400, "That isn't a post.");
      limit(`send:${user.id}`, 60, 600);
      const rows = await worker.request(scope.actor, postId, scope.workspace);
      kick();
      const FIELDS = ["id", "post_id", "occurrence", "platform", "connection_id", "state", "error", "publish_id", "url", "attempts", "due_at", "updated_at"];
      json(res, 200, { deliveries: rows.map((row) => Object.fromEntries(FIELDS.map((key) => [key, row[key] ?? null]))) });
      return;
    }

    throw new Refused(404, "Unknown publisher route.");
  };
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

/** Signed-in people, from the Supabase token their browser sends. */
export function createUsers({ supabaseUrl, anonKey, requireInvite }) {
  const cache = new Map();
  const call = (path, token, init = {}) =>
    fetch(`${supabaseUrl}${path}`, {
      ...init,
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

  const tokenOf = (req) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to plan.video first.");
    return token;
  };
  const roles = new Map();

  return {
    /** The person signed in. `waiting` lets in someone the invite gate hasn't yet, for deleting their account. */
    async from(req, { waiting = false } = {}) {
      const token = tokenOf(req);
      const cached = cache.get(token);
      if (cached && cached.until > Date.now()) return cached.user;
      const response = await call("/auth/v1/user", token).catch(() => null);
      if (!response?.ok) throw new Refused(401, "Sign in to plan.video first.");
      const user = await response.json().catch(() => null);
      if (typeof user?.id !== "string") throw new Refused(401, "Sign in to plan.video first.");
      if (requireInvite) {
        // Not kept: the next request, past the gate, has to ask again.
        if (waiting) return { id: user.id };
        const access = await call("/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" }).catch(() => null);
        if (!access?.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
      }
      if (cache.size > 5000) cache.clear();
      cache.set(token, { user: { id: user.id }, until: Date.now() + 60_000 });
      return { id: user.id };
    },

    /** The Supabase token the request was signed in with. */
    token: tokenOf,

    /** Forgets the request's sign-in, for an account just deleted. */
    forget(req) {
      const token = tokenOf(req);
      cache.delete(token);
      for (const key of roles.keys()) if (key.startsWith(`${token}\n`)) roles.delete(key);
    },

    /**
     * The person's role in one of an owner's workspaces, with the owner's
     * plan: `{ role, level }`, or null when they're not in it. Kept for a few
     * seconds, so someone taken out of a workspace loses it about as quickly.
     */
    async access(req, owner, workspace) {
      const token = tokenOf(req);
      const key = `${token}\n${owner}\n${workspace}`;
      const cached = roles.get(key);
      if (cached && cached.until > Date.now()) return cached.access;
      const response = await call("/rest/v1/rpc/team_access", token, { method: "POST", body: JSON.stringify({ owner, workspace }) }).catch(() => null);
      if (!response?.ok) throw new Refused(503, "plan.video can't check this workspace right now. Try again in a moment.");
      const found = await response.json().catch(() => null);
      const access = found && typeof found.role === "string" ? { role: found.role, level: Number(found.level) || 1 } : null;
      if (roles.size > 5000) roles.clear();
      roles.set(key, { access, until: Date.now() + 10_000 });
      return access;
    },
  };
}

export { PublishError };
