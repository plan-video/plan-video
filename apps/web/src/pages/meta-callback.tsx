/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Navigate } from "@solidjs/router";

import { handOffConnection } from "@/lib/connect-return";
import type { MetaNetwork } from "@/lib/meta";

/** Where Instagram, Facebook and Threads send their login back. Connections, or the connect link it was started from, finishes it, so this page goes straight there. */
function MetaCallback(props: { network: MetaNetwork }) {
  const href = handOffConnection(props.network, window.location.search);
  return <Navigate href={href} />;
}

export const InstagramCallbackPage = () => <MetaCallback network="instagram" />;
export const FacebookCallbackPage = () => <MetaCallback network="facebook" />;
export const ThreadsCallbackPage = () => <MetaCallback network="threads" />;
