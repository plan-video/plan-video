/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { drawWord, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Big bold caps low in the frame, built word by word with no animation; the key word is yellow.

export const bottom: SubtleStyle = {
	style: {
		font: { family: 'Poppins', weight: 800 },
		case: 'upper',
		size: 6.4,
		wideScale: 1.15,
		lineHeight: 1.1,
		letterSpacing: -0.03,
		color: '#FFFFFF',
		activeColor: '#FDF018',
		shadow: { x: 0, y: 0.28, blur: 0.55, color: 'rgba(0,0,0,0.7)' },
		position: { y: 77, marginX: 7 },
		page: { maxWords: 3, maxCharsPerLine: 14, maxCharsPerLineWide: 26, maxLines: 1, minFrames: 10, maxFrames: 70, gapBreakMs: 300 },
		anim: {},
	},
	layout: () => ({ align: 'left' }),
	paint: ({ ctx, st, f, page, L, ws }) => {
		const dx = (f.W * st.position.marginX) / 100 - L.left;
		withPose(ctx, { dx, filter: styleShadow(st, f) }, () => {
			L.words.forEach((box, i) => {
				if (ws[i]!.since < 0) return;
				const word = page.words[i]!;
				drawWord(ctx, { box, fill: word.emphasis ? word.color ?? st.activeColor! : st.color });
			});
		});
	},
};
