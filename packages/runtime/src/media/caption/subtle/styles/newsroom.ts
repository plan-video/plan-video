/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { recipeStyle } from './recipe';

// Bold yellow sans with a soft black outline, all on screen at once; the word being said turns white.

export const newsroom = recipeStyle({
	font: { family: 'Montserrat', weight: 800 },
	case: 'sentence',
	size: 4.3,
	wideScale: 1.2,
	lineHeight: 1.18,
	letterSpacing: 0,
	color: '#FFE14D',
	shadow: { x: 0, y: 0.3, blur: 1.4, color: 'rgba(0,0,0,0.65)' },
	position: { y: 73, marginX: 8 },
	page: { maxWords: 8, maxCharsPerLine: 24, maxCharsPerLineWide: 42, maxLines: 2, minFrames: 18, maxFrames: 120, gapBreakMs: 450 },
	anim: {
		recipe: {
			unit: 'line',
			enter: { kind: 'fade', frames: 4, ease: 'out-cubic' },
			exit: { kind: 'fade', frames: 3 },
			upcoming: { opacity: 1, color: null },
			active: { color: '#FFFFFF', scale: 1.0 },
			spoken: { color: null },
			stroke: { width: 0.055, color: 'rgba(0,0,0,0.85)' },
			emphasis: { scale: 1.0 },
			align: 'center',
		},
	},
});
