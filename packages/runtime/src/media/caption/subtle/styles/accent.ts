/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { drawWord, f30, fadeOut, keyWords, riseIn, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Very short pages in a light sans; the key word swaps to a light serif italic. Soft fade with a few px of drift.

export const accent: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 500 },
		emphasisFont: { family: 'Instrument Serif', weight: 400, italic: true },
		case: 'lower',
		size: 5.4,
		wideScale: 1.3,
		lineHeight: 1.2,
		letterSpacing: 0,
		color: '#D8F9AB',
		shadow: { x: 0, y: 0.2, blur: 0.8, color: 'rgba(0,0,0,0.55)' },
		position: { y: 72, marginX: 8 },
		page: { maxWords: 3, maxCharsPerLine: 22, maxCharsPerLineWide: 34, maxLines: 1, minFrames: 10, maxFrames: 75, gapBreakMs: 300 },
		anim: { pageIn: 4, pageOut: 3, drift: 4, italicScale: 1.38 },
	},
	spec: (page, st) => {
		const key = keyWords(page);
		return page.words.map((_, i) => (key.has(i) ? { font: st.emphasisFont, size: st.anim.italicScale } : {}));
	},
	paint: ({ ctx, st, f, L, since, left }) => {
		const a = st.anim;
		const r = riseIn(f, since, f30(a.pageIn, f.fps), a.drift);
		const opacity = Math.min(r.opacity, fadeOut(left, f30(a.pageOut, f.fps)));
		withPose(ctx, { opacity, dy: r.dy, filter: styleShadow(st, f) }, () => {
			for (const box of L.words) drawWord(ctx, { box, fill: st.color });
		});
	},
};
