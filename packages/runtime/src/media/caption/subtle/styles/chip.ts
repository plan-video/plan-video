/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { baseFontSize, blockBox, clamp01, colorMix, drawContainer, drawWord, dropShadow, easeOutBack, f30, fadeIn, fadeOut, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// A light rounded chip hugging the page; words turn grey to black as they are said, a key word gets a dark chip of its own.

export const chip: SubtleStyle = {
	style: {
		font: { family: 'Poppins', weight: 600 },
		case: 'lower',
		size: 3.4,
		wideScale: 1.4,
		lineHeight: 1.25,
		letterSpacing: 0,
		color: '#111111',
		dimColor: '#8E8E93',
		shadow: null,
		backdropBlur: 8,
		container: { kind: 'chip', fill: 'rgba(229,227,231,0.88)', padX: 0.95, padY: 0.5, radius: 0.28 },
		emphasis: { fill: '#141414', color: '#F6F6F4', padX: 0.3, chipHeight: 1.42, chipIn: 4 },
		position: { y: 75, marginX: 9 },
		page: { maxWords: 3, maxCharsPerLine: 18, maxCharsPerLineWide: 30, maxLines: 1, minFrames: 14, maxFrames: 90, gapBreakMs: 350 },
		anim: { pageIn: 2, pageOut: 1, wordIn: 2 },
	},
	// Room beside a key word for its chip, so it never touches its neighbours.
	spec: (page, st) => {
		const room = (st.emphasis?.padX ?? 0.3) * 0.75;
		return page.words.map((w, i) => {
			const next = page.words[i + 1];
			const pad = (w.emphasis && next ? room : 0) + (next?.emphasis ? room : 0);
			return pad ? { pad } : {};
		});
	},
	layout: (st, f) => ({ padX: st.container!.padX * baseFontSize(st.size, st, f) }),
	paint: ({ ctx, st, f, page, L, ws, since, left }) => {
		const a = st.anim;
		const c = st.container!;
		const e = st.emphasis ?? {};
		const box = blockBox(L, c.padX * L.fs, c.padY * L.fs);
		const opacity = Math.min(fadeIn(since, f30(a.pageIn, f.fps)).opacity, fadeOut(left, f30(a.pageOut, f.fps)));
		drawContainer(ctx, {
			kind: 'chip', box, f, radius: c.radius * box.h, fill: c.fill, opacity, backdrop: st.backdropBlur ?? 0,
			shadow: dropShadow(f, 0, 4, 14, 'rgba(0,0,0,0.15)'),
		});
		withPose(ctx, { opacity }, () => {
			L.words.forEach((b, i) => {
				const word = page.words[i]!;
				const s = ws[i]!.since;
				if (!word.emphasis) {
					const k = s < 0 ? 0 : (s + 1) / (f30(a.wordIn, f.fps) + 1);
					drawWord(ctx, { box: b, fill: colorMix(k, st.dimColor!, st.color) });
					return;
				}
				const p = s < 0 ? 0 : clamp01((s + 1) / (f30(e.chipIn ?? 4, f.fps) + 1));
				const h = b.fs * (e.chipHeight ?? 1.42);
				const padX = b.fs * (e.padX ?? 0.3);
				const cy = b.baseline - L.capH / 2;
				withPose(ctx, { ox: b.cx, oy: cy, scale: 0.88 + 0.12 * easeOutBack(p, 1.8), opacity: p, filter: dropShadow(f, 0, 2, 6, 'rgba(0,0,0,0.25)') }, () => {
					ctx.beginPath();
					ctx.roundRect(b.left - padX, cy - h / 2, b.w + 2 * padX, h, Math.min(h * 0.28, b.fs * 0.4));
					ctx.fillStyle = word.color ?? e.fill ?? '#141414';
					ctx.fill();
				});
				drawWord(ctx, { box: b, fill: colorMix(p, st.dimColor!, e.color ?? '#F6F6F4') });
			});
		});
	},
};
