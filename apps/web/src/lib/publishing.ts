/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Logins are kept on the publisher, sealed; this browser keeps only who the account is, and no token comes back.
// In a shared workspace a request names it as `team`, and the publisher acts for its owner.

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

/** They stay on the server. */
const SECRET_FIELDS = ["accessToken", "refreshToken", "accessJwt", "refreshJwt", "ticket"] as const;

/** If so, it must go to the server before it's saved anywhere else. */
export function hasSecrets(session: object | undefined): boolean {
  return !!session && SECRET_FIELDS.some((key) => typeof (session as Record<string, unknown>)[key] === "string" && (session as Record<string, string>)[key] !== "");
}

export function withoutSecrets<T extends object>(session: T): T {
  const copy = { ...session } as Record<string, unknown>;
  for (const key of SECRET_FIELDS) delete copy[key];
  return copy as T;
}

/** An older copy found in this browser only fills a gap: the server's may have been refreshed since. */
export async function saveLogin(
  connectionId: string,
  platform: string,
  session: object,
  { replace, team }: { replace: boolean; team?: TeamScope | null },
): Promise<void> {
  await call("login/save", withTeam({ connectionId, platform, session, replace }, team));
}

/** Tokens stay on the server, so someone taken out of a workspace has none left to post with. */
export async function askNetwork<T>(
  route: "tiktok/profile" | "tiktok/videos" | "tiktok/creator" | "linkedin/profile",
  connectionId: string,
  fallback: string,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(route, withTeam({ connectionId }, team), fallback);
}

/** YouTube's tokens stay on the server: anyone holding one could upload around plan.video's YouTube quota. */
export async function askYouTube<T>(
  route: "youtube/exchange" | "youtube/profile" | "youtube/analytics",
  body: object,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(route, withTeam(body, team), t("Couldn't reach YouTube. Try again in a moment."));
}

/** The publisher swaps the code and keeps the login; the browser gets a ticket, never the tokens. */
export async function exchangeOnServer<T>(
  route: "tiktok/exchange" | "linkedin/exchange",
  body: object,
  fallback: string,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(route, withTeam(body, team), fallback);
}

/** X's tokens stay on the server: X bills per post, and a token holder could post around the plan's X limits. */
export async function exchangeXOnServer<T>(body: object, team: TeamScope | null = activeScope()): Promise<T> {
  return call<T>("x/exchange", withTeam(body, team), t("Couldn't reach X. Try again in a moment."));
}

export type MetaNetwork = "instagram" | "facebook" | "threads";

/** Their tokens stay on the publisher. */
export async function askMeta<T>(
  network: MetaNetwork,
  action: "authorize" | "exchange" | "profile" | "analytics",
  body: object,
  fallback: string,
  team: TeamScope | null = activeScope(),
): Promise<T> {
  return call<T>(`${network}/${action}`, withTeam(body, team), fallback);
}

/** Says whether the network confirmed it. */
export async function forgetLogin(connectionId: string, team: TeamScope | null = activeScope()): Promise<boolean> {
  const result = await call<{ revoked: boolean }>("login/forget", withTeam({ connectionId }, team));
  return result.revoked;
}

/** The server ends the plan, erases files and ends network access before deleting the account. */
export async function deleteAccountOnServer(): Promise<void> {
  await call("account/delete", {}, t("The account couldn't be deleted."));
}

/** Returns the network rows as post_deliveries has them now. */
export async function requestSend<Row>(postId: string, team: TeamScope | null = activeScope()): Promise<Row[]> {
  return (await call<{ deliveries: Row[] }>("send", withTeam({ postId }, team))).deliveries;
}

/** False when they already have an account, and will find the invite there. */
export async function sendInviteEmail(invite: string): Promise<boolean> {
  return (await call<{ emailed: boolean }>("team/invite", { invite })).emailed;
}
