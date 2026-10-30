/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect } from "solid-js";
import { useLocation } from "@solidjs/router";
import { store } from "@/init";

const ROUTE_KEY = "last-route.v2";

// Query params that trigger one-shot UI (dialogs) and must not replay on relaunch.
const TRANSIENT_PARAMS = ["checkout"];

function sanitizeRoute(route: string): string | null {
  if (!route || route.startsWith("/auth/")) return null;

  const [path = "/", query = ""] = route.split("?");
  const params = new URLSearchParams(query);

  for (const param of TRANSIENT_PARAMS) {
    params.delete(param);
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Desktop loads a bare URL on every launch, losing the hash route. Call before the router mounts. */
export function restoreLastRoute() {
  if (window.location.hash) return;
  const saved = store.get<string>(ROUTE_KEY);
  if (saved) window.location.hash = saved;
}

/** Must live inside the router: HashRouter navigates via pushState, which fires no hashchange. Desktop only. */
export function PersistRoute() {
  const location = useLocation();

  createEffect(() => {
    if (!window.desktop) return;
    const route = sanitizeRoute(location.pathname + location.search);
    if (route) {
      store.set(ROUTE_KEY, route);
    }
  });

  return null;
}
