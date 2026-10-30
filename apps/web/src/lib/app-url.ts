/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The site's own address, where the networks' logins come back to and links
// people share point. It is VITE_APP_URL (apps/web/.env); a copy of plan.video
// hosted somewhere else sets that to its own address. Without it, it's
// plan.video's.

const PLAN_VIDEO = "https://plan.video";

const configured = (import.meta.env.VITE_APP_URL as string | undefined) || PLAN_VIDEO;

/** The site's origin, like `https://plan.video`: no path, no trailing slash. */
export const APP_ORIGIN = new URL(configured).origin;

/** The site's origin and its www twin, the addresses a network app saves callbacks for. */
export function appOrigins(): string[] {
  const url = new URL(APP_ORIGIN);
  if (url.hostname.startsWith("www.")) return [APP_ORIGIN];
  url.hostname = `www.${url.hostname}`;
  return [APP_ORIGIN, url.origin];
}

/**
 * Words that send someone to plan.video, made to send them to this site
 * instead. The words are written (and translated) with plan.video's address
 * in them, so the catalogs stay the same wherever the site is hosted.
 */
export function atThisSite(text: string): string {
  return APP_ORIGIN === PLAN_VIDEO ? text : text.replaceAll(PLAN_VIDEO, APP_ORIGIN);
}
