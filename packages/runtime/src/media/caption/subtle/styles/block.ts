/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { baseFontSize, blurCss, clamp01, colorMix, drawWord, dropShadow, easeOut, easeOutBack, f30, joinFilters, px, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Each line in its own warm block with depth; lines rise in with motion blur and pile up as a stack.

export const block: SubtleStyle = {
	style: {
		font: { family: 'Montserrat', weight: 800 },
		case: 'upper',
		size: 4.3,
		wideScale: 1.2,
		lineHeight: 1.3,
		letterSpacing: 0.01,
		color: '#FDFCF9',
		shadow: null,
		container: { kind: 'block', fill: '#FB7207', padX: 0.38, height: 1.18, radius: 4, align: 'right' },
		emphasis: { fill: '#17171B' },
		position: { y: 19, marginX: 5 },
		page: { maxWords: 6, maxCharsPerLine: 14, maxCharsPerLineWide: 22, maxLines: 3, minFrames: 20, maxFrames: 110, gapBreakMs: 350 },
		anim: { lineIn: 5, rise: 26, blur: 7, pageOut: 3, exitDrop: 34 },
	},
	layout: (st, f) => ({ padX: st.container!.padX * baseFontSize(st.size, st, f) }),
	paint: ({ ctx, st, f, page, L, ws, left }) => {
		const a = st.anim;
		const c = st.container!;
		const padX = c.padX * L.fs;
		const h = c.height * L.fs;
		const r = px(f, c.radius ?? 4);
		const dur = f30(a.lineIn, f.fps);
		const outK = clamp01(left / f30(a.pageOut, f.fps));
		const drop = 1 - easeOut(outK);
		const mx = (f.W * st.position.marginX) / 100;
		for (const ln of L.lines) {
			const since = ws[ln.idx[0]!]!.since;
			if (since < 0) continue;
			const bw = ln.w + 2 * padX;
			const bx = c.align === 'left' ? mx : c.align === 'center' ? f.W / 2 - bw / 2 : f.W - mx - bw;
			const shift = bx + padX - ln.left;
			const p = clamp01((since + 1) / (dur + 1));
			const rise = px(f, a.rise) * (1 - easeOutBack(p, 1.5));
			const blur = blurCss(f, a.blur * Math.pow(1 - p, 1.4));
			const hot = ln.idx.map((i) => page.words[i]!).find((w) => w.emphasis);
			const fill = hot ? hot.color ?? st.emphasis?.fill ?? c.fill : c.fill;
			const by = ln.y - h / 2;
			withPose(ctx, { dy: rise + px(f, a.exitDrop) * drop, opacity: Math.min(clamp01(p * 3), outK) }, () => {
				withPose(ctx, { filter: joinFilters(dropShadow(f, 0, 3, 8, 'rgba(0,0,0,0.38)'), blur) }, () => {
					const body = ctx.createLinearGradient(0, by, 0, by + h);
					body.addColorStop(0, colorMix(0.2, fill, '#ffffff'));
					body.addColorStop(0.55, fill);
					body.addColorStop(1, colorMix(0.18, fill, '#000000'));
					ctx.beginPath();
					ctx.roundRect(bx, by, bw, h, r);
					ctx.fillStyle = body;
					ctx.fill();
				});
				withPose(ctx, { filter: blur || undefined }, () => {
					const edge = ctx.createLinearGradient(0, by, 0, by + h);
					edge.addColorStop(0, 'rgba(255,255,255,0.7)');
					edge.addColorStop(0.35, 'rgba(255,255,255,0)');
					edge.addColorStop(1, 'rgba(0,0,0,0.18)');
					ctx.beginPath();
					ctx.roundRect(bx + 0.5, by + 0.5, bw - 1, h - 1, r);
					ctx.lineWidth = Math.max(1, px(f, 1.3));
					ctx.strokeStyle = edge;
					ctx.stroke();
				});
				const text = joinFilters(dropShadow(f, 0, 1.4, 2, 'rgba(110,40,0,0.35)'), blur);
				for (const i of ln.idx) {
					const box = L.words[i]!;
					drawWord(ctx, { box: { ...box, left: box.left + shift, cx: box.cx + shift }, fill: st.color, filter: text });
				}
			});
		}
	},
};
