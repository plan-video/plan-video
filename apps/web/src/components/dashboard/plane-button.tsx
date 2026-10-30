/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { splitProps, type JSX } from "solid-js";
import type { VariantProps } from "cva";

import { capCentered } from "@/components/ui/cap-label";
import { cva } from "@/lib/cva";

// Plane's button (packages/propel/src/button/helper.tsx), on the dashboard's
// --plane-* tokens.
export const planeButton = cva({
  base: "inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap outline-none press focus-ring disabled:pointer-events-none",
  variants: {
    variant: {
      primary:
        "border border-black/15 bg-(--plane-accent-primary) text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(0_0_0/0.25)] hover:bg-(--plane-accent-primary-hover) active:bg-(--plane-accent-primary-active) active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.2)] disabled:border-transparent disabled:bg-(--plane-layer-3) disabled:text-(--plane-text-disabled) disabled:shadow-none",
      secondary:
        "border border-(--plane-border-strong) bg-(--plane-layer-2) text-(--plane-text-primary) shadow-(--plane-shadow-raised-100) hover:bg-(--plane-layer-2-hover) active:bg-(--plane-layer-2-active) disabled:text-(--plane-text-disabled)",
      tertiary:
        "bg-(--plane-layer-3) text-(--plane-text-secondary) hover:bg-(--plane-layer-3-hover) disabled:text-(--plane-text-disabled)",
      ghost:
        "bg-transparent text-(--plane-text-secondary) hover:bg-(--plane-layer-transparent-hover) hover:text-(--plane-text-primary) active:bg-(--plane-layer-transparent-active) data-[expanded]:bg-(--plane-layer-transparent-active) disabled:text-(--plane-text-disabled)",
    },
    size: {
      sm: "h-5 rounded-md px-1.5 text-xs leading-[1.1] font-medium",
      base: "h-6 rounded-md px-2 text-sm leading-[1.4] font-medium",
      lg: "h-7 rounded-md px-2 text-sm leading-[1.4] font-medium",
      xl: "h-8 rounded-md px-2 text-sm leading-[1.4] font-medium",
    },
  },
  defaultVariants: { variant: "primary", size: "base" },
});

type PlaneButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof planeButton>;

export function PlaneButton(props: PlaneButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "children"]);
  const label = capCentered(() => local.children);
  return (
    <button type="button" class={planeButton({ variant: local.variant, size: local.size, class: local.class })} {...rest}>
      {label()}
    </button>
  );
}
