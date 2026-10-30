/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { PLATFORMS } from "@/components/calendar/utils";
import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { accountsLimit } from "@/lib/plans";
import { hasSecrets, saveLogin, withoutSecrets } from "@/lib/publishing";
import { activeScope, activeWorkspaceId, storageKeyFor, workspaceKey, workspaces, type TeamScope } from "@/lib/workspaces";

/**
 * A TikTok login. Its tokens go to the publisher's server as soon as it's made
 * (see lib/publishing), so what's kept here and on the account is who it is.
 */
export type TikTokSession = {
  openId: string;
  /** Attaches the login the server got while connecting, once. */
  ticket?: string;
  /** Only in logins made before TikTok's tokens stayed on the server. */
  accessToken?: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
};

/**
 * A YouTube login. Its tokens are kept on the server and never come to the
 * browser: connecting gives a `ticket`, the login sealed for the server, which
 * goes there like any other login.
 */
export type YouTubeSession = {
  channelId: string;
  ticket?: string;
  /** Only in logins made before YouTube's tokens stayed on the server. */
  accessToken?: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  /** When the channel's name and picture were last read from YouTube, in ms. */
  checkedAt?: number;
};

/** A LinkedIn login, its tokens kept on the server. `expiresAt` is when LinkedIn wants the member to sign in again. */
export type LinkedInSession = {
  personId: string;
  /** Attaches the login the server got while connecting, once. */
  ticket?: string;
  /** LinkedIn gave a refresh token, so the server renews the login without the member. */
  renewable?: boolean;
  /** Only in logins made before LinkedIn's tokens stayed on the server. */
  accessToken?: string;
  /** Only partner apps get one, so this is usually empty. */
  refreshToken?: string;
  expiresAt: number;
  scope: string;
};

/**
 * An X login. Its tokens are kept on the server and never come to the
 * browser: connecting gives a `ticket`, the login sealed for the server, which
 * goes there like any other login.
 */
export type XSession = {
  xUserId: string;
  ticket?: string;
  /** Only in logins made before X's tokens stayed on the server. */
  accessToken?: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
};

/**
 * A login to one of Meta's networks: an Instagram professional account, a
 * Facebook Page or a Threads profile, by `accountId`, the network's id for it.
 * Its tokens are kept on the server and never come to the browser.
 * `expiresAt` is when the login runs out unless the server renews it, or 0
 * for a Page's, which doesn't.
 */
export type MetaSession = {
  accountId: string;
  ticket?: string;
  expiresAt: number;
  scope: string;
};

/**
 * A Bluesky login. With `oauth`, the person used "Sign in with Bluesky": with `server`, the
 * server keeps that login; without, it's an older one kept in the browser that made it, which
 * the server can't post with. Otherwise an app password gave tokens, kept on the server, and
 * `pds` is the server the account lives on. The app password itself isn't kept.
 */
export type BlueskySession = {
  did: string;
  pds: string;
  oauth?: boolean;
  server?: boolean;
  /** Attaches a server-held "Sign in with Bluesky" login to this connection, once. */
  ticket?: string;
  accessJwt?: string;
  refreshJwt?: string;
};

/** An account on one network. A network can have many, and a post can go out from several of them. */
export type SocialConnection = {
  id: string;
  platform: string;
  handle: string;
  connectedAt: string;
  /** The account's picture. Empty when the network had none; missing until it has been asked. */
  avatarUrl?: string;
  tiktok?: TikTokSession;
  youtube?: YouTubeSession;
  bluesky?: BlueskySession;
  linkedin?: LinkedInSession;
  x?: XSession;
  instagram?: MetaSession;
  facebook?: MetaSession;
  threads?: MetaSession;
};

/** Which accounts a post goes out from on each platform, by connection id. */
export type AccountChoices = Partial<Record<string, readonly string[]>>;

const PLATFORM_IDS = new Set<string>(PLATFORMS.map((platform) => platform.id));

const [connections, setConnections] = createSignal<SocialConnection[]>([]);
let loadedFor: string | undefined;

/** Reads the active workspace, so a load inside an effect reloads after a switch. */
function storageKey(userId: string) {
  return workspaceKey("plan.video.connections", userId);
}

function cleanHandle(handle: string) {
  return handle.trim().replace(/^@+/, "");
}

function isConnection(value: unknown): value is SocialConnection {
  if (!value || typeof value !== "object") return false;
  const row = value as SocialConnection;
  return PLATFORM_IDS.has(row.platform) && typeof row.handle === "string" && row.handle.length > 0;
}

/**
 * Older saves had one account per platform and no id. Give those an id. Drops
 * the daily TikTok totals one version saved, which nothing reads anymore.
 */
function withId(value: SocialConnection): SocialConnection {
  const { snapshots: _dropped, ...rest } = value as SocialConnection & { snapshots?: unknown };
  return rest.id ? rest : { ...rest, id: crypto.randomUUID() };
}

/** How an account is named on screen: "@handle", but a Facebook Page by its own name. */
export function accountLabel(account: { platform: string; handle?: string }) {
  if (!account.handle) return "";
  return account.platform === "facebook" ? account.handle : `@${account.handle}`;
}

export function socialConnections() {
  return connections();
}

export function connectionsFor(platform: string) {
  return connections().filter((item) => item.platform === platform);
}

/**
 * Every account connected, in all the person's workspaces: what the plan's
 * social accounts are counted against. The open workspace's are read live.
 */
export function connectedAccountCount(userId: string): number {
  loadSocialConnections(userId);
  const open = activeWorkspaceId();
  let count = 0;
  for (const workspace of workspaces()) {
    if (workspace.id === open) {
      count += connections().length;
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKeyFor("plan.video.connections", userId, workspace.id)) ?? "[]");
      if (Array.isArray(parsed)) count += parsed.filter(isConnection).length;
    } catch {
      // An unreadable list counts as empty, as loading it does.
    }
  }
  return count;
}

/** Whether every social account the plan connects is in use. False until the plan is known. */
export function accountsFull(userId: string): boolean {
  const most = accountsLimit();
  return most !== undefined && connectedAccountCount(userId) >= most;
}

/** Why a new account can't be connected, or null when it can. A login for one already connected always can. */
function noRoomFor(userId: string): string | null {
  // A shared workspace's accounts count against its owner's plan, which the publisher checks when the login reaches it.
  if (activeScope()) return null;
  return accountsFull(userId) ? t("Your plan connects {count} social accounts, and they're all in use. Upgrade, or add accounts in Billing, to connect another.", { count: accountsLimit()! }) : null;
}

/** Reads the account copy again. `loadSocialConnections` does nothing when this key is already loaded. */
export function reloadSocialConnections(userId: string | undefined) {
  loadedFor = undefined;
  loadSocialConnections(userId);
}

export function loadSocialConnections(userId: string | undefined) {
  // A guest has the demo's (see lib/guest.ts).
  userId = ownerOf(userId);
  if (!userId) {
    loadedFor = undefined;
    setConnections([]);
    return;
  }
  const key = storageKey(userId);
  if (loadedFor === key) return;
  loadedFor = key;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const saved = Array.isArray(parsed) ? parsed : [];
    const rows = saved.filter(isConnection).map(withId);
    setConnections(rows);
    const moved = stash(userId);
    if (moved || saved.some((item) => isConnection(item) && !item.id)) write(userId);
    handOver(userId);
  } catch {
    setConnections([]);
  }
}

/** Saves the list here and on the account, and hands any login that still has its tokens to the server. */
function persist(userId: string, connected?: string) {
  stash(userId, connected);
  write(userId);
  handOver(userId);
}

function write(userId: string) {
  localStorage.setItem(storageKey(userId), JSON.stringify(connections()));
  queueAccountSync();
}

/** The login on a connection that the server keeps, if any. An older Bluesky sign-in stays in its browser. */
function loginOf(item: SocialConnection): object | undefined {
  if (item.platform === "bluesky") return item.bluesky && (!item.bluesky.oauth || item.bluesky.server) ? item.bluesky : undefined;
  return item.tiktok ?? item.youtube ?? item.linkedin ?? item.x ?? item.instagram ?? item.facebook ?? item.threads;
}

function withoutLogin(item: SocialConnection): SocialConnection {
  if (item.tiktok) return { ...item, tiktok: withoutSecrets(item.tiktok) };
  if (item.youtube) return { ...item, youtube: withoutSecrets(item.youtube) };
  if (item.linkedin) return { ...item, linkedin: withoutSecrets(item.linkedin) };
  if (item.x) return { ...item, x: withoutSecrets(item.x) };
  if (item.instagram) return { ...item, instagram: withoutSecrets(item.instagram) };
  if (item.facebook) return { ...item, facebook: withoutSecrets(item.facebook) };
  if (item.threads) return { ...item, threads: withoutSecrets(item.threads) };
  if (item.bluesky) return { ...item, bluesky: withoutSecrets(item.bluesky) };
  return item;
}

/** Connections as the account's synced copy keeps them: without tokens. */
export function shareableConnections(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => (isConnection(row) ? withoutLogin(row) : row));
}

/**
 * Logins on their way to the server, by connection id, kept apart from the
 * connections so the account's sync, which rewrites those, can't drop one
 * before the server has it. `replace` marks a login just made, which replaces
 * the server's copy; an older copy, found in the account's synced list from
 * before logins moved, only fills a gap.
 */
type Pending = { platform: string; session: object; replace: boolean; nonce: string; team?: TeamScope };

const pendingKey = (userId: string) => `plan.video.pending-logins.${userId}`;

function readPending(userId: string): Record<string, Pending> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pendingKey(userId)) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Pending>) : {};
  } catch {
    return {};
  }
}

function writePending(userId: string, pending: Record<string, Pending>) {
  if (Object.keys(pending).length) localStorage.setItem(pendingKey(userId), JSON.stringify(pending));
  else localStorage.removeItem(pendingKey(userId));
}

/** Moves tokens off the connections into the logins on their way to the server. Says whether any moved. */
function stash(userId: string, connected?: string): boolean {
  const pending = readPending(userId);
  let moved = false;
  setConnections((current) =>
    current.map((item) => {
      const login = loginOf(item);
      if (!login || !hasSecrets(login)) return item;
      moved = true;
      const before = pending[item.id];
      // A login just made waits for the server; an older copy arriving meanwhile doesn't take its place.
      if (item.id !== connected && before?.replace) return withoutLogin(item);
      // Made in a shared workspace, it's kept for that workspace's owner.
      const team = activeScope();
      pending[item.id] = { platform: item.platform, session: login, replace: item.id === connected, nonce: crypto.randomUUID(), ...(team ? { team } : {}) };
      return withoutLogin(item);
    }),
  );
  if (moved) writePending(userId, pending);
  return moved;
}

const handing = new Map<string, Promise<void>>();
let pendingFor: string | undefined;

/** Sends the logins on their way to the server, and forgets each once the server has it. A failure waits for the next try. */
function handOver(userId: string) {
  pendingFor = userId;
  for (const [id, entry] of Object.entries(readPending(userId))) {
    if (handing.has(id)) continue;
    const work = saveLogin(id, entry.platform, entry.session, { replace: entry.replace, team: entry.team })
      .then(() => {
        const now = readPending(userId);
        // Connected again meanwhile: that newer login still has to go.
        if (now[id]?.nonce !== entry.nonce) return;
        delete now[id];
        writePending(userId, now);
      })
      .catch((error: unknown) => {
        console.warn("[connections] The login waits in this browser until the server takes it", error);
        throw error;
      })
      .finally(() => {
        handing.delete(id);
        if (readPending(userId)[id] && readPending(userId)[id]?.nonce !== entry.nonce) handOver(userId);
      });
    work.catch(() => undefined);
    handing.set(id, work);
  }
}

/** Waits for the account's login to reach the server, when it's on its way there, trying again if an earlier try failed. */
export async function loginReady(accountId: string): Promise<void> {
  if (!handing.has(accountId) && pendingFor && readPending(pendingFor)[accountId]) handOver(pendingFor);
  await handing.get(accountId)?.catch(() => {
    throw new Error(t("This account's login hasn't reached plan.video yet. Check the connection and try again."));
  });
}

/** Choices as saved, including older ones that held a single id per platform. */
export function readChoices(value: unknown): AccountChoices {
  const next: AccountChoices = {};
  if (!value || typeof value !== "object") return next;
  for (const [platform, ids] of Object.entries(value)) {
    const list = typeof ids === "string" ? [ids] : Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    if (list.length) next[platform] = [...new Set(list)];
  }
  return next;
}

/**
 * The accounts a post goes out from on a platform: the connected ones it
 * named. Only a post that named none there goes out from the only one
 * connected. So a post is not silently sent from the wrong account: not when
 * several are connected, and not when the ones it named were removed.
 */
export function accountsFor(platform: string, choices?: AccountChoices): SocialConnection[] {
  const list = connectionsFor(platform);
  const chosen = readChoices(choices)[platform] ?? [];
  if (chosen.length) return list.filter((item) => chosen.includes(item.id));
  return list.length === 1 ? list : [];
}

/**
 * Keeps a post's picks that are still connected, and starts a platform with no
 * pick on its first account. With `keepRemoved`, a platform whose picks were
 * all removed keeps them instead, so the post goes out from none there until
 * someone picks another: a change to a saved post that isn't a pick of
 * accounts doesn't move it to another account.
 */
export function accountsForPlatforms(platforms: readonly string[], previous: AccountChoices = {}, { keepRemoved = false } = {}): AccountChoices {
  const before = readChoices(previous);
  const next: AccountChoices = {};
  for (const platform of platforms) {
    const list = connectionsFor(platform);
    const named = before[platform] ?? [];
    const kept = list.filter((item) => named.includes(item.id)).map((item) => item.id);
    const ids = kept.length ? kept : keepRemoved && named.length ? named : list[0] ? [list[0].id] : [];
    if (ids.length) next[platform] = ids;
  }
  return next;
}

/** The same accounts on the same platforms, in any order. */
export function sameChoices(a: AccountChoices, b: AccountChoices): boolean {
  const left = readChoices(a);
  const right = readChoices(b);
  const platforms = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const platform of platforms) {
    const x = left[platform] ?? [];
    const y = right[platform] ?? [];
    if (x.length !== y.length || x.some((id) => !y.includes(id))) return false;
  }
  return true;
}

/** Adds or removes one account on a platform. The last one stays, so a picked platform always has an account. */
export function toggleAccount(choices: AccountChoices, platform: string, accountId: string): AccountChoices {
  const current = readChoices(choices)[platform] ?? [];
  if (current.includes(accountId)) {
    if (current.length === 1) return choices;
    return { ...choices, [platform]: current.filter((id) => id !== accountId) };
  }
  const order = connectionsFor(platform).map((item) => item.id);
  return { ...choices, [platform]: [...current, accountId].sort((a, b) => order.indexOf(a) - order.indexOf(b)) };
}

/** Every account a post goes out from, across its platforms. */
export function accountCount(platforms: readonly string[], choices?: AccountChoices): number {
  return platforms.reduce((sum, platform) => sum + Math.max(1, accountsFor(platform, choices).length), 0);
}

/** Adds an account. The same handle on the same platform is refused. */
export function connectSocial(userId: string, platform: string, handle: string): string | null {
  const clean = cleanHandle(handle);
  if (!userId || !PLATFORM_IDS.has(platform) || !clean) return t("Enter an account name.");
  loadSocialConnections(userId);
  const taken = connections().some(
    (item) => item.platform === platform && item.handle.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) return t("That account is already connected.");
  const full = noRoomFor(userId);
  if (full) return full;
  setConnections((current) => [
    ...current,
    { id: crypto.randomUUID(), platform, handle: clean, connectedAt: new Date().toISOString() },
  ]);
  persist(userId);
  return null;
}

/** Saves a TikTok account after Login Kit. The same TikTok user replaces the old login. */
export function connectTikTok(userId: string, account: { handle: string; avatarUrl?: string } & TikTokSession): string | null {
  const clean = cleanHandle(account.handle) || account.openId;
  if (!userId || !clean || !account.ticket) return t("TikTok didn't return an account.");
  loadSocialConnections(userId);
  const tiktok: TikTokSession = {
    openId: account.openId,
    ticket: account.ticket,
    expiresAt: account.expiresAt,
    scope: account.scope,
  };
  const existing = connections().find((item) => item.platform === "tiktok" && item.tiktok?.openId === account.openId);
  if (!existing) {
    const full = noRoomFor(userId);
    if (full) return full;
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    setConnections((current) =>
      current.map((item) => (item.id === existing.id ? { ...item, handle: clean, avatarUrl: account.avatarUrl ?? item.avatarUrl, tiktok } : item)),
    );
  } else {
    setConnections((current) => [
      ...current,
      { id, platform: "tiktok", handle: clean, connectedAt: new Date().toISOString(), avatarUrl: account.avatarUrl, tiktok },
    ]);
  }
  persist(userId, id);
  return null;
}


/** Saves a YouTube channel after OAuth. The same channel replaces the old login. */
export function connectYouTube(userId: string, account: { handle: string; avatarUrl?: string } & YouTubeSession): string | null {
  const clean = cleanHandle(account.handle) || "YouTube";
  if (!userId || !account.ticket) return t("YouTube didn't return an account.");
  loadSocialConnections(userId);
  const youtube: YouTubeSession = {
    channelId: account.channelId,
    ticket: account.ticket,
    expiresAt: account.expiresAt,
    scope: account.scope,
  };
  const oauth = connections().filter((item) => item.platform === "youtube" && item.youtube);
  const placeholders = connections().filter((item) => item.platform === "youtube" && !item.youtube);
  const sameChannel = account.channelId ? oauth.find((item) => item.youtube?.channelId === account.channelId) : undefined;
  const onlyLogin = !account.channelId && oauth.length === 1 ? oauth[0] : undefined;
  const existing = sameChannel ?? onlyLogin ?? (placeholders.length === 1 ? placeholders[0] : undefined);
  if (!existing) {
    const full = noRoomFor(userId);
    if (full) return full;
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    setConnections((current) =>
      current.map((item) => (item.id === existing.id ? { ...item, handle: clean, avatarUrl: account.avatarUrl ?? item.avatarUrl, youtube } : item)),
    );
  } else {
    setConnections((current) => [
      ...current,
      { id, platform: "youtube", handle: clean, connectedAt: new Date().toISOString(), avatarUrl: account.avatarUrl, youtube },
    ]);
  }
  persist(userId, id);
  return null;
}


/** Saves a LinkedIn member after OAuth. The same member replaces the old login. */
export function connectLinkedIn(userId: string, account: { handle: string; avatarUrl?: string } & LinkedInSession): string | null {
  const clean = cleanHandle(account.handle) || "LinkedIn";
  if (!userId || !account.ticket || !account.personId) return t("LinkedIn didn't return an account.");
  loadSocialConnections(userId);
  const linkedin: LinkedInSession = {
    personId: account.personId,
    ticket: account.ticket,
    ...(account.renewable ? { renewable: true } : {}),
    expiresAt: account.expiresAt,
    scope: account.scope,
  };
  const placeholders = connections().filter((item) => item.platform === "linkedin" && !item.linkedin);
  const existing =
    connections().find((item) => item.platform === "linkedin" && item.linkedin?.personId === account.personId) ??
    (placeholders.length === 1 ? placeholders[0] : undefined);
  if (!existing) {
    const full = noRoomFor(userId);
    if (full) return full;
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    setConnections((current) =>
      current.map((item) => (item.id === existing.id ? { ...item, handle: clean, avatarUrl: account.avatarUrl ?? item.avatarUrl, linkedin } : item)),
    );
  } else {
    setConnections((current) => [
      ...current,
      { id, platform: "linkedin", handle: clean, connectedAt: new Date().toISOString(), avatarUrl: account.avatarUrl, linkedin },
    ]);
  }
  persist(userId, id);
  return null;
}


/** Saves an X account after OAuth. The same X user replaces the old login. */
export function connectX(userId: string, account: { handle: string; avatarUrl?: string } & XSession): string | null {
  const clean = cleanHandle(account.handle);
  if (!userId || !clean || !account.ticket || !account.xUserId) return t("X didn't return an account.");
  loadSocialConnections(userId);
  const x: XSession = {
    xUserId: account.xUserId,
    ticket: account.ticket,
    expiresAt: account.expiresAt,
    scope: account.scope,
  };
  const existing = connections().find(
    (item) => item.platform === "x" && (item.x?.xUserId === account.xUserId || (!item.x && item.handle.toLowerCase() === clean.toLowerCase())),
  );
  if (!existing) {
    const full = noRoomFor(userId);
    if (full) return full;
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    setConnections((current) =>
      current.map((item) => (item.id === existing.id ? { ...item, handle: clean, avatarUrl: account.avatarUrl ?? item.avatarUrl, x } : item)),
    );
  } else {
    setConnections((current) => [
      ...current,
      { id, platform: "x", handle: clean, connectedAt: new Date().toISOString(), avatarUrl: account.avatarUrl, x },
    ]);
  }
  persist(userId, id);
  return null;
}

/**
 * Saves an Instagram account, Facebook Page or Threads profile after Meta's
 * login. The same account replaces its old login, and one added by name
 * before it could sign in takes the login.
 */
export function connectMeta(userId: string, platform: "instagram" | "facebook" | "threads", account: { handle: string; avatarUrl?: string } & MetaSession): string | null {
  const clean = cleanHandle(account.handle);
  if (!userId || !clean || !account.ticket || !account.accountId) return t("{network} didn't return an account.", { network: PLATFORMS.find((item) => item.id === platform)?.name ?? platform });
  loadSocialConnections(userId);
  const session: MetaSession = { accountId: account.accountId, ticket: account.ticket, expiresAt: account.expiresAt, scope: account.scope };
  const existing = connections().find(
    (item) => item.platform === platform && (item[platform]?.accountId === account.accountId || (!item[platform] && item.handle.toLowerCase() === clean.toLowerCase())),
  );
  if (!existing) {
    const full = noRoomFor(userId);
    if (full) return full;
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    setConnections((current) =>
      current.map((item) => (item.id === existing.id ? { ...item, handle: clean, avatarUrl: account.avatarUrl ?? item.avatarUrl, [platform]: session } : item)),
    );
  } else {
    setConnections((current) => [
      ...current,
      { id, platform, handle: clean, connectedAt: new Date().toISOString(), avatarUrl: account.avatarUrl, [platform]: session },
    ]);
  }
  persist(userId, id);
  return null;
}

/** Saves a Bluesky account after sign-in. The same account replaces its old login. */
export function connectBluesky(userId: string, account: { handle: string; avatarUrl?: string } & BlueskySession): string | null {
  const clean = cleanHandle(account.handle);
  if (!userId || !clean || !account.did || (account.oauth ? !account.ticket : !account.accessJwt)) return t("Bluesky didn't return an account.");
  loadSocialConnections(userId);
  const bluesky: BlueskySession = account.oauth
    ? { did: account.did, pds: account.pds, oauth: true, server: true, ticket: account.ticket }
    : { did: account.did, pds: account.pds, accessJwt: account.accessJwt, refreshJwt: account.refreshJwt };
  const existing = connections().find(
    (item) => item.platform === "bluesky" && (item.bluesky?.did === account.did || (!item.bluesky && item.handle.toLowerCase() === clean.toLowerCase())),
  );
  if (!existing) {
    const full = noRoomFor(userId);
    if (full) return full;
  }
  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    setConnections((current) =>
      current.map((item) => (item.id === existing.id ? { ...item, handle: clean, avatarUrl: account.avatarUrl ?? item.avatarUrl, bluesky } : item)),
    );
  } else {
    setConnections((current) => [
      ...current,
      { id, platform: "bluesky", handle: clean, connectedAt: new Date().toISOString(), avatarUrl: account.avatarUrl, bluesky },
    ]);
  }
  persist(userId, id);
  return null;
}


/** Saves an account's picture. An empty one means the network had none, so it isn't asked again. */
export function updateAccountAvatar(userId: string, accountId: string, avatarUrl: string) {
  if (!userId) return;
  loadSocialConnections(userId);
  setConnections((current) => current.map((item) => (item.id === accountId ? { ...item, avatarUrl } : item)));
  persist(userId);
}

/** Saves a YouTube channel's name and picture as YouTube has them now, and when they were read. */
export function updateYouTubeChannel(userId: string, accountId: string, channel: { handle: string; avatarUrl: string }) {
  if (!userId) return;
  loadSocialConnections(userId);
  const handle = cleanHandle(channel.handle) || "YouTube";
  setConnections((current) =>
    current.map((item) =>
      item.id === accountId && item.youtube
        ? { ...item, handle, avatarUrl: channel.avatarUrl, youtube: { ...item.youtube, checkedAt: Date.now() } }
        : item,
    ),
  );
  persist(userId);
}

export function disconnectSocial(userId: string, accountId: string) {
  if (!userId) return;
  loadSocialConnections(userId);
  setConnections((current) => current.filter((item) => item.id !== accountId));
  const pending = readPending(userId);
  delete pending[accountId];
  writePending(userId, pending);
  persist(userId);
}
