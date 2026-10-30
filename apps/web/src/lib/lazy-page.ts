/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { lazy, type Component } from "solid-js";

/**
 * After a deploy a tab can ask for a file that's gone: app.tsx's preloadError handler reloads and the import
 * resolves to nothing, so wait for the reload instead of throwing into the error page.
 */
export function page<M, C extends Component<any>>(load: () => Promise<M>, pick: (module: M) => C) {
  return lazy(() => load().then((module) => (module ? { default: pick(module) } : new Promise<never>(() => {}))));
}
