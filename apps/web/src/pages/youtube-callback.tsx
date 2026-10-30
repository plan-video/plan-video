/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Navigate } from "@solidjs/router";

import { handOffConnection } from "@/lib/connect-return";

export function YouTubeCallbackPage() {
  const href = handOffConnection("youtube", window.location.search);
  return <Navigate href={href} />;
}
