/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defineConfig } from "cva"
import { extendTailwindMerge } from "tailwind-merge"

// Without this, `text-xxs` reads as a color and a later `text-foreground` drops the size.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["xxs"] },
  },
});

export const { cva, cx, compose } = defineConfig({
  hooks: {
    onComplete: (className) => twMerge(className),
  },
});
