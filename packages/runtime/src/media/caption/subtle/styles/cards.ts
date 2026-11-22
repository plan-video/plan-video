/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { recipeStyle } from './recipe';

// White serif on a dark rounded card; the phrase appears at once, key words in red serif italic.

export const cards = recipeStyle({
	font: { family: 'Instrument Serif', weight: 400 },
	case: 'sentence',
	size: 5.0,
	wideScale: 1.25,
	lineHeight: 1.12,
	letterSpacing: 0,
	color: '#FFFFFF',
	shadow: null,
	position: { y: 71, marginX: 9 },
	page: { maxWords: 9, maxCharsPerLine: 26, maxCharsPerLineWide: 44, maxLines: 2, minFrames: 22, maxFrames: 130, gapBreakMs: 450 },
	anim: {
		recipe: {
			unit: 'page',
			enter: { kind: 'fade', frames: 5, ease: 'out-cubic' },
			exit: { kind: 'fade', frames: 4 },
			upcoming: { opacity: 1 },
			plate: { kind: 'page', color: 'rgba(14,12,12,0.66)', radius: 0.5, padX: 0.65, padY: 0.28, backdropBlur: 14 },
			emphasis: { color: '#FF5A4F', font: { family: 'Instrument Serif', weight: 400, italic: true } },
			align: 'center',
		},
	},
});
