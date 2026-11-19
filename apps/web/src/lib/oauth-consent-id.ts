/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** It's joined into an address unescaped by the Supabase client, so anything else could point that request elsewhere. */
export function authorizationIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("authorization_id");
  return id && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}

/** Schemes that pass the address on to a browser, a mail or message app, or another computer, so the answer can reach a website. */
const PASSED_ON = /^(intent|ftps?|wss?|file|data|javascript|blob|mailto|sms|tel|.*(https?|chrome|firefox|safari|edge|opera|brave|browser|url).*):$/i;

/** Only an app on this computer can receive an answer sent here. */
export function onThisComputer(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return !PASSED_ON.test(url.protocol);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
