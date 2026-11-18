/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CLIP_INSET, LANE_OPACITY } from '@/engine/timeline';

/** The start of a row's band; the canvas draws the rest in the same colour (`renderLanes`), so the two read as one. */
export function Lane(props: { selected: boolean; hovered: boolean; nested: boolean }) {
  const opacity = () => {
    if (props.selected) return LANE_OPACITY.selected;
    if (props.hovered) return LANE_OPACITY.hovered;
    return props.nested ? LANE_OPACITY.nested : LANE_OPACITY.rest;
  };

  return (
    <div
      class="pointer-events-none absolute left-2 right-0 rounded-l-md bg-accent"
      style={{ top: `${CLIP_INSET}px`, bottom: `${CLIP_INSET}px`, opacity: opacity() }}
    />
  );
}
