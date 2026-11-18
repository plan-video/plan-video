/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The publisher starts the login, since the app secret stays on the server, and keeps it
// (services/publisher/pinterest-logins.mjs). The browser only gets a ticket, never Pinterest's tokens.

import { APP_ORIGIN, appOrigins, atThisSite } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { askPinterest } from "@/lib/publishing";
import type { MetaSession } from "@/lib/social-connections";

const STATE_KEY = "plan.video.pinterest.state";
const UNREACHABLE = () => t("Couldn't reach {network}. Try again in a moment.", { network: "Pinterest" });

/** Must match a URL saved on the Pinterest app exactly. */
function pinterestRedirect(): string {
  if (!appOrigins().includes(window.location.origin)) throw new Error(atThisSite(t("Open https://plan.video to connect {network}.", { network: "Pinterest" })));
  return `${APP_ORIGIN}/pinterest/callback`;
}

export function rememberPinterestState(): string {
  const state = crypto.randomUUID();
  keepForLogin(STATE_KEY, state);
  return state;
}

export function takePinterestState(): string | null {
  return takeFromLogin(STATE_KEY);
}

export async function pinterestAuthorizeUrl(state: string): Promise<string> {
  const failed = t("Couldn't start {network} login.", { network: "Pinterest" });
  const { url } = await askPinterest<{ url?: string }>("authorize", { redirectUri: pinterestRedirect(), state }, failed);
  if (!url) throw new Error(failed);
  return url;
}

export async function exchangePinterestCode(code: string): Promise<MetaSession & { handle: string; avatarUrl: string }> {
  const found = await askPinterest<Partial<MetaSession> & { handle?: string; avatarUrl?: string }>("exchange", { code, redirectUri: pinterestRedirect() }, UNREACHABLE());
  if (!found.accountId || !found.ticket) throw new Error(t("{network} didn't return an account.", { network: "Pinterest" }));
  return {
    accountId: found.accountId,
    ticket: found.ticket,
    handle: found.handle || "Pinterest",
    avatarUrl: found.avatarUrl || "",
    expiresAt: found.expiresAt || 0,
    scope: found.scope || "",
  };
}

export async function loadPinterestAvatar(connectionId: string): Promise<string | null> {
  return (await askPinterest<{ avatarUrl?: string }>("profile", { connectionId }, UNREACHABLE())).avatarUrl ?? null;
}

export async function loadPinterestBoardNames(connectionId: string): Promise<string[]> {
  const { boards } = await askPinterest<{ boards?: string[] }>("boards", { connectionId }, UNREACHABLE());
  return (boards ?? []).filter((name) => typeof name === "string" && !!name);
}
