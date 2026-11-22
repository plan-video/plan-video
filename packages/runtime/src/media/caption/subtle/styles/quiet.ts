/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { recipeStyle } from './recipe';

// Lowercase medium sans; each line rises gently into place, no box, a soft shadow.

export const quiet = recipeStyle({
	font: { family: 'Inter', weight: 600 },
	case: 'lower',
	size: 3.7,
	wideScale: 1.25,
	lineHeight: 1.3,
	letterSpacing: 0.01,
	color: '#FFFFFF',
	shadow: { x: 0, y: 0.25, blur: 2.6, color: 'rgba(0,0,0,0.78)' },
	position: { y: 74, marginX: 10 },
	page: { maxWords: 9, maxCharsPerLine: 30, maxCharsPerLineWide: 52, maxLines: 2, minFrames: 22, maxFrames: 140, gapBreakMs: 500 },
	anim: {
		recipe: {
			unit: 'line',
			enter: { kind: 'rise', frames: 9, ease: 'out-expo', distance: 0.35, stagger: 1 },
			exit: { kind: 'fade', frames: 6 },
			upcoming: { opacity: 1 },
			emphasis: { color: '#FFD9A0' },
			align: 'center',
		},
	},
});
