/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX } from 'solid-js';

/** Over the tracks, for rows the canvas has no clip to name. Clicks go through; the margin clears a keyframe at frame 0. */
export function RowLabel(props: { children: JSX.Element }) {
  return (
    <span class="pointer-events-none absolute left-full top-1/2 z-20 ml-5 -translate-y-1/2 whitespace-nowrap rounded-sm bg-background/80 px-1 text-xxs text-muted-foreground">
      {props.children}
    </span>
  );
}
