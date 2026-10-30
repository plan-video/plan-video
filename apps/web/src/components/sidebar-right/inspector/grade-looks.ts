/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg } from "@/lib/i18n";

import type { GradeLook } from "@plan.video/jsx";
import type { GradeSlider } from "@plan.video/runtime";

/** The looks, in the picker's order: the runtime's GRADE_LOOKS by name. */
export const LOOK_OPTIONS: { id: GradeLook; label: string }[] = [
  { id: "warm", label: msg("Warm") },
  { id: "cool", label: msg("Cool") },
  { id: "fresh", label: msg("Fresh") },
  { id: "golden", label: msg("Golden") },
  { id: "tealOrange", label: msg("Teal & orange") },
  { id: "vivid", label: msg("Vivid") },
  { id: "film", label: msg("Film") },
  { id: "faded", label: msg("Faded") },
  { id: "moody", label: msg("Moody") },
  { id: "mono", label: msg("Black & white") },
  { id: "noir", label: msg("Noir") },
];

export function lookLabel(id: string): string | undefined {
  return LOOK_OPTIONS.find((option) => option.id === id)?.label;
}

/** The sliders, in two groups as the Adjust tab lists them. */
export const SLIDER_GROUPS: { title: string; sliders: { key: GradeSlider; label: string }[] }[] = [
  {
    title: msg("Tone"),
    sliders: [
      { key: "exposure", label: msg("Exposure") },
      { key: "contrast", label: msg("Contrast") },
      { key: "highlights", label: msg("Highlights") },
      { key: "shadows", label: msg("Shadows") },
      { key: "whites", label: msg("Whites") },
      { key: "blacks", label: msg("Blacks") },
    ],
  },
  {
    title: msg("Color"),
    sliders: [
      { key: "temperature", label: msg("Temperature") },
      { key: "tint", label: msg("Tint") },
      { key: "saturation", label: msg("Saturation") },
    ],
  },
];

/** The wheels, darkest first. */
export const WHEEL_OPTIONS = [
  { wheel: "lift", label: msg("Shadows") },
  { wheel: "gamma", label: msg("Midtones") },
  { wheel: "gain", label: msg("Highlights") },
] as const;
