/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Navigate } from "@solidjs/router";

import { handOffConnection } from "@/lib/connect-return";

/** Where X sends its login back. Connections, or the connect link it was started from, finishes it, so this page goes straight there. */
export function XCallbackPage() {
  const href = handOffConnection("x", window.location.search);
  return <Navigate href={href} />;
}
