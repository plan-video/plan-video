/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { blurCss, clamp01, drawWord, easeInOut, f30, featherFill, joinFilters, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Lowercase warm yellow; each word is revealed by a soft left-to-right wipe and the page dissolves with a blur.

export const wipe: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 600 },
		case: 'lower',
		size: 5.0,
		wideScale: 1.3,
		lineHeight: 1.2,
		letterSpacing: -0.01,
		color: '#F0D530',
		shadow: { x: 0, y: 0.12, blur: 0.7, color: 'rgba(0,0,0,0.55)' },
		emphasis: { color: '#FFFFFF', font: { family: 'Inter', weight: 700 } },
		position: { y: 68, marginX: 7 },
		page: { maxWords: 4, maxCharsPerLine: 22, maxCharsPerLineWide: 36, maxLines: 1, minFrames: 14, maxFrames: 90, gapBreakMs: 350 },
		anim: { wipe: 9, feather: 0.35, wordBlur: 3, pageOut: 5, pageBlur: 7 },
	},
	spec: (page, st) => page.words.map((w) => (w.emphasis && st.emphasis?.font ? { font: st.emphasis.font } : {})),
	paint: ({ ctx, st, f, page, L, ws, left }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const dis = 1 - easeInOut(clamp01(left / f30(a.pageOut, f.fps)));
		withPose(ctx, { opacity: 1 - dis * 0.65, filter: joinFilters(styleShadow(st, f), blurCss(f, a.pageBlur * dis)) }, () => {
			L.words.forEach((box, i) => {
				if (ws[i]!.since < 0) return;
				const p = clamp01((ws[i]!.since + 1) / (f30(a.wipe, f.fps) + 1));
				const word = page.words[i]!;
				const color = word.emphasis ? word.color ?? e.color ?? st.color : st.color;
				drawWord(ctx, {
					box,
					fill: p >= 1 ? color : featherFill(ctx, color, box.left, box.w, easeInOut(p), a.feather),
					filter: blurCss(f, a.wordBlur * (1 - p)) || undefined,
				});
			});
		});
	},
};
