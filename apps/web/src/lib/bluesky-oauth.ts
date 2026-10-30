/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The server keeps the login (services/publisher/bluesky-oauth.mjs); this browser only gets a short ticket
// for attaching the account, and nothing that can post.

import { APP_ORIGIN } from "@/lib/app-url";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { activeScope, type TeamScope } from "@/lib/workspaces";

/** The sign-in finishes for the same owner. */
const TEAM_KEY = "plan.video.bluesky-team";

/** Elsewhere, like a local dev server, it's app passwords. */
export function blueskySignInAvailable() {
  return window.location.origin === APP_ORIGIN;
}

async function call<T>(route: string, body: unknown): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to plan.video first."));
  const response = await fetch(`/api/publisher/bluesky/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const payload = (await response?.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response?.ok || !payload) throw new Error(payload?.error || t("Bluesky's sign-in isn't available right now. Try again in a moment."));
  return payload;
}

/** A handle picks the server; without one, it's Bluesky's. */
export async function beginBlueskySignIn(handle: string): Promise<void> {
  if (!blueskySignInAvailable()) throw new Error(t("Open {origin} to sign in with Bluesky.", { origin: APP_ORIGIN }));
  const team = activeScope();
  const { url } = await call<{ url: string }>("authorize", team ? { handle, team } : { handle });
  try {
    if (team) sessionStorage.setItem(TEAM_KEY, JSON.stringify(team));
    else sessionStorage.removeItem(TEAM_KEY);
  } catch {
    // Without it, the sign-in finishes for the person themselves, and attaching it asks them to sign in again.
  }
  window.location.assign(url);
}

export async function finishBlueskySignIn(params: URLSearchParams): Promise<{ did: string; ticket: string }> {
  if (!params.get("code")) throw new Error(t("Bluesky sent the sign-in back without a code. Try again."));
  let team: TeamScope | null = null;
  try {
    team = JSON.parse(sessionStorage.getItem(TEAM_KEY) ?? "null") as TeamScope | null;
    sessionStorage.removeItem(TEAM_KEY);
  } catch {
    team = null;
  }
  return call<{ did: string; ticket: string }>("callback", team ? { query: params.toString(), team } : { query: params.toString() });
}
