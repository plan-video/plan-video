/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Connecting Meta's networks: Instagram (professional accounts, with
// Instagram's own login), Facebook Pages and Threads. The publisher
// (services/publisher, meta-logins.mjs) starts the login, since the app
// secrets stay on the server, swaps the code Meta sends back for the login,
// keeps it, and posts and reads numbers with it. The browser gets who the
// account is and a ticket to attach the login with, never Meta's tokens.
//
// Facebook's login asks which Pages to share, and each one shared becomes an
// account here.

import { APP_ORIGIN, appOrigins, atThisSite } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { askMeta, type MetaNetwork } from "@/lib/publishing";
import type { MetaSession } from "@/lib/social-connections";

export type { MetaNetwork } from "@/lib/publishing";

export const META_NETWORKS: readonly MetaNetwork[] = ["instagram", "facebook", "threads"];

export const isMetaNetwork = (id: string): id is MetaNetwork => (META_NETWORKS as readonly string[]).includes(id);

export const META_NAMES: Record<MetaNetwork, string> = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

/** Origins whose `/<network>/callback` is saved on the Meta app. Instagram and Threads take https only. */
const META_ORIGINS = new Set(appOrigins());

const stateKey = (network: MetaNetwork) => `plan.video.${network}.state`;

/** The redirect for this tab. It has to match a URL saved on the Meta app, exactly. */
export function metaRedirect(network: MetaNetwork): string {
  if (!META_ORIGINS.has(window.location.origin)) throw new Error(atThisSite(t("Open https://plan.video to connect {network}.", { network: META_NAMES[network] })));
  return `${APP_ORIGIN}/${network}/callback`;
}

/** One account a login came back with: who it is, and its login sealed for the server. */
export type MetaAccount = MetaSession & { handle: string; avatarUrl: string };

export function rememberMetaState(network: MetaNetwork): string {
  const state = crypto.randomUUID();
  keepForLogin(stateKey(network), state);
  return state;
}

export function takeMetaState(network: MetaNetwork): string | null {
  return takeFromLogin(stateKey(network));
}

export async function metaAuthorizeUrl(network: MetaNetwork, state: string): Promise<string> {
  const { url } = await askMeta<{ url?: string }>(network, "authorize", { redirectUri: metaRedirect(network), state }, t("Couldn't start {network} login.", { network: META_NAMES[network] }));
  if (!url) throw new Error(t("Couldn't start {network} login.", { network: META_NAMES[network] }));
  return url;
}

/**
 * Finishes connecting. The publisher swaps the code for the login and keeps
 * it; this gets each account it reaches, with a ticket to attach its login.
 * Instagram and Threads give one account, Facebook one per Page shared.
 */
export async function exchangeMetaCode(network: MetaNetwork, code: string): Promise<MetaAccount[]> {
  const found = await askMeta<{ accounts?: Partial<MetaAccount>[] }>(
    network,
    "exchange",
    { code, redirectUri: metaRedirect(network) },
    t("Couldn't reach {network}. Try again in a moment.", { network: META_NAMES[network] }),
  );
  const accounts = (found.accounts ?? []).filter((account): account is MetaAccount => !!account.accountId && !!account.ticket);
  if (!accounts.length) {
    throw new Error(network === "facebook" ? t("Facebook didn't share any Pages. Connect again and choose the Pages to post to.") : t("{network} didn't return an account.", { network: META_NAMES[network] }));
  }
  return accounts.map((account) => ({
    accountId: account.accountId,
    ticket: account.ticket,
    handle: account.handle || META_NAMES[network],
    avatarUrl: account.avatarUrl || "",
    expiresAt: account.expiresAt || 0,
    scope: account.scope || "",
  }));
}

/** The account's current name and picture, which Meta's picture links don't keep for long. */
export async function loadMetaProfile(network: MetaNetwork, connectionId: string): Promise<{ handle?: string; avatarUrl?: string }> {
  return askMeta(network, "profile", { connectionId }, t("Couldn't reach {network}. Try again in a moment.", { network: META_NAMES[network] }));
}
