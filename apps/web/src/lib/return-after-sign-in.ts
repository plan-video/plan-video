/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const KEY = 'plan.video.oauth-consent';
/** Long enough to find a sign-in email; a consent request expires on Supabase's side anyway. */
const KEEP_MS = 15 * 60 * 1000;

const canReturnTo = (path: string) =>
  path.startsWith('/oauth/consent?') || /^\/(docs|roadmap|changelog)(?=$|[/?#])/.test(path);

/** Anything not on the list is ignored. */
export function rememberReturn(path: string): void {
  if (!canReturnTo(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Signing in still works; it just lands on the dashboard.
  }
}

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

export const loginReturningTo = (path: string, page: '/login' | '/signup' = '/login') => `${page}?next=${encodeURIComponent(path)}`;
