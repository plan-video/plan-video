/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { CaptionPreset, TextLookName } from "@plan.video/jsx";

/** A look worn over a motion, as `<Captions look preset colors>`; `colors` fills the motion's slots. */
export type CaptionTemplate = {
  look: TextLookName;
  preset: CaptionPreset;
  colors?: string[];
};

/** In the Captions tab's order, two to a row. Each look + motion pair appears once, which is how a caption finds its tile. */
export const CAPTION_TEMPLATES: CaptionTemplate[] = [
  { look: "commentary", preset: "classic" },
  { look: "commentary", preset: "spotlight", colors: ["#FFE14D"] },
  { look: "plain", preset: "box", colors: ["#000000"] },
  { look: "hook", preset: "pop" },
  { look: "commentary", preset: "deep" },
  { look: "commentary", preset: "box", colors: ["#FF2D87"] },
  { look: "cinema", preset: "box", colors: ["#7C3AED"] },
  { look: "punch", preset: "rise" },
  { look: "commentary", preset: "marker", colors: ["#D946EF"] },
  { look: "yellow", preset: "pop" },
  { look: "neon", preset: "focus" },
  { look: "comic", preset: "classic" },
  { look: "sticker", preset: "rise" },
  { look: "gold", preset: "deep" },
  { look: "handwritten", preset: "focus" },
  { look: "bubblegum", preset: "rise" },
];

export function captionTemplateOf(look: string | undefined, preset: string): CaptionTemplate | null {
  return CAPTION_TEMPLATES.find((template) => template.look === look && template.preset === preset) ?? null;
}
