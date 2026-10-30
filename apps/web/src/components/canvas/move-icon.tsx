/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cx } from "@/lib/cva";

// The Move tool's pointer, filled and drawn on a 16px grid. Lucide's outlined
// mouse-pointer-2 smeared its diagonal 2px lines into grey steps at 1x.
export function MoveIcon(props: { class?: string }) {
  return (
    <svg viewBox="0 0 16 16" class={cx("size-4 shrink-0", props.class)} aria-hidden="true">
      <path
        d="M2.8 2.3 13.8 6.8 8.9 8.9 6.8 13.8Z"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  );
}
