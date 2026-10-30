/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A network's login comes back to /<network>/callback. That page passes what
// came back on to Connections straight away, and Connections finishes the
// login there, with a toast, instead of on a page of its own. A client's
// sign-in started from a connect link goes back to the link's page instead
// (lib/connect-link.ts), which finishes it the same way.

import { toast } from "somoto";

import { loadBlueskyProfile } from "@/lib/bluesky";
import { finishBlueskySignIn } from "@/lib/bluesky-oauth";
import { linkSignInFor } from "@/lib/connect-link";
import { t } from "@/lib/i18n";
import { exchangeLinkedInCode, takeLinkedInState } from "@/lib/linkedin";
import { exchangeMetaCode, isMetaNetwork, takeMetaState } from "@/lib/meta";
import { connectBluesky, connectLinkedIn, connectMeta, connectTikTok, connectX, connectYouTube, loadSocialConnections } from "@/lib/social-connections";
import { exchangeTikTokCode, takeTikTokState } from "@/lib/tiktok";
import { exchangeXCode, takeXState } from "@/lib/x";
import { exchangeYouTubeCode, takeYouTubeState } from "@/lib/youtube";

const KEY = "plan.video.connect-return";

export type ReturningNetwork = "tiktok" | "youtube" | "bluesky" | "linkedin" | "x" | "instagram" | "facebook" | "threads";

const NAMES: Record<ReturningNetwork, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
};

/** Keeps what the network sent back, for Connections or a connect link's page to finish, and says where that is. */
export function handOffConnection(network: ReturningNetwork, search: string): string {
  sessionStorage.setItem(KEY, JSON.stringify({ network, search, redirect: `${window.location.origin}${window.location.pathname}` }));
  const link = linkSignInFor(network, search);
  return link ? `/connect/${link}` : "/dashboard?dashboard=connections";
}

/** What a network sent back to this tab, taken once: for a connect link's page, which finishes it itself. */
export function takeHandOff(): { network: ReturningNetwork; search: string } | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  sessionStorage.removeItem(KEY);
  try {
    const pending = JSON.parse(raw) as { network?: unknown; search?: unknown };
    return typeof pending.network === "string" && Object.hasOwn(NAMES, pending.network) && typeof pending.search === "string"
      ? { network: pending.network as ReturningNetwork, search: pending.search }
      : null;
  } catch {
    return null;
  }
}

/** Why a network didn't hand back a login, in words, or null when it did. For a connect link's page. */
export function loginRefusal(network: ReturningNetwork, search: string): string | null {
  return refusal(network, new URLSearchParams(search));
}

/** The code a login came back with, after checking it came back to the login this tab started. */
function codeFrom(params: URLSearchParams, expected: string | null, name: string): string {
  const code = params.get("code");
  const returned = params.get("state");
  if (!code || !returned || returned !== expected) throw new Error(t("{network} sent the login back without a matching code. Try again.", { network: name }));
  return code;
}

/** Why a network didn't hand back a login, in words, or null when it did. */
function refusal(network: ReturningNetwork, params: URLSearchParams): string | null {
  const error = params.get("error");
  if (!error) return null;
  const cancelled = ["access_denied", "user_cancelled_login", "user_cancelled_authorize"].includes(error);
  if (cancelled) return t("{network} wasn't connected: the login was cancelled.", { network: NAMES[network] });
  return params.get("error_description") || error;
}

async function finish(network: ReturningNetwork, userId: string, params: URLSearchParams): Promise<string> {
  loadSocialConnections(userId);
  if (network === "tiktok") {
    const account = await exchangeTikTokCode(codeFrom(params, takeTikTokState(), "TikTok"));
    const problem = connectTikTok(userId, { ...account, handle: account.displayName });
    if (problem) throw new Error(problem);
    return account.displayName;
  }
  if (network === "youtube") {
    const account = await exchangeYouTubeCode(codeFrom(params, takeYouTubeState(), "YouTube"));
    const problem = connectYouTube(userId, account);
    if (problem) throw new Error(problem);
    return account.handle;
  }
  if (network === "linkedin") {
    const account = await exchangeLinkedInCode(codeFrom(params, takeLinkedInState(), "LinkedIn"));
    const problem = connectLinkedIn(userId, account);
    if (problem) throw new Error(problem);
    return account.handle;
  }
  if (network === "x") {
    const account = await exchangeXCode(codeFrom(params, takeXState(), "X"));
    const problem = connectX(userId, account);
    if (problem) throw new Error(problem);
    return account.handle;
  }
  if (isMetaNetwork(network)) {
    // Facebook gives each Page that was shared. One that can't be kept doesn't stop the rest.
    const accounts = await exchangeMetaCode(network, codeFrom(params, takeMetaState(network), NAMES[network]));
    const kept: string[] = [];
    let problem: string | null = null;
    for (const account of accounts) {
      const refused = connectMeta(userId, network, account);
      if (refused) problem ??= refused;
      else kept.push(account.handle);
    }
    if (!kept.length) throw new Error(problem ?? t("{network} didn't return an account.", { network: NAMES[network] }));
    if (problem) toast.error(t("Some Pages weren't connected"), { description: problem });
    return kept.join(", ");
  }
  const { did, ticket } = await finishBlueskySignIn(params);
  const profile = await loadBlueskyProfile(did).catch(() => ({ handle: did, avatarUrl: "" }));
  const problem = connectBluesky(userId, { did, pds: "", oauth: true, ticket, handle: profile.handle, avatarUrl: profile.avatarUrl });
  if (problem) throw new Error(problem);
  return profile.handle;
}

/** Finishes a login that came back to this tab, if one did, and says how it went. */
export async function finishPendingConnection(userId: string): Promise<void> {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return;
  sessionStorage.removeItem(KEY);
  let pending: { network: ReturningNetwork; search: string; redirect: string };
  try {
    pending = JSON.parse(raw);
  } catch {
    return;
  }
  const name = NAMES[pending.network];
  if (!name) return;
  const params = new URLSearchParams(pending.search);
  const refused = refusal(pending.network, params);
  if (refused) {
    toast.error(t("Couldn't connect {network}", { network: name }), { description: refused });
    return;
  }
  const id = toast.loading(t("Connecting {network}…", { network: name }));
  try {
    const handle = await finish(pending.network, userId, params);
    toast.success(t("Connected {network}", { network: name }), { id, description: !handle ? undefined : pending.network === "facebook" ? handle : `@${handle.replace(/^@+/, "")}` });
  } catch (error) {
    toast.error(t("Couldn't connect {network}", { network: name }), { id, description: error instanceof Error ? error.message : t("Try again in a moment.") });
  }
}
