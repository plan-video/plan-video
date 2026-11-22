/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { drawWord, f30, fadeIn, fadeOut, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// A calm medium-weight line with a soft shadow, cut in hard; the key word turns warm yellow.

export const hype: SubtleStyle = {
	style: {
		font: { family: 'Montserrat', weight: 700 },
		case: 'sentence',
		size: 4.4,
		wideScale: 1.2,
		lineHeight: 1.2,
		letterSpacing: 0,
		color: '#FFFFFF',
		activeColor: '#FCD402',
		shadow: { x: 0, y: 0.25, blur: 1.0, color: 'rgba(0,0,0,0.8)' },
		position: { y: 47, marginX: 8 },
		page: { maxWords: 5, maxCharsPerLine: 26, maxCharsPerLineWide: 44, maxLines: 1, minFrames: 10, maxFrames: 60, gapBreakMs: 300 },
		anim: { mode: 'word', pageIn: 1, pageOut: 1 },
	},
	paint: ({ ctx, st, f, page, L, since, left }) => {
		const a = st.anim;
		const keyPage = page.words.some((w) => w.emphasis);
		const opacity = Math.min(fadeIn(since, f30(a.pageIn ?? 1, f.fps)).opacity, fadeOut(left, f30(a.pageOut ?? 1, f.fps)));
		withPose(ctx, { opacity, filter: styleShadow(st, f) }, () => {
			L.words.forEach((box, i) => {
				const word = page.words[i]!;
				const yellow = a.mode === 'word' ? word.emphasis : keyPage;
				drawWord(ctx, { box, fill: yellow ? word.color ?? st.activeColor! : st.color });
			});
		});
	},
};
