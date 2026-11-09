/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { DEFAULT_GENERATING_PULSE, DefaultBackground, GeneratingPulse } from '@plan.video/runtime';

import { isDefaultTheme, resolvePalette, type ThemeSpec } from '@/lib/theme-palette';

import { EditorTheme, type EditorThemeMode } from './traits';
import { COLORS, LIGHT_COLORS, type TimelineColors } from './timeline/constants';
import { TimelineSurface } from './timeline/surface';

import type { World } from 'koota';

/** Must match `--canvas` in each theme. */
const CANVAS_BACKGROUND: Record<EditorThemeMode, number> = {
	dark: 0x070605,
	light: 0xf3f3f3,
};

const GENERATING_PULSE: Record<EditorThemeMode, { from: number; to: number }> = {
	dark: DEFAULT_GENERATING_PULSE,
	light: { from: 0xebebeb, to: 0xdcdcdc },
};

function timelineColors(spec: ThemeSpec, mode: EditorThemeMode): TimelineColors {
	const base = mode === 'light' ? LIGHT_COLORS : COLORS;
	if (isDefaultTheme(spec)) return base;
	const palette = resolvePalette(spec, mode);
	return {
		...base,
		background: { default: palette.surface, muted: palette.timelineMuted, accent: palette.timelineAccent },
		border: { ...base.border, darker: palette.surface, input: palette.timelineInput, ring: palette.accent, playhead: palette.playhead },
		clip: { ...base.clip, ...palette.clips },
	};
}

/** The DOM follows the theme through CSS tokens; the editor's own canvases read these colours instead. */
export function setEditorTheme(world: World, mode: EditorThemeMode, spec: ThemeSpec): void {
	world.set(EditorTheme, { mode });
	world.set(DefaultBackground, {
		value: isDefaultTheme(spec) ? CANVAS_BACKGROUND[mode] : parseInt(resolvePalette(spec, mode).canvas.slice(1), 16),
	});
	world.set(GeneratingPulse, GENERATING_PULSE[mode]);

	const surface = world.get(TimelineSurface);
	if (surface) surface.colors = timelineColors(spec, mode);
}
