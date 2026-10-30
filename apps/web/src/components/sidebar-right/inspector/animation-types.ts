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

/**
 * Which nodes a group is offered on: a text animation needs glyphs to move,
 * a gain needs something to hear. A group without a kind fits every node.
 */
export type AnimationGroupKind = "text" | "audio";

export type AnimationGroup = {
  label: string;
  kind?: AnimationGroupKind;
  options: AnimationOption[];
};

/** The presets, grouped as the type select shows them. */
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

/** How long a TikTok-style pop or bounce is on screen. */
export const POP_MOTION_DURATION = 0.2;

/** One-click in-presets offered on text and caption words. */
export const TEXT_MOTION_PRESETS: readonly (AnimationOption & { duration: number })[] = [
  { name: "pop", label: msg("Pop"), duration: POP_MOTION_DURATION },
  { name: "bounce", label: msg("Bounce"), duration: POP_MOTION_DURATION },
];

const ALL_OPTIONS = ANIMATION_GROUPS.flatMap((group) => group.options);

/** What the panel's plus authors: a fade, the one preset every node can play. */
export const DEFAULT_ANIMATION: AnimationOption = ALL_OPTIONS[0]!;

const BY_TYPE = new Map<AnimationType, AnimationOption>(
  ALL_OPTIONS.map((option) => [ANIMATION_TYPES[option.name]!, option]),
);

/**
 * The option for the type an `Animation` trait holds. Identity matters: the
 * type select compares its value against the groups it was given, so this
 * hands back the option itself rather than a copy.
 */
export function animationOption(type: AnimationType | undefined): AnimationOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_ANIMATION;
}
