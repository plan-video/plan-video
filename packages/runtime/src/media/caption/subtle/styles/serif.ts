/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { blurIn, capHeight, colorMix, drawWord, dropShadow, f30, fadeOut, joinFilters, blurCss, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Display serif italic filled with a top-lit silver gradient; each word fades up out of a soft blur. Key words in gold.

export const serif: SubtleStyle = {
	style: {
		font: { family: 'Playfair Display', weight: 900, italic: true },
		case: 'sentence',
		size: 6.6,
		wideScale: 1.2,
		lineHeight: 1.2,
		letterSpacing: -0.01,
		color: '#FFFFFF',
		shadow: null,
		emphasis: { gradTop: '#FFEDB0', gradBottom: '#C98A1E' },
		position: { y: 60, marginX: 8 },
		page: { maxWords: 4, maxCharsPerLine: 22, maxCharsPerLineWide: 40, maxLines: 1, minFrames: 16, maxFrames: 90, gapBreakMs: 400 },
		anim: { gradTop: '#FFFFFF', gradBottom: '#C4C4C4', wordIn: 4, wordBlur: 6, pageOut: 4, shadowBlur: 22, shadowColor: 'rgba(0,0,0,0.85)' },
	},
	paint: ({ ctx, st, f, page, L, ws, left }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const filter = joinFilters(dropShadow(f, 0, 2, a.shadowBlur, a.shadowColor), dropShadow(f, 0, 1, a.shadowBlur * 0.3, a.shadowColor));
		withPose(ctx, { opacity: fadeOut(left, f30(a.pageOut, f.fps)), filter }, () => {
			L.words.forEach((box, i) => {
				const word = page.words[i]!;
				const cap = capHeight(box.font) * box.fs;
				const r = blurIn(f, ws[i]!.since, f30(a.wordIn, f.fps), a.wordBlur);
				const top = word.color ? colorMix(0.35, '#FFFFFF', word.color) : word.emphasis ? e.gradTop ?? a.gradTop : a.gradTop;
				const bottom = word.color ?? (word.emphasis ? e.gradBottom ?? a.gradBottom : a.gradBottom);
				const fill = ctx.createLinearGradient(0, box.baseline - cap * 1.1, 0, box.baseline + box.fs * 0.24);
				fill.addColorStop(0, top);
				fill.addColorStop(1, bottom);
				drawWord(ctx, { box, fill, opacity: r.opacity, filter: blurCss(f, r.blur) || undefined, dy: (1 - r.opacity) * f.H * 0.004 });
			});
		});
	},
};
