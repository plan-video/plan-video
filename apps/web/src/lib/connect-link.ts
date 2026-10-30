/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Client connect links (services/publisher/connect-links.mjs). A workspace's
// owner or an admin makes a link in Connections and sends it to a client, who
// opens plan.video/connect/<link> without an account and signs in to their
// own social accounts there. Each lands in the workspace, its login kept on
// the server, as if it had been connected in Connections.
//
// The client's sign-in leaves for the network from the link's page and comes
// back to the network's /<network>/callback, as any connection does; what it
// started is kept here, so the callback sends the client back to the link's
// page (connect-return.ts) to finish it.

import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { supabase } from "@/lib/supabase";
import { activeScope, type TeamScope } from "@/lib/workspaces";

/** A link as the person who sends it sees it. */
export type ConnectLink = { link: string; expiresAt: string; connected: number };

/** What the link's page shows the client. */
export type OpenedLink = { workspace: string; from: string; expiresAt: string; networks: string[] };

/** An account the client connected, as the page lists it. */
export type LinkedAccount = { platform: string; handle: string; avatarUrl: string };

/** The networks a link's sign-in can start for. */
export type LinkNetwork = "x" | "instagram" | "tiktok" | "youtube" | "linkedin" | "facebook" | "threads" | "bluesky";

const SIGN_IN_KEY = "plan.video.connect-link.sign-in";

/** A sign-in started from a link's page: which link and network, and what its return is checked against. */
type Started = { link: string; network: LinkNetwork; state: string; verifier: string };

export class ConnectLinkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The address a client opens. */
export function connectLinkUrl(link: string): string {
  return `${window.location.origin}/connect/${link}`;
}

async function call<T>(route: string, body: object, signedIn: boolean): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signedIn) {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    if (!session) throw new ConnectLinkError(401, t("Sign in to plan.video first."));
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  let response: Response;
  try {
    response = await fetch(`/api/publisher/${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ConnectLinkError(0, t("Couldn't reach plan.video. Check the connection and try again."));
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new ConnectLinkError(response.status, payload?.error || t("Try again in a moment."));
  return payload;
}

// --- For the person who sends the link

/** In someone else's workspace, the request names it; in your own, which one. */
const where = (workspace: string, team: TeamScope | null) => (team ? { team } : { workspace });

/** The workspace's open link, or null. */
export async function loadConnectLink(workspace: string, team: TeamScope | null = activeScope()): Promise<ConnectLink | null> {
  return (await call<{ link: ConnectLink | null }>("connect-link/current", where(workspace, team), true)).link;
}

/** A new link for the workspace, which turns off the one before. The names are what the client is shown. */
export async function createConnectLink(
  workspace: string,
  names: { workspaceName: string; fromName: string },
  team: TeamScope | null = activeScope(),
): Promise<ConnectLink> {
  return (await call<{ link: ConnectLink }>("connect-link/create", { ...where(workspace, team), ...names }, true)).link;
}

/** Turns the workspace's link off. */
export async function revokeConnectLink(workspace: string, team: TeamScope | null = activeScope()): Promise<void> {
  await call("connect-link/revoke", where(workspace, team), true);
}

// --- For the client, with the link alone

/** What the link is for. A link that has run out or was turned off answers 404. */
export function openConnectLink(link: string): Promise<OpenedLink> {
  return call<OpenedLink>("connect-link/open", { link }, false);
}

/** Starts the client's sign-in to a network, and leaves for it. `handle` is Bluesky's, when the account isn't on bsky.social. */
export async function startLinkSignIn(link: string, network: LinkNetwork, handle = ""): Promise<void> {
  const state = crypto.randomUUID();
  const verifier = codeVerifier();
  const { url } = await call<{ url: string }>(
    "connect-link/authorize",
    { link, network, redirectUri: `${window.location.origin}/${network}/callback`, state, codeChallenge: await codeChallenge(verifier), handle },
    false,
  );
  keepForLogin(SIGN_IN_KEY, JSON.stringify({ link, network, state, verifier } satisfies Started));
  window.location.assign(url);
}

function readStarted(raw: string | null): Started | null {
  if (!raw) return null;
  try {
    const started = JSON.parse(raw) as Partial<Started>;
    return typeof started.link === "string" && typeof started.network === "string" && typeof started.state === "string" && typeof started.verifier === "string"
      ? (started as Started)
      : null;
  } catch {
    return null;
  }
}

/**
 * The link a network's sign-in coming back with `search` was started from,
 * if it was: the same network, and for all but Bluesky, whose sign-in the
 * server keeps track of, the same state. Leaves it kept, for the link's page.
 */
export function linkSignInFor(network: string, search: string): string | null {
  let kept: { value?: unknown; until?: unknown } | null = null;
  try {
    kept = JSON.parse(localStorage.getItem(SIGN_IN_KEY) ?? "null");
  } catch {
    return null;
  }
  if (!kept || typeof kept.value !== "string" || typeof kept.until !== "number" || kept.until <= Date.now()) return null;
  const started = readStarted(kept.value);
  if (!started || started.network !== network) return null;
  if (network !== "bluesky" && new URLSearchParams(search).get("state") !== started.state) return null;
  return started.link;
}

/**
 * Finishes the sign-in that came back to this link's page with `search`, and
 * gives the accounts it connected. A note says what couldn't be kept, as when
 * one of several Facebook Pages didn't fit.
 */
export async function finishLinkSignIn(link: string, network: string, search: string): Promise<{ accounts: LinkedAccount[]; problem?: string }> {
  const started = readStarted(takeFromLogin(SIGN_IN_KEY));
  if (!started || started.link !== link || started.network !== network) throw new ConnectLinkError(400, t("That sign-in didn't start here. Try again."));
  const params = new URLSearchParams(search);
  if (network === "bluesky") return call("connect-link/exchange", { link, network, query: search.replace(/^\?/, "") }, false);
  const code = params.get("code");
  if (!code || params.get("state") !== started.state) throw new ConnectLinkError(400, t("The network sent the sign-in back without a matching code. Try again."));
  return call("connect-link/exchange", { link, network, code, redirectUri: `${window.location.origin}/${network}/callback`, codeVerifier: started.verifier }, false);
}

/** 32 random bytes, which is 43 characters of base64url. */
function codeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
