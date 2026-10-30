/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Declarations only: a mount substitutes host-bound implementations (see @plan.video/reconciler),
// and calling these outside a mount throws rather than returning a dead value.

import type { Accessor } from "solid-js";

export type Ticker = {
  time: Accessor<number>;
  frame: Accessor<number>;
  delta: Accessor<number>;
  playing: Accessor<boolean>;
  hold: (work: Promise<unknown>) => void;
};

function hostOnly(name: string): never {
  throw new Error(
    `${name} is implemented by the editor's renderer and only works inside a mounted project.`,
  );
}

/**
 * The playhead of the mount's scene, pushed once per playback tick; each accessor only propagates
 * when its value changes. Export and capture sample frames as soon as the module renders, so hand
 * your own async work (a mesh, a texture, a fetch) to `hold` to keep those frames waiting for it.
 */
export function useTicker(): Ticker {
  return hostOnly("useTicker");
}

/**
 * Device pixels per composition pixel, camera zoom excluded: what a `<surface>` sizes its bitmap by.
 * Reactive: an offline mount starts at `1` and learns the real factor before the first frame, so
 * read it inside the effect that sizes and draws rather than once at mount.
 */
export function useResolution(): Accessor<number> {
  return hostOnly("useResolution");
}
