/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// An emailed sign-in link opens the account it was sent for, in any browser
// that opens it. So someone could send you the link to their own account and
// have you work in it unawares, connecting your channels to it. The confirm
// page only signs in straight away when this browser asked for that email's
// link and nobody else is signed in here; otherwise it shows whose account the
// link opens and asks first. This keeps which emails this browser asked for.

const KEY = 'plan.video.sign-in-links';
/** Supabase's links last an hour (otp_expiry in supabase/config.toml). */
const KEEP_MS = 60 * 60 * 1000;

type Asked = { email: string; at: number };

const same = (email: string) => email.trim().toLowerCase();

function read(): Asked[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(saved)) return [];
    return saved.filter((item): item is Asked => typeof item?.email === 'string' && typeof item?.at === 'number' && Date.now() - item.at < KEEP_MS);
  } catch {
    return [];
  }
}

function write(list: Asked[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list.slice(-5)));
    else localStorage.removeItem(KEY);
  } catch {
    // The link still works; it just asks first.
  }
}

/** Notes that this browser just asked for a sign-in link for `email`. */
export function rememberLinkAsked(email: string): void {
  write([...read().filter((item) => same(item.email) !== same(email)), { email: same(email), at: Date.now() }]);
}

/** Whether this browser asked for a link for `email` within the hour; true once, as the link is. */
export function takeLinkAsked(email: string): boolean {
  const list = read();
  const asked = list.some((item) => same(item.email) === same(email));
  write(list.filter((item) => same(item.email) !== same(email)));
  return asked;
}
