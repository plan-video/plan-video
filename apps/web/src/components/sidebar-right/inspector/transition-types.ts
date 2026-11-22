/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { TRANSITION_TYPES } from "@plan.video/reconciler";

import { TRANSITION_SECONDS } from "@/engine/transitions";
import { msg } from "@/lib/i18n";

import type { TransitionType as TransitionName } from "@plan.video/jsx";
import type { TransitionType } from "@plan.video/runtime";

export type TransitionOption = {
  name: TransitionName;
  label: string;
};

export type TransitionGroup = { label: string; options: TransitionOption[] };

/** Each group fills whole rows of the two-column panel. */
export const TRANSITION_GROUPS: TransitionGroup[] = [
  {
    label: msg("Basic"),
    options: [
      { name: "dissolve", label: msg("Dissolve") },
      { name: "fadeToBlack", label: msg("Fade to black") },
      { name: "fadeToWhite", label: msg("Fade to white") },
      { name: "blur", label: msg("Blur") },
    ],
  },
  {
    label: msg("Movement"),
    options: [
      { name: "slideFromRight", label: msg("Slide from right") },
      { name: "pushLeft", label: msg("Push") },
      { name: "whip", label: msg("Whip") },
      { name: "split", label: msg("Split open") },
    ],
  },
  {
    label: msg("Zoom"),
    options: [
      { name: "zoomIn", label: msg("Zoom in") },
      { name: "zoomOut", label: msg("Zoom out") },
      { name: "crossZoom", label: msg("Cross zoom") },
      { name: "impact", label: msg("Impact") },
    ],
  },
  {
    label: msg("Stylized"),
    options: [
      { name: "flash", label: msg("Flash") },
      { name: "lightLeak", label: msg("Light leak") },
      { name: "bloom", label: msg("Exposure") },
      { name: "glitch", label: msg("Glitch") },
    ],
  },
];

export const TRANSITION_OPTIONS: TransitionOption[] = TRANSITION_GROUPS.flatMap((group) => group.options);

// Still played by the runtime but no longer offered, so a clip that has one keeps its name in the inspector.
const RETIRED_OPTIONS: TransitionOption[] = [
  { name: "slideFromLeft", label: msg("Slide from left") },
  { name: "pushUp", label: msg("Push up") },
  { name: "spin", label: msg("Spin") },
  { name: "wipe", label: msg("Wipe") },
  { name: "stripes", label: msg("Stripes") },
  { name: "clock", label: msg("Clock wipe") },
  { name: "iris", label: msg("Circle") },
];

/** What the panel's plus authors: a dissolve as long as the Transitions panel puts on. */
export const DEFAULT_TRANSITION: TransitionOption = TRANSITION_OPTIONS[0]!;
export const DEFAULT_TRANSITION_DURATION = TRANSITION_SECONDS;

const BY_TYPE = new Map<TransitionType, TransitionOption>(
  [...TRANSITION_OPTIONS, ...RETIRED_OPTIONS].map((option) => [TRANSITION_TYPES[option.name]!, option]),
);

// Identity matters: the type select compares against the array it was given, so this returns the option itself, not a copy.
export function transitionOption(type: TransitionType | undefined): TransitionOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_TRANSITION;
}
