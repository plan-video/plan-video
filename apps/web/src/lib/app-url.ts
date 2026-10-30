/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// VITE_APP_URL (apps/web/.env) lets a copy hosted elsewhere use its own address.

const PLAN_VIDEO = "https://plan.video";

const configured = (import.meta.env.VITE_APP_URL as string | undefined) || PLAN_VIDEO;

/** No path, no trailing slash. */
export const APP_ORIGIN = new URL(configured).origin;

/** With its www twin: the addresses a network app saves callbacks for. */
export function appOrigins(): string[] {
  const url = new URL(APP_ORIGIN);
  if (url.hostname.startsWith("www.")) return [APP_ORIGIN];
  url.hostname = `www.${url.hostname}`;
  return [APP_ORIGIN, url.origin];
}

/** Catalog words name plan.video's address, so the catalogs stay the same wherever the site is hosted. */
export function atThisSite(text: string): string {
  return APP_ORIGIN === PLAN_VIDEO ? text : text.replaceAll(PLAN_VIDEO, APP_ORIGIN);
}
