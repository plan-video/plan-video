/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { colorMix, drawWord, easeOut, f30, fadeIn, fadeOut, mix, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// The whole line shows dim; each word turns solid as it is said. A highlighted word turns the accent colour and grows
// a few percent; its room is kept in the layout, so the line never jumps.

export const karaoke: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 600 },
		case: 'sentence',
		size: 4.3,
		wideScale: 1.15,
		lineHeight: 1.3,
		letterSpacing: 0,
		color: '#FFFFFF',
		shadow: { x: 0, y: 0.25, blur: 1.0, color: 'rgba(0,0,0,0.75)' },
		emphasis: { color: '#FFD24A', scale: 1.07 },
		position: { y: 74, marginX: 9 },
		page: { maxWords: 10, maxCharsPerLine: 28, maxCharsPerLineWide: 50, maxLines: 2, minFrames: 20, maxFrames: 140, gapBreakMs: 500 },
		anim: { dim: 0.66, wordIn: 3, pageIn: 2, pageOut: 2 },
	},
	spec: (page, st) => page.words.map((w) => (w.emphasis ? { size: st.emphasis?.scale ?? 1.07 } : {})),
	layout: () => ({ align: 'left' }),
	paint: ({ ctx, st, f, page, L, ws, since, left }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const opacity = Math.min(fadeIn(since, f30(a.pageIn, f.fps)).opacity, fadeOut(left, f30(a.pageOut, f.fps)));
		withPose(ctx, { opacity, filter: styleShadow(st, f) }, () => {
			L.words.forEach((box, i) => {
				const k = ws[i]!.since < 0 ? 0 : easeOut((ws[i]!.since + 1) / (f30(a.wordIn, f.fps) + 1));
				const word = page.words[i]!;
				const hot = word.color ?? e.color ?? st.color;
				drawWord(ctx, {
					box,
					fill: word.emphasis ? colorMix(k, st.color, hot) : st.color,
					opacity: mix(a.dim, 1, k),
					scale: word.emphasis ? mix(1 / (e.scale ?? 1.07), 1, k) : 1,
				});
			});
		});
	},
};
