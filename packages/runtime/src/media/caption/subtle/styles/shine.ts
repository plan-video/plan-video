/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { capHeight, clamp01, drawWord, dropShadow, easeInOut, f30, fadeIn, fadeOut, joinFilters, mix, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Serif italic in one accent colour; a diagonal band of light sweeps across each word as it arrives, then a soft glow fades.

export const shine: SubtleStyle = {
	style: {
		font: { family: 'Playfair Display', weight: 900, italic: true },
		case: 'sentence',
		size: 6.4,
		wideScale: 1.2,
		lineHeight: 1.2,
		letterSpacing: -0.01,
		color: '#05B2FA',
		shadow: null,
		position: { y: 60, marginX: 8 },
		page: { maxWords: 4, maxCharsPerLine: 22, maxCharsPerLineWide: 40, maxLines: 1, minFrames: 16, maxFrames: 90, gapBreakMs: 400 },
		anim: { lightColor: '#FFFFFF', band: 0.6, sweep: 12, delay: 1, glow: 12, glowBlur: 18, wordIn: 2, pageOut: 3, shadowBlur: 26 },
	},
	paint: ({ ctx, st, f, page, L, ws, left }) => {
		const a = st.anim;
		const sweep = f30(a.sweep, f.fps);
		const glowN = f30(a.glow, f.fps);
		const filter = joinFilters(dropShadow(f, 0, 2, a.shadowBlur, 'rgba(0,0,0,0.78)'), dropShadow(f, 0, 1, a.shadowBlur * 0.3, 'rgba(0,0,0,0.7)'));
		withPose(ctx, { opacity: fadeOut(left, f30(a.pageOut, f.fps)), filter }, () => {
			L.words.forEach((box, i) => {
				const word = page.words[i]!;
				const since = ws[i]!.since - f30(a.delay, f.fps);
				const y0 = box.baseline - capHeight(box.font) * box.fs * 1.2;
				const y1 = box.baseline + box.fs * 0.3;
				const d = y1 - y0;
				const bw = box.fs * a.band;
				const p = clamp01((since + 1) / (sweep + 1));
				const bx = mix(box.left - bw - d, box.left + box.w, easeInOut(p));
				const g = since >= sweep ? clamp01(1 - (since - sweep) / glowN) : 0;
				const key = word.emphasis ? 1.35 : 1;
				const glow = g > 0.02 ? dropShadow(f, 0, 0, a.glowBlur, `rgba(255,255,255,${(0.75 * g * key).toFixed(3)})`) : undefined;
				withPose(ctx, { opacity: fadeIn(ws[i]!.since, f30(a.wordIn, f.fps)).opacity }, () => {
					drawWord(ctx, { box, fill: word.color ?? st.color, filter: glow });
					if (since < 0 || p >= 1) return;
					withPose(ctx, {}, () => {
						ctx.beginPath();
						ctx.moveTo(bx, y0);
						ctx.lineTo(bx + bw, y0);
						ctx.lineTo(bx + bw + d, y1);
						ctx.lineTo(bx + d, y1);
						ctx.closePath();
						ctx.clip();
						drawWord(ctx, { box, fill: a.lightColor });
					});
				});
			});
		});
	},
};
