/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DEFAULT_GENERATING_PULSE, DefaultBackground, GeneratingPulse } from '@plan.video/runtime';

import { EditorTheme, type EditorThemeMode } from './traits';
import { COLORS, LIGHT_COLORS } from './timeline/constants';
import { TimelineSurface } from './timeline/surface';

import type { World } from 'koota';

/** The canvas behind a stage left on the default background: `--canvas` for each theme. */
const CANVAS_BACKGROUND: Record<EditorThemeMode, number> = {
	dark: 0x060606,
	light: 0xf3f3f3,
};

/** What a node in generation pulses between, on the canvas and in the timeline. */
const GENERATING_PULSE: Record<EditorThemeMode, { from: number; to: number }> = {
	dark: DEFAULT_GENERATING_PULSE,
	light: { from: 0xebebeb, to: 0xdcdcdc },
};

/**
 * Points everything the editor draws on its own canvases at `mode`: the
 * stage's default background, the HUD over it, the pulse of a node in
 * generation and the timeline. The DOM follows the theme through the CSS
 * tokens; these read colors, not tokens.
 */
export function setEditorTheme(world: World, mode: EditorThemeMode): void {
	world.set(EditorTheme, { mode });
	world.set(DefaultBackground, { value: CANVAS_BACKGROUND[mode] });
	world.set(GeneratingPulse, GENERATING_PULSE[mode]);

	const surface = world.get(TimelineSurface);
	if (surface) surface.colors = mode === 'light' ? LIGHT_COLORS : COLORS;
}
