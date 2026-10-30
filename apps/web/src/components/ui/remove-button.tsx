/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";
import { cx } from "@/lib/cva";
import type { JSX } from "solid-js";

type RemoveButtonProps = {
  /** What is removed, for the accessible name. */
  label: string;
  class?: string;
  onClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
};

export function RemoveButton(props: RemoveButtonProps) {
  return (
    <button
      type="button"
      aria-label={props.label}
      class={cx(
        "press relative size-5 shrink-0 overflow-clip rounded-full border border-border bg-canvas text-foreground hover:border-border-input hover:bg-muted outline-none focus-ring",
        props.class,
      )}
      onClick={props.onClick}
    >
      {/* The mark is drawn on a 24px box, larger than the disc, so it is
          pinned to the centre rather than laid out — an overflowing flex or
          grid child falls back to the start edge instead of centring. */}
      <Icon
        name="close-remove-small"
        class="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2"
      />
    </button>
  );
}
