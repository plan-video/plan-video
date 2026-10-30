/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BlendModeType } from "@plan.video/runtime";
import { BLEND_MODES } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { BlendMode } from "@plan.video/jsx";

// Ordered to match Figma's blend mode menu groupings.
export const BLEND_MODE_ORDER: BlendModeType[] = [
  BlendModeType.SOURCE_OVER,
  BlendModeType.DARKEN,
  BlendModeType.MULTIPLY,
  BlendModeType.COLOR_BURN,
  BlendModeType.LIGHTEN,
  BlendModeType.SCREEN,
  BlendModeType.COLOR_DODGE,
  BlendModeType.OVERLAY,
  BlendModeType.SOFT_LIGHT,
  BlendModeType.HARD_LIGHT,
  BlendModeType.DIFFERENCE,
  BlendModeType.EXCLUSION,
  BlendModeType.HUE,
  BlendModeType.SATURATION,
  BlendModeType.COLOR,
  BlendModeType.LUMINOSITY,
];

// Modes that begin a new group (separator goes before them).
export const BLEND_MODE_SEPARATORS = new Set<BlendModeType>([
  BlendModeType.DARKEN,
  BlendModeType.LIGHTEN,
  BlendModeType.OVERLAY,
  BlendModeType.DIFFERENCE,
  BlendModeType.HUE,
]);

const NAMES = new Map<BlendModeType, BlendMode>(
  Object.entries(BLEND_MODES).map(([name, mode]) => [mode, name as BlendMode]),
);

export function blendModeName(mode: BlendModeType): BlendMode {
  return NAMES.get(mode) ?? "sourceOver";
}

const LABELS: Record<BlendModeType, string> = {
  [BlendModeType.SOURCE_OVER]: msg("Normal"),
  [BlendModeType.MULTIPLY]: msg("Multiply"),
  [BlendModeType.SCREEN]: msg("Screen"),
  [BlendModeType.OVERLAY]: msg("Overlay"),
  [BlendModeType.DARKEN]: msg("Darken"),
  [BlendModeType.LIGHTEN]: msg("Lighten"),
  [BlendModeType.COLOR_DODGE]: msg("Color dodge"),
  [BlendModeType.COLOR_BURN]: msg("Color burn"),
  [BlendModeType.HARD_LIGHT]: msg("Hard light"),
  [BlendModeType.SOFT_LIGHT]: msg("Soft light"),
  [BlendModeType.DIFFERENCE]: msg("Difference"),
  [BlendModeType.EXCLUSION]: msg("Exclusion"),
  [BlendModeType.HUE]: msg("Hue"),
  [BlendModeType.SATURATION]: msg("Saturation"),
  [BlendModeType.COLOR]: msg("Color"),
  [BlendModeType.LUMINOSITY]: msg("Luminosity"),
};

/** In English; show it with t(). */
export function displayBlendMode(mode: BlendModeType): string {
  return LABELS[mode];
}
