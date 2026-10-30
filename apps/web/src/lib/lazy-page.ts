/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { lazy, type Component } from "solid-js";

/**
 * A page or dialog whose code loads when it's first shown. After a deploy an
 * open tab can ask for a file that is gone: the preloadError handler in app.tsx
 * then reloads the page and the import resolves to nothing, so wait for the
 * reload instead of throwing into the error page.
 */
export function page<M, C extends Component<any>>(load: () => Promise<M>, pick: (module: M) => C) {
  return lazy(() => load().then((module) => (module ? { default: pick(module) } : new Promise<never>(() => {}))));
}
