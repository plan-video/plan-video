/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** It's joined into an address unescaped by the Supabase client, so anything else could point that request elsewhere. */
export function authorizationIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("authorization_id");
  return id && /^[A-Za-z0-9_-]{1,200}$/.test(id) ? id : null;
}
