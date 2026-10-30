/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CAPTION_PRESETS } from "@plan.video/reconciler";

import { msg } from "@/lib/i18n";

import type { CaptionPreset as CaptionPresetName } from "@plan.video/jsx";
import type { CaptionType } from "@plan.video/runtime";

/**
 * A color the preset paints with and lets the file override, in the order its
 * decoder reads `colors`. `defaultColor` is what that decoder falls back to,
 * so it is what the row shows for a slot the file has not filled; the runtime
 * constants are the source of truth for those values.
 */
export type CaptionColorSlot = {
  label: string;
  defaultColor: number;
};

export type CaptionPresetOption = {
  name: CaptionPresetName;
  label: string;
  slots: CaptionColorSlot[];
};

/**
 * The presets, in the order the style grid shows them: the six it opens on
 * first, the rest under "All styles".
 */
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

/**
 * The presets a caption's Motion offers: what each does with the words as
 * they are said, worn under a look. The rest are looks of their own from
 * before looks, still drawn for the captions that have them.
 */
export const CAPTION_MOTIONS: CaptionPresetOption[] = CAPTION_PRESET_OPTIONS.slice(0, 8);

/** The preset a caption with no `preset` of its own plays. */
export const DEFAULT_CAPTION_PRESET: CaptionPresetOption = CAPTION_PRESET_OPTIONS[0]!;

const BY_TYPE = new Map<CaptionType, CaptionPresetOption>(
  CAPTION_PRESET_OPTIONS.map((option) => [CAPTION_PRESETS[option.name]!, option]),
);

/**
 * The option for the type a `Caption` trait holds. Identity matters: the
 * select compares its value against the options it was given, so this hands
 * back the option itself rather than a copy.
 */
export function captionPresetOption(type: CaptionType | undefined): CaptionPresetOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_CAPTION_PRESET;
}
