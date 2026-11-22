/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { recipeStyle } from './recipe';

// Tiny, wide-tracked serif capitals low in the frame that fade in and out slowly out of a blur.

export const cinema = recipeStyle({
	font: { family: 'Libre Baskerville', weight: 500 },
	case: 'upper',
	size: 1.9,
	wideScale: 1.3,
	lineHeight: 2.1,
	letterSpacing: 0.36,
	color: '#EFE9DD',
	shadow: { x: 0, y: 0.1, blur: 1.2, color: 'rgba(0,0,0,0.7)' },
	position: { y: 82, marginX: 9 },
	page: { maxWords: 6, maxCharsPerLine: 26, maxCharsPerLineWide: 46, maxLines: 2, minFrames: 24, maxFrames: 150, gapBreakMs: 500 },
	anim: {
		recipe: {
			unit: 'page',
			enter: { kind: 'blur-in', frames: 16, ease: 'out-cubic', distance: 0.5 },
			exit: { kind: 'blur-out', frames: 12 },
			upcoming: { opacity: 0 },
			emphasis: { color: '#FFFFFF' },
		},
	},
});
