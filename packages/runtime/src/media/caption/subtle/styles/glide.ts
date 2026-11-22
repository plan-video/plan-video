/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { drawWord, dropShadow, f30, fadeIn, fadeOut, hasNumeral, joinFilters, keyWords, scaleFromBaseline, styleShadow, withAlpha, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Key words in a large calligraphic script that grows in from its baseline, the small words in bold white sans, on one line.

export const glide: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 700 },
		emphasisFont: { family: 'Pinyon Script', weight: 400 },
		case: 'sentence',
		size: 3.9,
		wideScale: 1.3,
		lineHeight: 1.2,
		letterSpacing: 0,
		color: '#FFFFFF',
		activeColor: '#F5F258',
		shadow: { x: 0, y: 0.22, blur: 0.5, color: 'rgba(0,0,0,0.5)' },
		emphasis: { numberFont: { family: 'Playfair Display', weight: 500, italic: true }, numberScale: 1.7 },
		position: { y: 52, marginX: 6 },
		page: { maxWords: 5, maxCharsPerLine: 24, maxCharsPerLineWide: 40, maxLines: 1, minFrames: 14, maxFrames: 75, gapBreakMs: 350 },
		anim: { scriptScale: 3.1, scriptFrom: 0.1, scriptIn: 5, wordIn: 2, pageOut: 2, glowBlur: 5, scriptBold: 0.9 },
	},
	// Digits and currency signs are missing or ugly in the script: a serif italic carries them.
	spec: (page, st) => {
		const script = keyWords(page);
		const e = st.emphasis ?? {};
		return page.words.map((w, i) =>
			!script.has(i)
				? {}
				: hasNumeral(w.text) && e.numberFont
					? { font: e.numberFont, size: e.numberScale ?? 1.6, ls: 0, pad: 0.16 }
					: { font: st.emphasisFont, size: st.anim.scriptScale ?? 2.5, ls: 0.01, pad: 0.22 },
		);
	},
	paint: ({ ctx, st, f, page, L, ws, left }) => {
		const a = st.anim;
		const script = keyWords(page);
		const shadow = styleShadow(st, f);
		const bold = a.scriptBold ?? 0;
		withPose(ctx, { opacity: fadeOut(left, f30(a.pageOut ?? 2, f.fps)) }, () => {
			L.words.forEach((box, i) => {
				const since = ws[i]!.since;
				const isScript = script.has(i);
				const r = isScript ? scaleFromBaseline(since, f30(a.scriptIn ?? 5, f.fps), a.scriptFrom ?? 0.1) : fadeIn(since, f30(a.wordIn ?? 2, f.fps));
				const active = page.words[i]!.color ?? st.activeColor!;
				const glow = joinFilters(
					dropShadow(f, 0, 0, a.glowBlur ?? 8, a.glowColor ?? withAlpha(active, 0.4)),
					dropShadow(f, 0, 0, (a.glowBlur ?? 8) * 3, withAlpha(active, 0.16)),
					shadow,
				);
				// The script is hairline thin: copies a fraction of a pixel apart thicken it.
				if (isScript && bold > 0) {
					for (const k of [-1, 1]) drawWord(ctx, { box, fill: active, opacity: r.opacity, scale: r.scale, dx: k * bold * (f.H / 1080) * 0.5, filter: glow });
				}
				drawWord(ctx, { box, fill: isScript ? active : st.color, opacity: r.opacity, scale: r.scale, filter: isScript ? glow : shadow });
			});
		});
	},
};
