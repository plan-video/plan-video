/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The browser's side of the publisher (services/publisher), which sends posts
// from the server at their time. Connected accounts' logins are kept there,
// sealed; this browser keeps only who the account is. No token comes back
// here: for analytics, a profile picture or what TikTok lets a post do, the
// publisher calls the network itself and sends back what it said.
//
// In a workspace someone shared, a request names it as `team`, and the
// publisher acts for its owner, whose accounts and posts they are.

import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { activeScope, type TeamScope } from "@/lib/workspaces";

const withTeam = (body: object, team: TeamScope | null | undefined) => (team ? { ...body, team } : body);

export class PublishingError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The login has to be connected again. */
    readonly expired = false,
  ) {
    super(message);
  }
}

/** `fallback` is said when the publisher gives no reason of its own. */
async function call<T>(route: string, body: unknown, fallback = t("Publishing isn't available right now.")): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new PublishingError(401, t("Sign in to plan.video first."));
  let response: Response;
  try {
    response = await fetch(`/api/publisher/${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PublishingError(0, t("Couldn't reach plan.video. Check the connection and try again."));
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; expired?: boolean }) | null;
  if (!response.ok || !payload) {
    throw new PublishingError(response.status, payload?.error || fallback, payload?.expired === true);
  }
  return payload;
}

/** The parts of a login that let someone act as the account. They stay on the server. */
const SECRET_FIELDS = ["accessToken", "refreshToken", "accessJwt", "refreshJwt", "ticket"] as const;

/** Whether a login still carries tokens, so it has to go to the server before it's saved anywhere else. */
export function hasSecrets(session: object | undefined): boolean {
  return !!session && SECRET_FIELDS.some((key) => typeof (session as Record<string, unknown>)[key] === "string" && (session as Record<string, string>)[key] !== "");
}

/** The login without its tokens: what this browser and the account's synced copy keep. */
export function withoutSecrets<T extends object>(session: T): T {
  const copy = { ...session } as Record<string, unknown>;
  for (const key of SECRET_FIELDS) delete copy[key];
  return copy as T;
}

/**
 * Keeps a login on the server. One just made in Connections replaces the one
 * there; an older copy found in this browser only fills a gap, since the one
 * there may have been refreshed since.
 */
export async function saveLogin(
  connectionId: string,
  platform: string,
  session: object,
  { replace, team }: { replace: boolean; team?: TeamScope | null },
): Promise<void> {
  await call("login/save", withTeam({ connectionId, platform, session, replace }, team));
}

/**
 * Asks the publisher to read something from TikTok or LinkedIn with one of the
 * open workspace's accounts. Their tokens stay there, so someone taken out of
 * a workspace has none left to post with.
 */
export async function askNetwork<T>(
  route: "tiktok/profile" | "tiktok/videos" | "tiktok/creator" | "linkedin/profile",
  connectionId: string,
  fallback: string,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(route, withTeam({ connectionId }, team), fallback);
}

/**
 * Asks the publisher to call YouTube: to finish connecting a channel, or for a
 * channel's picture or numbers. YouTube's tokens stay there, since anyone
 * holding one could upload around plan.video's share of YouTube's quota.
 */
export async function askYouTube<T>(
  route: "youtube/exchange" | "youtube/profile" | "youtube/analytics",
  body: object,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(route, withTeam(body, team), t("Couldn't reach YouTube. Try again in a moment."));
}

/**
 * Finishes connecting a TikTok or LinkedIn account through the publisher, which
 * swaps the code for the login and keeps it. The browser gets who the account
 * is and a ticket to attach the login with, never the tokens.
 */
export async function exchangeOnServer<T>(
  route: "tiktok/exchange" | "linkedin/exchange",
  body: object,
  fallback: string,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(route, withTeam(body, team), fallback);
}

/**
 * Finishes connecting an X account through the publisher, which keeps its
 * login. X's tokens stay there, since X bills plan.video for every post and
 * anyone holding one could post around their plan's X limits.
 */
export async function exchangeXOnServer<T>(body: object, team: TeamScope | null = activeScope()): Promise<T> {
  return call<T>("x/exchange", withTeam(body, team), t("Couldn't reach X. Try again in a moment."));
}

/** Instagram, Facebook Pages and Threads: Meta's networks, whose logins the publisher keeps (lib/meta.ts). */
export type MetaNetwork = "instagram" | "facebook" | "threads";

/**
 * Asks the publisher about one of Meta's networks: to start or finish
 * connecting, or for an account's picture or numbers. Their tokens stay there.
 */
export async function askMeta<T>(
  network: MetaNetwork,
  action: "authorize" | "exchange" | "profile" | "analytics",
  body: object,
  fallback: string,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(`${network}/${action}`, withTeam(body, team), fallback);
}

/** Ends plan.video's access at the network and drops the login. Says whether the network confirmed it. */
export async function forgetLogin(connectionId: string, team: TeamScope | null = activeScope()): Promise<boolean> {
  const result = await call<{ revoked: boolean }>("login/forget", withTeam({ connectionId }, team));
  return result.revoked;
}

/**
 * Deletes the signed-in person's account. The server ends their plan, erases
 * their files and ends access at their networks before it deletes the account.
 */
export async function deleteAccountOnServer(): Promise<void> {
  await call("account/delete", {}, t("The account couldn't be deleted."));
}

/** "Post now": the server queues the post's networks and sends them in a moment. Returns their rows, as post_deliveries has them now. */
export async function requestSend<Row>(postId: string, team: TeamScope | null = activeScope()): Promise<Row[]> {
  return (await call<{ deliveries: Row[] }>("send", withTeam({ postId }, team))).deliveries;
}

/** Emails someone just asked into a workspace. False when they already have an account, and will find the invite there. */
export async function sendInviteEmail(invite: string): Promise<boolean> {
  return (await call<{ emailed: boolean }>("team/invite", { invite })).emailed;
}
