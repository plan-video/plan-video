/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EASINGS } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { Easing } from "@plan.video/jsx";

// `EASINGS` is the one table mapping names to descriptors (linear is ''). The panel matches on the descriptor
// and writes `name` back, so the file reads `easing="easeOut"` rather than the bezier behind it.
export type EasingPreset = {
  name: Easing;
  label: string;
  descriptor: string;
};

const preset = (name: Easing, label: string): EasingPreset => ({
  name,
  label,
  descriptor: EASINGS[name] ?? name,
});

export const EASE_PRESETS: EasingPreset[] = [
  preset("linear", msg("Linear")),
  preset("easeIn", msg("Ease In")),
  preset("easeOut", msg("Ease Out")),
  preset("easeInOut", msg("Ease In & Out")),
];

export const SPRING_PRESETS: EasingPreset[] = [
  preset("gentle", msg("Gentle")),
  preset("snappy", msg("Snappy")),
  preset("bouncy", msg("Bouncy")),
  preset("strong", msg("Strong")),
];

export const DEFAULT_SPRING: EasingPreset = SPRING_PRESETS[0]!;

/** `<keyframe>`'s default: absent easing is linear. */
export const LINEAR: EasingPreset = EASE_PRESETS[0]!;

const BY_DESCRIPTOR = new Map<string, EasingPreset>(
  [...EASE_PRESETS, ...SPRING_PRESETS].map((option) => [option.descriptor, option]),
);

export function easingPreset(descriptor: string): EasingPreset | null {
  return BY_DESCRIPTOR.get(descriptor) ?? null;
}
