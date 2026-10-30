/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { TransitionType as TransitionName } from "@plan.video/jsx";

import "./transition-preview.css";

/** Seconds into each 2.4s loop (transition-preview.css) where the still shows the transition. */
const STILLS: Partial<Record<TransitionName, number>> = {
  fadeToBlack: 0.85,
  blur: 1.0,
  zoomIn: 1.25,
  whip: 1.05,
};

export function TransitionPreview(props: { type: TransitionName }) {
  return (
    <div class="tp" data-type={props.type} style={{ "--still": `-${STILLS[props.type] ?? 1.05}s` }}>
      <div class="tp-a" />
      <div class="tp-b" />
    </div>
  );
}
