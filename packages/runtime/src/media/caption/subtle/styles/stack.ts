/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { capHeight, clamp01, dropShadow, easeOut, f30, mix, px, setFont, textWidth } from '../engine';

import type { SubtleStyle } from '../style';

// A tilted pile of words, each its own size and angle, key words yellow; alternate pages mirror the pile.

const SIZE = [0.85, 1.0, 1.2, 0.9, 1.1, 0.95];
const ROT = [-9, 5, -12, 7, -6, 8];
const SHIFT = [0, 0.16, 0.04, 0.2, 0.08, 0.22];

export const stack: SubtleStyle = {
	style: {
		font: { family: 'Montserrat', weight: 900 },
		case: 'sentence',
		size: 4.9,
		wideScale: 1.1,
		lineHeight: 1.1,
		letterSpacing: -0.02,
		color: '#FFFFFF',
		activeColor: '#FFE500',
		shadow: null,
		position: { y: 52, marginX: 6 },
		page: { maxWords: 6, maxCharsPerLine: 40, maxCharsPerLineWide: 60, maxLines: 1, minFrames: 18, maxFrames: 100, gapBreakMs: 350 },
		anim: { keyScale: 1.45, pileWidth: 50, pitch: 1.08, popIn: 2, popFrom: 1.3, stroke: 3, shadowY: 4 },
	},
	paint: ({ ctx, st, f, page, pageIndex, L, ws }) => {
		const a = st.anim;
		const mirror = pageIndex % 2 ? -1 : 1;
		const font = st.font;
		const ls = st.letterSpacing ?? 0;
		const text = L.words.map((b) => b.text);
		const hot = page.words.map((w) => w.emphasis);
		const maxW = f.W * (a.pileWidth / 100);
		let fs = text.map((_, i) => L.fs * (hot[i] ? a.keyScale : SIZE[i % 6]!));
		const w0 = text.map((t, i) => textWidth(t, font, fs[i]!, ls));
		const k = Math.min(1, maxW / Math.max(...w0));
		fs = fs.map((v) => v * k);
		const w = w0.map((v) => v * k);
		const cap = fs.map((v) => capHeight(font) * v);
		const total = cap.reduce((s, c) => s + c * a.pitch, 0);
		const edge = (f.W * st.position.marginX) / 100;
		const dur = f30(a.popIn, f.fps);
		const sw = px(f, a.stroke);
		let y = (f.H * st.position.y) / 100 - total / 2;
		text.forEach((t, i) => {
			const cy = y + (cap[i]! * a.pitch) / 2;
			y += cap[i]! * a.pitch;
			if (ws[i]!.since < 0) return;
			const sh = Math.min(SHIFT[i % 6]! * maxW, Math.max(0, maxW - w[i]!));
			const cx = mirror > 0 ? edge + w[i]! / 2 + sh : f.W - edge - w[i]! / 2 - sh;
			const scale = mix(a.popFrom, 1, easeOut(clamp01((ws[i]!.since + 1) / (dur + 1))));
			const x = -w[i]! / 2;
			const base = cap[i]! / 2;
			ctx.save();
			ctx.translate(cx, cy);
			ctx.rotate((mirror * ROT[i % 6]! * Math.PI) / 180);
			ctx.scale(scale, scale);
			if (hot[i]) ctx.filter = dropShadow(f, 0, 0, 12, 'rgba(255,255,255,0.3)');
			setFont(ctx, font, fs[i]!, ls);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
			ctx.lineJoin = 'round';
			ctx.lineWidth = sw;
			ctx.fillStyle = ctx.strokeStyle = 'rgba(0,0,0,0.72)';
			ctx.strokeText(t, x + px(f, 2.5), base + px(f, a.shadowY));
			ctx.fillText(t, x + px(f, 2.5), base + px(f, a.shadowY));
			ctx.strokeStyle = '#000';
			ctx.strokeText(t, x, base);
			ctx.fillStyle = hot[i] ? page.words[i]!.color ?? st.activeColor! : st.color;
			ctx.fillText(t, x, base);
			ctx.restore();
		});
	},
};
