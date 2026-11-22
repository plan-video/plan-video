/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { recipeStyle } from './recipe';

// Heavy capitals that pop in word by word with overshoot; the spoken word swells and turns lime, thick black outline.

export const punch = recipeStyle({
	font: { family: 'Montserrat', weight: 900 },
	case: 'upper',
	size: 5.4,
	wideScale: 1.15,
	lineHeight: 1.1,
	letterSpacing: -0.005,
	color: '#FFFFFF',
	shadow: { x: 0, y: 0.45, blur: 0.5, color: 'rgba(0,0,0,0.5)' },
	position: { y: 62, marginX: 8 },
	page: { maxWords: 4, maxCharsPerLine: 14, maxCharsPerLineWide: 30, maxLines: 2, minFrames: 12, maxFrames: 80, gapBreakMs: 350 },
	anim: {
		recipe: {
			unit: 'word',
			enter: { kind: 'pop', frames: 6, ease: 'out-back', overshoot: 1.14 },
			exit: { kind: 'cut', frames: 2 },
			upcoming: { opacity: 0 },
			active: { color: '#C8FF2E', scale: 1.08 },
			spoken: { color: null },
			stroke: { width: 0.07, color: '#000000' },
			emphasis: { color: '#C8FF2E', scale: 1.0 },
			align: 'center',
		},
	},
});
