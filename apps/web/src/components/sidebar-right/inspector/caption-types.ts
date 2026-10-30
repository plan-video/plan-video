/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CAPTION_PRESETS } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { CaptionPreset as CaptionPresetName } from "@plan.video/jsx";
import type { CaptionType } from "@plan.video/runtime";

// In the order the preset's decoder reads `colors`; the runtime constants are the source of truth for `defaultColor`.
export type CaptionColorSlot = {
  label: string;
  defaultColor: number;
};

export type CaptionPresetOption = {
  name: CaptionPresetName;
  label: string;
  slots: CaptionColorSlot[];
};

/** In the style grid's order: the first six show before "All styles". */
export const CAPTION_PRESET_OPTIONS: CaptionPresetOption[] = [
  { name: "classic", label: msg("Classic"), slots: [] },
  {
    name: "spotlight",
    label: msg("Spotlight"),
    slots: [{ label: msg("Highlight"), defaultColor: 0x24D5FF }],
  },
  {
    name: "pop",
    label: msg("Pop"),
    slots: [{ label: msg("Fill"), defaultColor: 0xFFCC00 }],
  },
  { name: "box", label: msg("Box"), slots: [{ label: msg("Box"), defaultColor: 0xFFD60A }] },
  { name: "deep", label: msg("Deep"), slots: [{ label: msg("Highlight"), defaultColor: 0xFFFFFF }] },
  { name: "marker", label: msg("Highlighter"), slots: [{ label: msg("Highlighter"), defaultColor: 0x4ADE80 }] },
  { name: "rise", label: msg("Rise"), slots: [] },
  { name: "focus", label: msg("Focus"), slots: [] },
  { name: "cascade", label: msg("Cascade"), slots: [] },
  { name: "whisper", label: msg("Whisper"), slots: [] },
  { name: "paper", label: msg("Paper"), slots: [] },
  {
    name: "guinea",
    label: msg("Guinea"),
    slots: [
      { label: msg("Color 1"), defaultColor: 0xF55353 },
      { label: msg("Color 2"), defaultColor: 0xFEB139 },
      { label: msg("Color 3"), defaultColor: 0xF6F54D },
    ],
  },
  { name: "stark", label: msg("Stark"), slots: [] },
];

// The rest are older self-styled presets, still drawn for the captions that have them.
export const CAPTION_MOTIONS: CaptionPresetOption[] = CAPTION_PRESET_OPTIONS.slice(0, 8);

export const DEFAULT_CAPTION_PRESET: CaptionPresetOption = CAPTION_PRESET_OPTIONS[0]!;

const BY_TYPE = new Map<CaptionType, CaptionPresetOption>(
  CAPTION_PRESET_OPTIONS.map((option) => [CAPTION_PRESETS[option.name]!, option]),
);

// Identity matters: the select compares against the options it was given, so this returns the option itself, not a copy.
export function captionPresetOption(type: CaptionType | undefined): CaptionPresetOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_CAPTION_PRESET;
}
