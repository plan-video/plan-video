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
  // Subtle's styles: each brings its own face, colours and motion.
  { name: "accent", label: msg({ message: "Accent", context: "caption style" }), slots: [] },
  { name: "block", label: msg({ message: "Block", context: "caption style" }), slots: [] },
  { name: "bottom", label: msg({ message: "Big caps", context: "caption style" }), slots: [] },
  { name: "cards", label: msg({ message: "Cards", context: "caption style" }), slots: [] },
  { name: "chip", label: msg({ message: "Chip", context: "caption style" }), slots: [] },
  { name: "cinema", label: msg({ message: "Arthouse", context: "caption style" }), slots: [] },
  { name: "duo", label: msg({ message: "Duo", context: "caption style" }), slots: [] },
  { name: "editorial", label: msg({ message: "Editorial", context: "caption style" }), slots: [] },
  { name: "flip", label: msg({ message: "Flap", context: "caption style" }), slots: [] },
  { name: "glass", label: msg({ message: "Glass", context: "caption style" }), slots: [] },
  { name: "glide", label: msg({ message: "Glide", context: "caption style" }), slots: [] },
  { name: "haiku", label: msg({ message: "Haiku", context: "caption style" }), slots: [] },
  { name: "hop", label: msg({ message: "Hop", context: "caption style" }), slots: [] },
  { name: "hype", label: msg({ message: "Hype", context: "caption style" }), slots: [] },
  { name: "impact", label: msg({ message: "Impact", context: "caption style" }), slots: [] },
  { name: "karaoke", label: msg({ message: "Karaoke", context: "caption style" }), slots: [] },
  { name: "magazine", label: msg({ message: "Magazine", context: "caption style" }), slots: [] },
  { name: "newsroom", label: msg({ message: "Newsroom", context: "caption style" }), slots: [] },
  { name: "punch", label: msg({ message: "Swell", context: "caption style" }), slots: [] },
  { name: "quiet", label: msg({ message: "Quiet", context: "caption style" }), slots: [] },
  { name: "serif", label: msg({ message: "Serif", context: "caption style" }), slots: [] },
  { name: "shine", label: msg({ message: "Gleam", context: "caption style" }), slots: [] },
  { name: "stack", label: msg({ message: "Stack", context: "caption style" }), slots: [] },
  { name: "sticker", label: msg({ message: "Bubbles", context: "caption style" }), slots: [] },
  { name: "terminal", label: msg({ message: "Terminal", context: "caption style" }), slots: [] },
  { name: "ticket", label: msg({ message: "Ticket", context: "caption style" }), slots: [] },
  { name: "title", label: msg({ message: "Title", context: "caption style" }), slots: [] },
  { name: "wipe", label: msg({ message: "Wipe", context: "caption style" }), slots: [] },
];

// The rest are older self-styled presets, still drawn for the captions that have them, and Subtle's styles.
export const CAPTION_MOTIONS: CaptionPresetOption[] = CAPTION_PRESET_OPTIONS.slice(0, 8);

export const DEFAULT_CAPTION_PRESET: CaptionPresetOption = CAPTION_PRESET_OPTIONS[0]!;

const BY_TYPE = new Map<CaptionType, CaptionPresetOption>(
  CAPTION_PRESET_OPTIONS.map((option) => [CAPTION_PRESETS[option.name]!, option]),
);

// Identity matters: the select compares against the options it was given, so this returns the option itself, not a copy.
export function captionPresetOption(type: CaptionType | undefined): CaptionPresetOption {
  return (type === undefined ? undefined : BY_TYPE.get(type)) ?? DEFAULT_CAPTION_PRESET;
}
