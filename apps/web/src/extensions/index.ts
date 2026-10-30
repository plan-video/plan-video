/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Extensions are tools that live in the left sidebar's Extensions tab: the
// market lists them, and opening one swaps the market for its panel until
// you go back.

import type { Component } from "solid-js";

import { msg } from "@/lib/i18n";
import { CodKillfeedCover, CodKillfeedPanel, PubgKillfeedCover, PubgKillfeedPanel, RustKillfeedCover, RustKillfeedPanel } from "@/components/sidebar-left/bar-killfeed-panel";
import { Cs2KillfeedCover, Cs2KillfeedPanel } from "@/components/sidebar-left/cs2-killfeed-panel";
import { CutoutCover, CutoutPanel } from "@/components/sidebar-left/cutout-panel";
import { KillfeedCover, KillfeedPanel } from "@/components/sidebar-left/killfeed-panel";
import { ProgressBarCover, ProgressBarPanel } from "@/components/sidebar-left/progress-bar-panel";

import { CUTOUT_EXTENSION, openExtensionId } from "./state";

export { CUTOUT_EXTENSION, setOpenExtension } from "./state";

export type Extension = {
  id: string;
  name: string;
  /** The game it is made for, shown as a tag. The market filters by it. */
  tag?: string;
  summary: string;
  author: string;
  /** The picture on its market card. */
  Cover: Component;
  Panel: Component;
  /** Left out of the market: it only opens from elsewhere (the asset menu). */
  unlisted?: boolean;
};


export const EXTENSIONS: Extension[] = [
  {
    id: CUTOUT_EXTENSION,
    name: msg("Remove background"),
    summary: msg("Take the background out of a picture on this device, then drop the cutout onto your scene."),
    author: "plan.video",
    Cover: CutoutCover,
    Panel: CutoutPanel,
    unlisted: true,
  },
  {
    id: "progress-bar",
    name: msg("Progress bar"),
    summary: msg("A bar that fills across the frame as the video plays, so viewers stay to the end."),
    author: "plan.video",
    Cover: ProgressBarCover,
    Panel: ProgressBarPanel,
  },
  {
    id: "valorant-killfeed",
    name: msg("Killfeed"),
    tag: "Valorant",
    summary: msg("Kills the way they look in game, dropped onto your clip."),
    author: "plan.video",
    Cover: KillfeedCover,
    Panel: KillfeedPanel,
  },
  {
    id: "cs2-killfeed",
    name: msg("Killfeed"),
    tag: "CS2",
    summary: msg("Death notices the way they look in game, dropped onto your clip."),
    author: "plan.video",
    Cover: Cs2KillfeedCover,
    Panel: Cs2KillfeedPanel,
  },
  {
    id: "cod-killfeed",
    name: msg("Killfeed"),
    tag: "Call of Duty",
    summary: msg("Death notices the way they look in Modern Warfare, dropped onto your clip."),
    author: "plan.video",
    Cover: CodKillfeedCover,
    Panel: CodKillfeedPanel,
  },
  {
    id: "pubg-killfeed",
    name: msg("Killfeed"),
    tag: "PUBG",
    summary: msg("Death notices the way they look in game, dropped onto your clip."),
    author: "plan.video",
    Cover: PubgKillfeedCover,
    Panel: PubgKillfeedPanel,
  },
  {
    id: "rust-killfeed",
    name: msg("Killfeed"),
    tag: "Rust",
    summary: msg("Death notices the way they look in game, dropped onto your clip."),
    author: "plan.video",
    Cover: RustKillfeedCover,
    Panel: RustKillfeedPanel,
  },
];

/** The extension whose panel is open, or none: the market shows. */
export const openExtension = (): Extension | undefined => EXTENSIONS.find((extension) => extension.id === openExtensionId());
