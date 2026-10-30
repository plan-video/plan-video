/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ANIMATION_TYPES } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { AnimationType as AnimationName } from "@plan.video/jsx";
import type { AnimationType } from "@plan.video/runtime";

export type AnimationOption = {
  name: AnimationName;
  label: string;
};

/** A group without a kind fits every node. */
export type AnimationGroupKind = "text" | "audio";

export type AnimationGroup = {
  label: string;
  kind?: AnimationGroupKind;
  options: AnimationOption[];
};

export const ANIMATION_GROUPS: AnimationGroup[] = [
  {
    label: msg("Fade"),
    options: [
      { name: "fade", label: msg("Fade") },
      { name: "slideLeft", label: msg("Slide left") },
      { name: "slideRight", label: msg("Slide right") },
      { name: "slideUp", label: msg("Slide up") },
      { name: "slideDown", label: msg("Slide down") },
    ],
  },
  {
    label: msg("Scale"),
    options: [
      { name: "grow", label: msg("Grow") },
      { name: "shrink", label: msg("Shrink") },
      { name: "pop", label: msg("Pop") },
      { name: "bounce", label: msg("Bounce") },
      { name: "spin", label: msg("Spin") },
      { name: "twist", label: msg("Twist") },
    ],
  },
  {
    label: msg("Blur"),
    options: [{ name: "blur", label: msg("Blur") }],
  },
  {
    label: msg("Text"),
    kind: "text",
    options: [
      { name: "appearWord", label: msg("Appear word") },
      { name: "appearChar", label: msg("Appear character") },
      { name: "scramble", label: msg("Scramble") },
    ],
  },
  {
    label: msg("Audio"),
    kind: "audio",
    options: [{ name: "gain", label: msg("Volume") }],
  },
];

export const POP_MOTION_DURATION = 0.2;

export const TEXT_MOTION_PRESETS: readonly (AnimationOption & { duration: number })[] = [
  { name: "pop", label: msg("Pop"), duration: POP_MOTION_DURATION },
  { name: "bounce", label: msg("Bounce"), duration: POP_MOTION_DURATION },
];

const ALL_OPTIONS = ANIMATION_GROUPS.flatMap((group) => group.options);

/** A fade: the one preset every node can play. */
export const DEFAULT_ANIMATION: AnimationOption = ALL_OPTIONS[0]!;

const BY_TYPE = new Map<AnimationType, AnimationOption>(
  ALL_OPTIONS.map((option) => [ANIMATION_TYPES[option.name]!, option]),
);

// Identity matters: the type select compares against the groups it was given, so this returns the option itself, not a copy.
export function animationOption(type: AnimationType | undefined): AnimationOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_ANIMATION;
}
