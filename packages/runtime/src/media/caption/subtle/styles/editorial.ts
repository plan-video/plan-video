/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { applyCase, baseFontSize, blurCss, capHeight, drawWord, f30, fitRun, mix, placeBox, styleShadow, withPose } from '../engine';

import type { SWord } from '../engine';
import type { SubtleStyle } from '../style';

// Bold lowercase sans with the keyword three times larger in a red high-contrast italic serif, lower-left third.

const STOP = new Set("a an and are as at be but by for from had has have he her his i i'm i've in is it it's its me my of on or our she so than that the their them then there these they this to us was we were what when who will with you your you're".split(' '));
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

/** The highlighted word, else the longest word that carries meaning (the later on a tie). */
function keywordIndex(words: readonly SWord[]): number {
	const e = words.findIndex((w) => w.emphasis);
	if (e >= 0) return e;
	let best = -1;
	words.forEach((word, i) => {
		const w = bare(word.text);
		if (STOP.has(w) || w.length < 4) return;
		if (best < 0 || w.length >= bare(words[best]!.text).length) best = i;
	});
	if (best >= 0) return best;
	for (let i = words.length - 1; i >= 0; i--) if (!STOP.has(bare(words[i]!.text))) return i;
	return words.length - 1;
}

export const editorial: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 700 },
		case: 'lower',
		size: 3.8,
		wideScale: 1.6,
		lineHeight: 1.2,
		letterSpacing: -0.02,
		color: '#FFFFFF',
		shadow: { x: 0, y: 0.2, blur: 1.0, color: 'rgba(0,0,0,0.5)' },
		emphasis: { font: { family: 'Playfair Display', weight: 900, italic: true }, color: '#D81B22', scale: 3.0, letterSpacing: -0.01 },
		position: { x: 9, y: 70, marginX: 6 },
		page: { maxLines: 2, minFrames: 14, maxFrames: 80, gapBreakMs: 350, maxWords: 4, maxCharsPerLine: 14, maxCharsPerLineWide: 24 },
		anim: { rowGap: 2.25, afterGap: 1.45, keyInset: 0.0, keyIn: 3, keyFrom: 0.85, keyBlur: 3 },
	},
	paint: ({ ctx, st, f, page, ws }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const kw = keywordIndex(page.words);
		const before = Array.from({ length: kw }, (_, i) => i);
		const after = Array.from({ length: page.words.length - kw - 1 }, (_, i) => kw + 1 + i);
		const s0 = baseFontSize(st.size, st, f);
		const x0 = (f.W * (st.position.x ?? 9)) / 100;
		const avail = f.W - x0 - (f.W * st.position.marginX) / 100;
		const kFont = e.font ?? st.font;
		const keyText = [applyCase(page.words[kw]!.text, st.case)];
		const txt = (idx: number[]) => idx.map((i) => applyCase(page.words[i]!.text, st.case));
		const probe = fitRun(keyText, kFont, s0 * e.scale, { ls: e.letterSpacing ?? 0, maxW: avail });
		let k = probe.fs / (s0 * e.scale);
		const rowA = before.length ? fitRun(txt(before), st.font, s0, { ls: st.letterSpacing, maxW: avail }) : null;
		const rowC = after.length ? fitRun(txt(after), st.font, s0, { ls: st.letterSpacing, maxW: avail }) : null;
		for (const r of [rowA, rowC]) if (r) k = Math.min(k, r.fs / s0);
		const s = s0 * k;
		const key = fitRun(keyText, kFont, s * e.scale, { ls: e.letterSpacing ?? 0, maxW: avail });
		const A = rowA ? fitRun(txt(before), st.font, s, { ls: st.letterSpacing, maxW: avail }) : null;
		const C = rowC ? fitRun(txt(after), st.font, s, { ls: st.letterSpacing, maxW: avail }) : null;
		const capS = capHeight(st.font) * s;
		const yA = -a.rowGap * s;
		const yC = a.afterGap * s;
		const top = A ? yA - capS : -key.fs * 0.75;
		const bottom = C ? yC + 0.25 * s : key.fs * 0.3;
		const shift = (f.H * st.position.y) / 100 - (top + bottom) / 2;
		const kwSince = ws[kw]!.since;
		const p = kwSince < 0 ? 0 : Math.min(1, (kwSince + 1) / (f30(a.keyIn, f.fps) + 1));
		withPose(ctx, { filter: styleShadow(st, f) }, () => {
			A?.boxes.forEach((b, j) => {
				if (ws[before[j]!]!.since >= 0) drawWord(ctx, { box: placeBox(b, x0, yA + shift), fill: st.color });
			});
			if (kwSince >= 0) {
				drawWord(ctx, {
					box: placeBox(key.boxes[0]!, x0 + a.keyInset * s, shift),
					fill: page.words[kw]!.color ?? e.color ?? st.color,
					scale: mix(a.keyFrom, 1, p),
					filter: kwSince < 1 ? blurCss(f, a.keyBlur) || undefined : undefined,
				});
			}
			C?.boxes.forEach((b, j) => {
				if (ws[after[j]!]!.since >= 0) drawWord(ctx, { box: placeBox(b, x0, yC + shift), fill: st.color });
			});
		});
	},
};
