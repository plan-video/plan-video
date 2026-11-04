/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Through the server: LinkedIn's API doesn't answer browsers, and the client secret has to stay on the server.

import { appOrigins, atThisSite } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { keepForLogin, takeFromLogin } from "@/lib/login-handoff";
import { supabase } from "@/lib/supabase";
import { askNetwork, exchangeOnServer } from "@/lib/publishing";
import { loginReady, type LinkedInSession } from "@/lib/social-connections";

const LINKEDIN_ORIGINS = new Set([...appOrigins(), "http://localhost:5173"]);

/** In characters. */
export const LINKEDIN_TEXT_LIMIT = 3000;
export const LINKEDIN_RENEW_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

const STATE_KEY = "plan.video.linkedin.state";
/** Starts the state of a login for company Pages, so the callback knows which kind came back. */
const PAGES_STATE = "pages-";

/** Pages stay off until LinkedIn approves the Pages app beyond its test limits. */
export const LINKEDIN_PAGES = import.meta.env.VITE_LINKEDIN_PAGES === "true";

/** Must match a URL saved on the LinkedIn app exactly. */
export function linkedinRedirect(): string {
  if (!LINKEDIN_ORIGINS.has(window.location.origin)) throw new Error(atThisSite(t("Open https://plan.video to connect LinkedIn.")));
  return `${window.location.origin}/linkedin/callback`;
}

/** Never LinkedIn's tokens. */
type Exchanged = {
  personId?: string;
  displayName?: string;
  avatarUrl?: string;
  expiresAt?: number;
  renewable?: boolean;
  scope?: string;
  ticket?: string;
};

export function rememberLinkedInState(forPages = false): string {
  const state = `${forPages ? PAGES_STATE : ""}${crypto.randomUUID()}`;
  keepForLogin(STATE_KEY, state);
  return state;
}

export function takeLinkedInState(): string | null {
  return takeFromLogin(STATE_KEY);
}

export const isLinkedInPagesState = (state: string | null): boolean => !!state?.startsWith(PAGES_STATE);

export async function linkedinAuthorizeUrl(state: string): Promise<string> {
  const { url, error } = await post<{ url?: string; error?: string }>("/api/linkedin/authorize", { redirectUri: linkedinRedirect(), state, ...(isLinkedInPagesState(state) ? { pages: true } : {}) });
  if (!url) throw new Error(error || t("Couldn't start LinkedIn login."));
  return url;
}

/** The publisher swaps the code for the login and keeps it; this gets a ticket to attach it. */
export async function exchangeLinkedInCode(code: string): Promise<LinkedInSession & { handle: string; avatarUrl: string }> {
  const found = await exchangeOnServer<Exchanged>("linkedin/exchange", { code, redirectUri: linkedinRedirect() }, t("Couldn't reach LinkedIn. Try again in a moment."));
  if (!found.ticket || !found.personId) throw new Error(t("LinkedIn didn't return a login."));
  return {
    handle: found.displayName || "LinkedIn",
    avatarUrl: found.avatarUrl || "",
    personId: found.personId,
    ticket: found.ticket,
    renewable: found.renewable === true,
    expiresAt: found.expiresAt || 0,
    scope: found.scope || "",
  };
}

type ExchangedPages = {
  accounts?: { organizationId?: string; displayName?: string; expiresAt?: number; renewable?: boolean; scope?: string; ticket?: string }[];
};

/** One account for each Page the member can post to, each with its own ticket. */
export async function exchangeLinkedInPagesCode(code: string): Promise<(LinkedInSession & { handle: string; avatarUrl: string })[]> {
  const found = await exchangeOnServer<ExchangedPages>("linkedin/pages/exchange", { code, redirectUri: linkedinRedirect() }, t("Couldn't reach LinkedIn. Try again in a moment."));
  return (found.accounts ?? []).map((account) => ({
    handle: account.displayName || "LinkedIn",
    avatarUrl: "",
    organizationId: account.organizationId,
    ticket: account.ticket,
    renewable: account.renewable === true,
    expiresAt: account.expiresAt || 0,
    scope: account.scope || "",
  }));
}

/** LinkedIn gave a refresh token. Older logins kept it here. */
export const linkedinRenewable = (session: Pick<LinkedInSession, "renewable" | "refreshToken">): boolean => !!(session.renewable || session.refreshToken);

/** Run out, or will within a week, with no refresh token to renew it. */
export function linkedinNeedsRenewal(session: LinkedInSession, now = Date.now()): boolean {
  return !linkedinRenewable(session) && session.expiresAt - now < LINKEDIN_RENEW_AHEAD_MS;
}

/** Read by the publisher. Empty when they have none. */
export async function loadLinkedInAvatar(accountId: string): Promise<string> {
  await loginReady(accountId);
  const result = await askNetwork<{ avatarUrl?: string }>("linkedin/profile", accountId, t("Couldn't reach LinkedIn. Try again in a moment."));
  return result.avatarUrl || "";
}

async function post<T extends { error?: string }>(path: string, body: unknown): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to connect LinkedIn."));
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(t("Couldn't reach LinkedIn. Try again in a moment."));
  }
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!payload) throw new Error(t("LinkedIn sent an empty reply."));
  if (!response.ok && payload.error) throw new Error(payload.error);
  return payload;
}
