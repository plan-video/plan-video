/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where the toolbar goes in each of its slots (see `useLayout().toolbarSlot`),
// and where the bars over the canvas go with it, a step in from its edge.

import type { ToolbarSlot } from "@/context/layout";

export const TOOLBAR_SLOT_CLASS: Record<ToolbarSlot, string> = {
  "bottom": "bottom-4 left-1/2 -translate-x-1/2",
  "top": "top-4 left-1/2 -translate-x-1/2",
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
};

/** Where a bar goes beside the toolbar in each slot: on its inner side, toward the middle of the canvas. */
export const BAR_SLOT_CLASS: Record<ToolbarSlot, string> = {
  "bottom": "bottom-16 left-1/2 -translate-x-1/2",
  "top": "top-16 left-1/2 -translate-x-1/2",
  "top-left": "top-16 left-4",
  "top-right": "top-16 right-4",
  "bottom-left": "bottom-16 left-4",
  "bottom-right": "bottom-16 right-4",
};

/** Where each slot is on the canvas, as fractions of its width and height: a drag drops the toolbar in the slot nearest the pointer. */
export const TOOLBAR_SLOT_ANCHOR: Record<ToolbarSlot, { x: number; y: number }> = {
  "bottom": { x: 0.5, y: 1 },
  "top": { x: 0.5, y: 0 },
  "top-left": { x: 0, y: 0 },
  "top-right": { x: 1, y: 0 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

export const isTopSlot = (slot: ToolbarSlot) => slot.startsWith("top");
