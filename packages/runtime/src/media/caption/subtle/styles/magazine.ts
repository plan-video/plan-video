/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { applyCase, baseFontSize, capHeight, drawWord, f30, fadeOut, riseIn, spaceWidth, styleShadow, textWidth, withPose } from '../engine';

import type { FontSpec, WordBox } from '../engine';
import type { SubtleStyle } from '../style';

// A tight justified block like an ad super: key words in big serif italic, glue words in small grotesk capitals.

const GLUE = new Set("a an and are as at be but by for from had has have he her his i i'm in is it it's its me my of on or our she so than that the their them then there these they this to us was we were what when who will with you your".split(' '));
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, '');

export const magazine: SubtleStyle = {
	style: {
		font: { family: 'Montserrat', weight: 700 },
		case: 'sentence',
		size: 4.6,
		wideScale: 1.3,
		lineHeight: 1.1,
		letterSpacing: 0,
		color: '#FFFFFF',
		shadow: { x: 0, y: 0.12, blur: 1.1, color: 'rgba(0,0,0,0.5)' },
		emphasis: { color: '#FFE9A8' },
		position: { y: 66, marginX: 8 },
		page: { maxWords: 6, maxCharsPerLine: 18, maxCharsPerLineWide: 34, maxLines: 3, minFrames: 16, maxFrames: 100, gapBreakMs: 400 },
		anim: {
			serifFont: { family: 'Instrument Serif', weight: 400, italic: true },
			serifScale: 1.35, keyScale: 1.75, glueScale: 0.5, blockWidth: 78, wordGap: 0.8, minStretch: 0.7, maxStretch: 1.45,
			lineGap: 0.011, wordIn: 4, rise: 10, pageOut: 4, glueOpacity: 0.92,
		},
	},
	paint: ({ ctx, st, f, page, ws, left }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const serif: FontSpec = a.serifFont;
		const sans = st.font;
		const base = baseFontSize(st.size, st, f);
		const items = page.words.map((w, i) => {
			const isSerif = !(GLUE.has(bare(w.text)) && !w.emphasis);
			return {
				i,
				text: applyCase(w.text, isSerif ? 'lower' : 'upper'),
				font: isSerif ? serif : sans,
				mul: w.emphasis ? a.keyScale : isSerif ? a.serifScale : a.glueScale,
				serif: isSerif,
			};
		});
		const lineOf = (k: number) => Math.min(page.words[k]!.line, 2);
		const ids = [...new Set(items.map((_, k) => lineOf(k)))].sort((x, y) => x - y);
		const blockW = (f.W * a.blockWidth) / 100;
		const widthOf = (it: (typeof items)[number], fs: number) => textWidth(it.text, it.font, fs * it.mul, 0);
		// Every line is scaled to the block's width, within limits, so the block has hard edges.
		const lines = ids.map((id) => {
			const its = items.filter((_, k) => lineOf(k) === id);
			const natural = (fs: number) => its.reduce((s, it) => s + widthOf(it, fs), 0) + (its.length - 1) * spaceWidth(sans, fs) * a.wordGap;
			const fs = base * Math.max(a.minStretch, Math.min(a.maxStretch, blockW / natural(base)));
			const w = natural(fs);
			const fit = Math.min(fs, w > blockW ? (fs * blockW) / w : fs);
			const cap = Math.max(...its.map((it) => capHeight(it.font) * fit * it.mul));
			return { its, fs: fit, w: natural(fit), cap };
		});
		const gap = f.H * a.lineGap;
		const total = lines.reduce((s, l) => s + l.cap, 0) + gap * (lines.length - 1);
		let y = (f.H * st.position.y) / 100 - total / 2;
		const dur = f30(a.wordIn, f.fps);
		withPose(ctx, { filter: styleShadow(st, f), opacity: fadeOut(left, f30(a.pageOut, f.fps)) }, () => {
			lines.forEach((l, li) => {
				const baseline = y + l.cap;
				y += l.cap + gap;
				const inked = l.its.reduce((s, it) => s + widthOf(it, l.fs), 0);
				const justified = l.w >= blockW * 0.97;
				const sp = l.its.length > 1 ? (justified ? (blockW - inked) / (l.its.length - 1) : spaceWidth(sans, l.fs) * a.wordGap) : 0;
				let x = f.W / 2 - (inked + sp * (l.its.length - 1)) / 2;
				for (const it of l.its) {
					const w = widthOf(it, l.fs);
					const box: WordBox = { i: it.i, text: it.text, font: it.font, fs: l.fs * it.mul, ls: 0, left: x, w, cx: x + w / 2, line: li, baseline };
					x += w + sp;
					const word = page.words[it.i]!;
					const r = riseIn(f, ws[it.i]!.since, dur, a.rise);
					const fill = word.emphasis ? word.color ?? e.color ?? st.color : it.serif ? st.color : a.glueColor ?? st.color;
					drawWord(ctx, { box, fill, opacity: r.opacity * (it.serif ? 1 : a.glueOpacity ?? 0.9), dy: r.dy });
				}
			});
		});
	},
};
