// Client connect links. A workspace's owner or an admin makes a link and
// sends it to a client, who opens plan.video/connect/<link> without a
// plan.video account and signs in to their own social accounts there. Each
// account they connect lands in that workspace, as if the owner had connected
// it: its login sealed under the owner (vault.mjs), counted against the
// owner's plan (accounts.mjs), and its row added to the workspace's
// connections in the owner's account_state (connect_link_keep), which the
// owner's open tabs merge in like any change made elsewhere.
//
// The client's browser starts each network's sign-in through here and hands
// back what the network returned; the publisher swaps it for the login itself,
// so no token reaches the client's browser either, and the ticket each
// exchange makes is opened here at once.
//
// A link is its row's id with a MAC under a key drawn from TOKEN_KEY, so the
// table holds nothing that opens it and the owner can copy it again. It lasts
// LINK_DAYS, connects any number of accounts until then, and its maker turns
// it off. Making a new one turns off the workspace's old one.

import { createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { redirectsFor as linkedinRedirects, authorizeUrl as linkedinAuthorize } from "../linkedin/handler.mjs";
import { redirectsFor as tiktokRedirects, authorizeUrl as tiktokAuthorize } from "../tiktok/handler.mjs";
import { redirectsFor as xRedirects, authorizeUrl as xAuthorize } from "../x/handler.mjs";
import { redirectsFor as youtubeRedirects, authorizeUrl as youtubeAuthorize } from "../youtube/handler.mjs";

import { connectWithin } from "./accounts.mjs";
import { PublishError, Refused } from "./errors.mjs";
import { META_NAMES, configured, isMetaNetwork } from "./meta.mjs";

/** How long a link connects accounts. */
export const LINK_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

/** A link: 16 characters of id, then 22 of MAC. */
const LINK = /^[A-Za-z0-9_-]{38}$/;
const STATE = /^[\w-]{8,200}$/;
const CHALLENGE = /^[\w-]{43,128}$/;
const NAME_MAX = 80;

/** Networks a client can connect through a link, in the order the page shows them. Pinterest has no sign-in yet. */
export const LINK_NETWORKS = ["x", "instagram", "tiktok", "youtube", "linkedin", "facebook", "threads", "bluesky"];

const NAMES = { x: "X", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", bluesky: "Bluesky", ...META_NAMES };

/** The field each network's login names its account by, in the connection the dashboard keeps. */
const IDENTITY = { tiktok: "openId", youtube: "channelId", linkedin: "personId", x: "xUserId", instagram: "accountId", facebook: "accountId", threads: "accountId", bluesky: "did" };

const GONE = "This link has run out or was turned off. Ask the person who sent it for a new one.";

/** A name as the client is shown it: one line, trimmed, at most NAME_MAX characters. */
const shortName = (value) =>
  typeof value === "string" ? [...value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim()].slice(0, NAME_MAX).join("") : "";

const cleanHandle = (value) => (typeof value === "string" ? value.trim().replace(/^@+/, "") : "");

/** A Bluesky account's handle and picture, from Bluesky's public directory. The DID when it can't be read. */
async function blueskyProfile(did) {
  try {
    const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`, { signal: AbortSignal.timeout(5000) });
    const profile = response.ok ? await response.json() : null;
    return { handle: typeof profile?.handle === "string" ? profile.handle : did, avatarUrl: typeof profile?.avatar === "string" ? profile.avatar : "" };
  } catch {
    return { handle: did, avatarUrl: "" };
  }
}

/**
 * `vault`, `limits`, the networks' login makers (`youtube`, `tiktok`,
 * `linkedin`, `x`, `meta`, `bluesky`) and `env` are the ones api.mjs has.
 */
export function createConnectLinks({ db, key, vault, limits, env, youtube, tiktok, linkedin, x, meta, bluesky, profile = blueskyProfile, now = () => Date.now() }) {
  const mac = hkdfSync("sha256", Buffer.from(key || "", "base64"), Buffer.alloc(0), "plan.video connect link", 32);
  const sign = (id) => createHmac("sha256", Buffer.from(mac)).update(id).digest().subarray(0, 16).toString("base64url");
  const linkFor = (id) => `${id}${sign(id)}`;

  /** The link's id, when its MAC is right. */
  function idOf(link) {
    if (typeof link !== "string" || !LINK.test(link)) return null;
    const id = link.slice(0, 16);
    const wanted = Buffer.from(sign(id));
    const given = Buffer.from(link.slice(16));
    return wanted.length === given.length && timingSafeEqual(wanted, given) ? id : null;
  }

  const live = (row) => !!row && !row.revoked_at && Date.parse(row.expires_at) > now();

  /** The open link a client's browser names, or a refusal. */
  async function opened(link) {
    const id = idOf(link);
    const row = id ? await db.selectOne("connect_links", { id }) : null;
    if (!live(row)) throw new Refused(404, GONE);
    return row;
  }

  /** The owner's plan level, 1 (Free) when it can't be read. */
  async function levelOf(owner) {
    const row = await db.selectOne("user_data", { id: owner }, "access_level").catch(() => null);
    return typeof row?.access_level === "number" ? row.access_level : 1;
  }

  /** The networks the server can sign in to now, for this owner: X only on paid plans, as in Connections. */
  async function networksFor(owner) {
    const ready = {
      x: !!(x && env.x?.clientId) && (await levelOf(owner)) > 1,
      instagram: !!meta && configured("instagram", env),
      tiktok: !!(tiktok && env.tiktok?.clientKey),
      youtube: !!(youtube && env.youtube?.clientId),
      linkedin: !!(linkedin && env.linkedin?.clientId),
      facebook: !!meta && configured("facebook", env),
      threads: !!meta && configured("threads", env),
      bluesky: !!bluesky,
    };
    return LINK_NETWORKS.filter((network) => ready[network]);
  }

  async function mustOffer(row, network) {
    if (!LINK_NETWORKS.includes(network)) throw new Refused(400, "plan.video can't connect that network.");
    if (!(await networksFor(row.owner_id)).includes(network)) throw new Refused(403, `${NAMES[network]} can't be connected through this link.`);
  }

  /** The workspace's connections as the owner's account keeps them, and whether the workspace is there. */
  async function workspaceOf(owner, workspace) {
    const row = await db.selectOne("account_state", { user_id: owner }, "payload");
    const listed = Array.isArray(row?.payload?.workspaces?.list) && row.payload.workspaces.list.some((item) => item?.id === workspace);
    const slice = row?.payload?.slices?.[workspace];
    return { listed: listed && !!slice && typeof slice === "object", connections: Array.isArray(slice?.connections) ? slice.connections : [] };
  }

  /**
   * Keeps one account the client signed in to: its login in the vault, under
   * the owner, and its row in the link's workspace. The same account
   * connected there before keeps its row and takes the new login.
   */
  async function keep(row, platform, account) {
    const owner = row.owner_id;
    const identity = account.details[IDENTITY[platform]];
    const handle = cleanHandle(account.handle) || NAMES[platform];
    const { listed, connections } = await workspaceOf(owner, row.workspace_id);
    if (!listed) throw new Refused(410, GONE);
    const existing = connections.find(
      (item) =>
        item?.platform === platform &&
        typeof item.id === "string" &&
        (item[platform]?.[IDENTITY[platform]] === identity || (!item[platform] && typeof item.handle === "string" && item.handle.toLowerCase() === handle.toLowerCase())),
    );
    const connectionId = existing?.id ?? randomUUID();
    const most = await connectWithin({ vault, limits, userId: owner, connectionId, strict: true }, () =>
      vault.put(owner, connectionId, platform, account.session, { replace: true, allowOAuth: true }),
    );
    if (most !== null) {
      throw new Refused(403, `${row.workspace_name || "This workspace"} has no room for another account right now. Let ${row.from_name || "them"} know, so they can make room.`);
    }
    const connection = {
      id: connectionId,
      platform,
      handle,
      connectedAt: new Date(now()).toISOString(),
      avatarUrl: account.avatarUrl || "",
      [platform]: account.details,
    };
    const kept = await db.rpc("connect_link_keep", { link: row.id, connection });
    if (kept !== true) {
      // Turned off, or the workspace deleted, while the client signed in: the login goes too.
      if (!existing) await vault.remove(owner, connectionId).catch(() => undefined);
      throw new Refused(410, GONE);
    }
    return { platform, handle, avatarUrl: connection.avatarUrl };
  }

  /** Swaps what the network sent back for its accounts' logins, opened here: `{ handle, avatarUrl, session, details }` each. */
  async function signIn(network, holder, body) {
    const text = (name) => (typeof body[name] === "string" ? body[name].slice(0, 4000) : "");
    const code = { code: text("code"), redirectUri: text("redirectUri"), codeVerifier: text("codeVerifier") };
    const unseal = (ticket, open) => {
      const found = open(ticket);
      if (!found) throw new Refused(400, `${NAMES[network]} didn't finish connecting. Try again.`);
      return found.session;
    };
    if (network === "youtube") {
      const found = await youtube.exchange(holder, code);
      const session = unseal(found.ticket, (ticket) => youtube.open(holder, ticket));
      return [{ handle: found.handle, avatarUrl: found.avatarUrl, session, details: { channelId: found.channelId, expiresAt: found.expiresAt, scope: found.scope } }];
    }
    if (network === "tiktok") {
      const found = await tiktok.exchange(holder, code);
      const session = unseal(found.ticket, (ticket) => tiktok.open(holder, ticket));
      return [{ handle: found.displayName, avatarUrl: found.avatarUrl, session, details: { openId: found.openId, expiresAt: found.expiresAt, scope: found.scope } }];
    }
    if (network === "linkedin") {
      const found = await linkedin.exchange(holder, code);
      const session = unseal(found.ticket, (ticket) => linkedin.open(holder, ticket));
      return [{
        handle: found.displayName,
        avatarUrl: found.avatarUrl,
        session,
        details: { personId: found.personId, ...(found.renewable ? { renewable: true } : {}), expiresAt: found.expiresAt, scope: found.scope },
      }];
    }
    if (network === "x") {
      const found = await x.exchange(holder, code);
      const session = unseal(found.ticket, (ticket) => x.open(holder, ticket));
      return [{ handle: found.username, avatarUrl: found.avatarUrl, session, details: { xUserId: found.xUserId, expiresAt: found.expiresAt, scope: found.scope } }];
    }
    if (isMetaNetwork(network)) {
      const found = await meta.exchange(holder, network, code);
      return (found.accounts ?? []).map((account) => ({
        handle: account.handle,
        avatarUrl: account.avatarUrl,
        session: unseal(account.ticket, (ticket) => meta.open(holder, network, ticket)),
        details: { accountId: account.accountId, expiresAt: account.expiresAt, scope: account.scope },
      }));
    }
    // Sign in with Bluesky: the session stays the owner's own, in bluesky_sessions; the login names the account.
    const query = typeof body.query === "string" ? body.query.slice(0, 4000) : "";
    const { did, ticket } = await bluesky.callback(holder, query);
    if (!bluesky.openTicket(holder, did, ticket)) throw new Refused(400, "Bluesky didn't finish connecting. Try again.");
    const found = await profile(did);
    return [{ handle: found.handle, avatarUrl: found.avatarUrl, session: { did, oauth: true }, details: { did, pds: "", oauth: true, server: true } }];
  }

  /** The workspace's live link, if it has one, as its maker sees it. */
  const shown = (row) => ({ link: linkFor(row.id), expiresAt: row.expires_at, connected: row.connected ?? 0 });

  async function liveFor(owner, workspace) {
    return (await db.select("connect_links", { owner_id: owner, workspace_id: workspace })).filter(live).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /** Turns off the workspace's links, and forgets ones long past. */
  async function revoke(owner, workspace) {
    const at = now();
    for (const row of await db.select("connect_links", { owner_id: owner, workspace_id: workspace })) {
      if (live(row)) await db.update("connect_links", { id: row.id }, { revoked_at: new Date(at).toISOString() });
      else if (Date.parse(row.revoked_at || row.expires_at) < at - 30 * DAY_MS) await db.delete("connect_links", { id: row.id });
    }
  }

  return {
    // --- For the person who sends the link: the owner or an admin, signed in.

    /** The workspace's live link, or null. */
    async current(owner, workspace) {
      const [row] = await liveFor(owner, workspace);
      return row ? shown(row) : null;
    },

    /** A new link for the workspace, turning off the one before. `names` are what the client is shown. */
    async create({ owner, workspace, person, workspaceName, fromName }) {
      if (!(await workspaceOf(owner, workspace)).listed) throw new Refused(404, "That workspace isn't on plan.video yet. Wait a moment and try again.");
      await revoke(owner, workspace);
      const at = now();
      const row = {
        id: randomBytes(12).toString("base64url"),
        owner_id: owner,
        workspace_id: workspace,
        workspace_name: shortName(workspaceName),
        from_name: shortName(fromName),
        created_by: person,
        created_at: new Date(at).toISOString(),
        expires_at: new Date(at + LINK_DAYS * DAY_MS).toISOString(),
        revoked_at: null,
        connected: 0,
      };
      await db.insert("connect_links", [row]);
      return shown(row);
    },

    revoke,

    // --- For the client, with the link alone.

    /** What the client's page shows: whose workspace, who sent it, until when, and which networks. */
    async open(link) {
      const row = await opened(link);
      return { workspace: row.workspace_name, from: row.from_name, expiresAt: row.expires_at, networks: await networksFor(row.owner_id) };
    },

    /** Where to send the client to sign in to a network. */
    async authorize(link, body) {
      const row = await opened(link);
      const network = typeof body.network === "string" ? body.network : "";
      await mustOffer(row, network);
      const text = (name) => (typeof body[name] === "string" ? body[name].slice(0, 4000) : "");
      const redirectUri = text("redirectUri");
      const state = text("state");
      if (network === "bluesky") {
        const handle = text("handle").trim().replace(/^@+/, "").slice(0, 300);
        return { url: await bluesky.authorize(row.owner_id, handle) };
      }
      if (isMetaNetwork(network)) return meta.authorize(network, { redirectUri, state });
      if (!STATE.test(state)) throw new Refused(400, "That login state isn't valid.");
      const codeChallenge = text("codeChallenge");
      const allowed = { youtube: youtubeRedirects, tiktok: tiktokRedirects, linkedin: linkedinRedirects, x: xRedirects }[network](env[network]?.publicUrl);
      if (!allowed.has(redirectUri)) throw new Refused(400, `That ${NAMES[network]} redirect address isn't allowed.`);
      if (network !== "linkedin" && !CHALLENGE.test(codeChallenge)) throw new Refused(400, `${NAMES[network]}'s sign-in needs a code challenge.`);
      const build = { youtube: youtubeAuthorize, tiktok: tiktokAuthorize, linkedin: linkedinAuthorize, x: xAuthorize }[network];
      return { url: build(env[network], { redirectUri, state, codeChallenge }) };
    },

    /**
     * Finishes a network's sign-in the client came back from, and keeps each
     * account it gave. Returns the ones kept, by name and picture; a Facebook
     * login gives each Page shared, and one that can't be kept doesn't stop the rest.
     */
    async exchange(link, body) {
      const row = await opened(link);
      const network = typeof body.network === "string" ? body.network : "";
      await mustOffer(row, network);
      // Who the exchange's tickets are for: the link's maker, in its workspace. They're opened here, at once.
      const holder = { person: row.created_by, owner: row.owner_id, workspace: row.workspace_id };
      const accounts = await signIn(network, holder, body);
      if (!accounts.length) throw new Refused(400, `${NAMES[network]} didn't return an account.`);
      const kept = [];
      let problem = null;
      for (const account of accounts) {
        try {
          kept.push(await keep(row, network, account));
        } catch (error) {
          if (!(error instanceof Refused) && !(error instanceof PublishError)) throw error;
          problem ??= error;
          if (error instanceof Refused && error.status === 410) break;
        }
      }
      if (!kept.length) throw problem;
      return { accounts: kept, ...(problem ? { problem: problem.message } : {}) };
    },
  };
}
