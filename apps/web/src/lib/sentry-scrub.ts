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

/** Analytics also need the campaign a visit came from. */
export function analyticsUrl(url: string): string {
  const query = new URLSearchParams(/\?([^#]*)/.exec(url)?.[1] ?? "");
  const campaign = new URLSearchParams([...query].filter(([name]) => name.startsWith("utm_"))).toString();
  return scrubUrl(url) + (campaign ? `?${campaign}` : "");
}

const ADDRESS_FIELD = /(url|referrer|pathname)$/i;

const scrubElementAddress = (element: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(element).map(([name, value]) => [name, typeof value === "string" && /href$/i.test(name) ? analyticsUrl(value) : value]));

/** Page events carry the address under several names, such as `$current_url` and `$initial_referrer`. */
export function scrubAddressFields<T extends Record<string, unknown>>(fields: T): T {
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => {
      if (name === "$elements_chain" && typeof value === "string") return [name, value.replace(/href="([^"]*)"/g, (_, address: string) => `href="${analyticsUrl(address)}"`)];
      if (name === "$elements" && Array.isArray(value)) return [name, value.map((element: Record<string, unknown>) => scrubElementAddress(element))];
      return [name, typeof value === "string" && ADDRESS_FIELD.test(name) ? analyticsUrl(value) : value];
    }),
  ) as T;
}

const scrubWords = (words: string) => words.replace(ADDRESS, scrubUrl);

/** What was logged can be anything, so it keeps only its addresses' safe parts, at any depth. */
function scrubLogged(value: unknown): unknown {
  if (typeof value === "string") return scrubWords(value);
  if (Array.isArray(value)) return value.map(scrubLogged);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubLogged(item)]));
  return value;
}

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
  if (crumb.data?.arguments) crumb.data.arguments = scrubLogged(crumb.data.arguments);
  return crumb;
}
