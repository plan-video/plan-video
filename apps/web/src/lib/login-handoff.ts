/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What a network login needs back when it returns: its state and PKCE
// verifier. Kept for every tab of this site, since a network's own sign-in can
// come back in a new tab, and only for a few minutes.

const KEEP_MS = 15 * 60_000;

export function keepForLogin(key: string, value: string) {
  localStorage.setItem(key, JSON.stringify({ value, until: Date.now() + KEEP_MS }));
}

/** The value kept under `key`, once. Null when there's none or it is too old. */
export function takeFromLogin(key: string): string | null {
  const raw = localStorage.getItem(key);
  localStorage.removeItem(key);
  if (!raw) return null;
  try {
    const kept = JSON.parse(raw) as { value?: unknown; until?: unknown };
    return typeof kept.value === "string" && typeof kept.until === "number" && kept.until > Date.now() ? kept.value : null;
  } catch {
    return null;
  }
}
