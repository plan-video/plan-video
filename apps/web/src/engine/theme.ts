/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DEFAULT_GENERATING_PULSE, DefaultBackground, GeneratingPulse } from '@plan.video/runtime';

import { EditorTheme, type EditorThemeMode } from './traits';
import { COLORS, LIGHT_COLORS } from './timeline/constants';
import { TimelineSurface } from './timeline/surface';

import type { World } from 'koota';

/** Must match `--canvas` in each theme. */
const CANVAS_BACKGROUND: Record<EditorThemeMode, number> = {
	dark: 0x060606,
	light: 0xf3f3f3,
};

const GENERATING_PULSE: Record<EditorThemeMode, { from: number; to: number }> = {
	dark: DEFAULT_GENERATING_PULSE,
	light: { from: 0xebebeb, to: 0xdcdcdc },
};

/** The DOM follows the theme through CSS tokens; the editor's own canvases read these colours instead. */
export function setEditorTheme(world: World, mode: EditorThemeMode): void {
	world.set(EditorTheme, { mode });
	world.set(DefaultBackground, { value: CANVAS_BACKGROUND[mode] });
	world.set(GeneratingPulse, GENERATING_PULSE[mode]);

	const surface = world.get(TimelineSurface);
	if (surface) surface.colors = mode === 'light' ? LIGHT_COLORS : COLORS;
}
