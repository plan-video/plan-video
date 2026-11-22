/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { baseFontSize, capHeight, clamp01, easeOut, f30, fadeOut, fitWord, mix, px, setFont, styleShadow, textWidth, withPose } from '../engine';

import type { Ctx } from '../engine';
import type { SubtleStyle } from '../style';

// A typed title whose letter spacing collapses as the letters land, with a small handwritten note under it.

const split = (n: number) => (n <= 1 ? n : Math.ceil(n / 2));

/** A small hand-drawn arrow curving down and right, about `s` tall, drawn on up to `p` of its length. */
function drawArrow(ctx: Ctx, x: number, y: number, s: number, p: number): void {
	const pts: [number, number][] = [];
	const [x1, y1, x2, y2, x3, y3] = [x - s * 0.1, y + s * 0.7, x + s * 0.3, y + s * 1.2, x + s * 1.0, y + s * 1.25];
	for (let i = 0; i <= 24; i++) {
		const t = i / 24;
		const u = 1 - t;
		pts.push([u ** 3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, u ** 3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3]);
	}
	const head: [number, number][] = [[x + s * 0.72, y + s * 1.0], [x + s * 1.02, y + s * 1.25], [x + s * 0.7, y + s * 1.45]];
	const len = (list: [number, number][]) => list.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[0] - list[i]![0], q[1] - list[i]![1]), 0);
	const total = len(pts) + len(head);
	ctx.beginPath();
	ctx.moveTo(...pts[0]!);
	for (const q of pts.slice(1)) ctx.lineTo(...q);
	ctx.moveTo(...head[0]!);
	for (const q of head.slice(1)) ctx.lineTo(...q);
	ctx.setLineDash([total * p, total]);
	ctx.stroke();
	ctx.setLineDash([]);
}

export const title: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 600 },
		noteFont: { family: 'Caveat', weight: 600 },
		case: 'sentence',
		size: 5.2,
		wideScale: 1.3,
		lineHeight: 1.2,
		letterSpacing: 0,
		color: '#FDFEFE',
		activeColor: '#FFFFFF',
		shadow: { x: 0, y: 0.22, blur: 0.9, color: 'rgba(0,0,0,0.5)' },
		emphasis: { color: '#FFC94D' },
		position: { y: 17, marginX: 8 },
		page: { maxWords: 4, maxCharsPerLine: 40, maxCharsPerLineWide: 60, maxLines: 1, minFrames: 30, maxFrames: 120, gapBreakMs: 450 },
		anim: { trackFrom: 0.5, typeMax: 18, noteTypeMax: 14, noteSize: 3.4, slideX: 4, pageOut: 5 },
	},
	minShow: 20,
	paint: ({ ctx, st, f, page, since, left }) => {
		const a = st.anim;
		const k = split(page.words.length);
		const accent = (i: number) => page.words[i]!.color ?? st.emphasis?.color ?? st.color;
		const head = page.words.slice(0, k);
		const title = head.map((w) => w.text).join(' ');
		const titleColor: (string | null)[] = head.flatMap((w, wi) => [...(wi ? [null] : []), ...[...w.text].map(() => (w.emphasis ? accent(wi) : null))]);
		const avail = f.W * (1 - (2 * st.position.marginX) / 100);
		const tf = fitWord(title, st.font, avail, baseFontSize(st.size, st, f));
		const nFont = st.noteFont!;
		const nfs = Math.min(baseFontSize(a.noteSize, st, f), tf.fs * 0.8);
		const left0 = (f.W * (st.position.x ?? 50)) / 100 - tf.w / 2;
		const baseline = (f.H * st.position.y) / 100 + (capHeight(st.font) * tf.fs) / 2;
		const frames = left + since;
		const tDur = Math.min(Math.max(8, 0.34 * frames), f30(a.typeMax, f.fps));
		const ls = mix(a.trackFrom, 0, easeOut(since / (tDur + f30(6, f.fps)))) * tf.fs;
		const fadeF = f30(2, f.fps);
		const chars = [...title];

		const nStart = tDur * 0.75 + f30(2, f.fps);
		const nDur = Math.min(Math.max(8, 0.4 * (frames - nStart)), f30(a.noteTypeMax, f.fps));
		const lines: string[] = [];
		const lineColor: (string | null)[][] = [];
		if (k < page.words.length) {
			const maxW = Math.min(avail - nfs * 1.8, Math.max(tf.w * 1.05, f.W * 0.4));
			let cur = '';
			let curColor: (string | null)[] = [];
			page.words.slice(k).forEach((pw, j) => {
				const w = pw.text.toLowerCase();
				const test = cur ? `${cur} ${w}` : w;
				if (cur && textWidth(test, nFont, nfs) > maxW) {
					lines.push(cur);
					lineColor.push(curColor);
					cur = w;
					curColor = [];
				} else {
					cur = test;
					if (curColor.length) curColor.push(null);
				}
				curColor.push(...[...w].map(() => (pw.emphasis ? accent(k + j) : null)));
			});
			lines.push(cur);
			lineColor.push(curColor);
		}
		const typed = Math.round(clamp01((since - nStart) / nDur) * lines.join('').length);
		const draw = clamp01((since - nStart + 1) / nDur);

		withPose(ctx, { opacity: fadeOut(left, f30(a.pageOut, f.fps)), filter: styleShadow(st, f) }, () => {
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
			chars.forEach((ch, j) => {
				const p = clamp01((since - (j * tDur) / chars.length + 1) / (fadeF + 1));
				if (p <= 0 || ch === ' ') return;
				const x = left0 + textWidth(title.slice(0, j), st.font, tf.fs) + j * ls + px(f, a.slideX) * (1 - easeOut(p));
				ctx.save();
				ctx.globalAlpha *= p;
				setFont(ctx, st.font, tf.fs);
				ctx.fillStyle = titleColor[j] ?? st.color;
				ctx.fillText(ch, x, baseline);
				ctx.restore();
			});
			if (!lines.length) return;
			if (draw > 0) {
				ctx.lineWidth = Math.max(1.5, nfs * 0.07);
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';
				ctx.strokeStyle = st.activeColor!;
				drawArrow(ctx, left0 + nfs * 0.1, baseline + tf.fs * 0.5, nfs, draw);
			}
			const nLeft = left0 + nfs * 1.7;
			const nBase = baseline + tf.fs * 0.55 + nfs * 1.1;
			let before = 0;
			lines.forEach((ln, li) => {
				const n = Math.max(0, Math.min(ln.length, typed - before));
				before += ln.length;
				let x = nLeft;
				setFont(ctx, nFont, nfs);
				for (let c = 0; c < n;) {
					const color = lineColor[li]![c] ?? null;
					let end = c + 1;
					while (end < n && (lineColor[li]![end] ?? null) === color) end++;
					const run = ln.slice(c, end);
					ctx.fillStyle = color ?? st.activeColor!;
					ctx.fillText(run, x, nBase + li * nfs * 1.05);
					x += ctx.measureText(run).width;
					c = end;
				}
			});
		});
	},
};
