/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where to go once signed in, when it isn't the dashboard: the page someone
// left to sign in, kept across a sign-in that leaves the site (Google, an
// email link) and taken once. Only a few pages can be returned to: the
// connector's consent page, the docs, the roadmap and the changelog.

const KEY = 'plan.video.oauth-consent';
/** Long enough to find a sign-in email; a consent request expires on Supabase's side anyway. */
const KEEP_MS = 15 * 60 * 1000;

const canReturnTo = (path: string) =>
  path.startsWith('/oauth/consent?') || /^\/(docs|roadmap|changelog)(?=$|[/?#])/.test(path);

/** Keeps a page to come back to after signing in. Anything not on the list is ignored. */
export function rememberReturn(path: string): void {
  if (!canReturnTo(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Signing in still works; it just lands on the dashboard.
  }
}

/** The page to go back to after signing in, once; null when there is none. */
export function takeReturn(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { path?: unknown; at?: unknown } | null;
    localStorage.removeItem(KEY);
    if (typeof saved?.path !== 'string' || !canReturnTo(saved.path)) return null;
    if (typeof saved.at !== 'number' || Date.now() - saved.at > KEEP_MS) return null;
    return saved.path;
  } catch {
    return null;
  }
}

/** The login link for a page that should be come back to: `/login?next=…`. */
export const loginReturningTo = (path: string, page: '/login' | '/signup' = '/login') => `${page}?next=${encodeURIComponent(path)}`;
