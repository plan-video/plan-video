/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sentry records the page's address on every event, and each address visited or fetched as a breadcrumb. Those hold
// sign-in codes and tokens (`?code=`, `#access_token=`), signed file links, and the links that open /connect and /p.

const LINK_IN_PATH = /\/(connect|p)\/[^/]+/;
const ADDRESS = /https?:\/\/[^\s"'<>]+/g;

export function scrubUrl(url: string): string {
  return url.replace(/[?#].*$/s, "").replace(/^((?:[a-z]+:\/\/[^/]+)?)(.*)$/s, (_, origin: string, path: string) => origin + path.replace(LINK_IN_PATH, "/$1/[id]"));
}

const scrubWords = (words: string) => words.replace(ADDRESS, scrubUrl);

type Frame = { filename?: string };
type Scrubbable = {
  request?: { url?: string; query_string?: unknown; headers?: Record<string, string> };
  exception?: { values?: { value?: string; stacktrace?: { frames?: Frame[] } }[] };
  message?: string;
};

export function scrubEvent<T extends Scrubbable>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.query_string;
    if (event.request.headers?.Referer) event.request.headers.Referer = scrubUrl(event.request.headers.Referer);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubWords(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) if (frame.filename) frame.filename = scrubUrl(frame.filename);
  }
  if (event.message) event.message = scrubWords(event.message);
  return event;
}

export function scrubBreadcrumb<T extends { message?: string; data?: Record<string, unknown> }>(crumb: T): T {
  if (crumb.message) crumb.message = scrubWords(crumb.message);
  for (const key of ["url", "from", "to"]) {
    const value = crumb.data?.[key];
    if (typeof value === "string") crumb.data![key] = scrubUrl(value);
  }
  return crumb;
}
