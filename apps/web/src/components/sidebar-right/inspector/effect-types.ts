/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EFFECT_TYPES } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { EffectType as EffectName } from "@plan.video/jsx";
import type { EffectType } from "@plan.video/runtime";

// `blur` is px, `hueRotate` degrees, the rest a 0-1 amount. A value carries over a type switch only within a unit.
export type EffectUnit = "amount" | "px" | "deg";

export type EffectOption = {
  name: EffectName;
  label: string;
  unit: EffectUnit;
  value: number;
};

export const EFFECT_OPTIONS: EffectOption[] = [
  { name: "blur", label: msg("Layer Blur"), unit: "px", value: 8 },
  { name: "brightness", label: msg("Brightness"), unit: "amount", value: 0.8 },
  { name: "contrast", label: msg("Contrast"), unit: "amount", value: 0.8 },
  { name: "grayscale", label: msg("Grayscale"), unit: "amount", value: 0.5 },
  { name: "hueRotate", label: msg("Hue Rotation"), unit: "deg", value: 100 },
  { name: "invert", label: msg("Invert"), unit: "amount", value: 0.5 },
  { name: "saturate", label: msg("Saturate"), unit: "amount", value: 0.8 },
  { name: "sepia", label: msg("Sepia"), unit: "amount", value: 0.5 },
];

export const DEFAULT_EFFECT: EffectOption = EFFECT_OPTIONS[0]!;

const BY_TYPE = new Map<EffectType, EffectOption>(
  EFFECT_OPTIONS.map((option) => [EFFECT_TYPES[option.name]!, option]),
);

// Identity matters: the type select compares against the array it was given, so this returns the option itself, not a copy.
export function effectOption(type: EffectType | undefined): EffectOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_EFFECT;
}
