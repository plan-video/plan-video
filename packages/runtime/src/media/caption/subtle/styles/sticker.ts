/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { applyCase, baseFontSize, capHeight, drawWord, spaceWidth, textWidth } from '../engine';

import type { WordBox } from '../engine';
import type { SubtleStyle } from '../style';

// Pink rounded bubbles, one per line, each offset right of the last like typed messages; words turn white when said.

const TILT = [0.4, 1.3, 2.2, 3];

/** Greedy breaks by character budget; the last line takes the rest and never keeps one word alone when it can borrow. */
function breakWords(texts: string[], budget: number, maxLines: number): number[][] {
	const lines: number[][] = [[]];
	let len = 0;
	texts.forEach((t, i) => {
		const cur = lines[lines.length - 1]!;
		const next = len + (cur.length ? 1 : 0) + t.length;
		if (cur.length && next > budget && lines.length < maxLines) {
			lines.push([i]);
			len = t.length;
		} else {
			cur.push(i);
			len = next;
		}
	});
	const n = lines.length;
	if (n > 1 && lines[n - 1]!.length === 1 && lines[n - 2]!.length > 2) lines[n - 1]!.unshift(lines[n - 2]!.pop()!);
	return lines;
}

export const sticker: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 700 },
		case: 'sentence',
		size: 4.2,
		wideScale: 1.6,
		lineHeight: 1.3,
		letterSpacing: 0,
		color: '#FFFFFF',
		dimColor: 'rgba(27,30,29,0.85)',
		shadow: null,
		container: { fill: '#DC2C5B', padX: 0.5, height: 1.5, radius: 0.35, offset: 0.25 },
		emphasis: { fill: '#FF3F7F', scale: 1.2 },
		position: { x: 50, y: 62, marginX: 7 },
		page: { maxLines: 3, minFrames: 20, maxFrames: 150, gapBreakMs: 450, maxWords: 7, maxCharsPerLine: 12, maxCharsPerLineWide: 20 },
		anim: {},
	},
	paint: ({ ctx, st, f, page, pageIndex, ws }) => {
		const c = st.container!;
		const e = st.emphasis ?? {};
		const ls = st.letterSpacing ?? 0;
		const texts = page.words.map((w) => applyCase(w.text, st.case));
		const mult = page.words.map((w) => (w.emphasis ? e.scale ?? 1.2 : 1));
		const budget = (f.wide ? st.page.maxCharsPerLineWide : st.page.maxCharsPerLine) ?? 14;
		const groups = breakWords(texts, budget, Math.min(3, st.page.maxLines ?? 3));
		const avail = f.W * (1 - (2 * st.position.marginX) / 100);
		let fs = baseFontSize(st.size, st, f);
		const measure = (size: number) => groups.map((g) => {
			const widths = g.map((i) => textWidth(texts[i]!, st.font, size * mult[i]!, ls));
			const sp = spaceWidth(st.font, size, ls);
			return { widths, sp, w: widths.reduce((a, b) => a + b, 0) + sp * (g.length - 1) };
		});
		let m = measure(fs);
		const widest = Math.max(...m.map((x) => x.w)) + 2 * c.padX * fs;
		if (widest > avail) {
			fs *= (avail / widest) * 0.99;
			m = measure(fs);
		}
		const lh = fs * (st.lineHeight ?? 1.3);
		const cap = capHeight(st.font) * fs;
		const cy = (f.H * st.position.y) / 100;
		const top = cy - (lh * groups.length) / 2;
		const padX = c.padX * fs;
		const h = fs * (c.height ?? 1.45);
		const bw = m.map((x) => x.w + 2 * padX);
		const xs: number[] = [];
		bw.forEach((_, k) => xs.push(k === 0 ? 0 : xs[k - 1]! + c.offset * bw[k - 1]!));
		const hi = Math.max(...xs.map((x, k) => x + bw[k]!));
		const lo = Math.min(...xs);
		const mx = (f.W * st.position.marginX) / 100;
		const x0 = Math.min(f.W - mx - (hi - lo), Math.max(mx, (f.W * (st.position.x ?? 50)) / 100 - (hi - lo) / 2)) - lo;
		const cx = x0 + (lo + hi) / 2;

		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate((-TILT[pageIndex % TILT.length]! * Math.PI) / 180);
		ctx.translate(-cx, -cy);
		groups.forEach((g, k) => {
			if (ws[g[0]!]!.since < 0) return;
			const bx = x0 + xs[k]!;
			const hotWord = g.map((i) => page.words[i]!).find((w) => w.emphasis);
			const y = top + lh * (k + 0.5);
			ctx.beginPath();
			ctx.roundRect(bx, y - h / 2, bw[k]!, h, Math.min(h * c.radius, h / 2));
			ctx.fillStyle = hotWord ? hotWord.color ?? e.fill ?? c.fill : c.fill;
			ctx.fill();
			let x = bx + padX;
			g.forEach((i, j) => {
				const box: WordBox = { i, text: texts[i]!, font: st.font, fs: fs * mult[i]!, ls, left: x, w: m[k]!.widths[j]!, cx: x + m[k]!.widths[j]! / 2, line: k, baseline: y + cap / 2 };
				drawWord(ctx, { box, fill: ws[i]!.since >= 0 ? st.color : st.dimColor! });
				x += m[k]!.widths[j]! + m[k]!.sp;
			});
		});
		ctx.restore();
	},
};
