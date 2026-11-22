/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { activeSegment, applyCase, baseFontSize, capHeight, clamp01, drawWord, f30, fitRun, placeBox, segmentsOf, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Bold caps with one flat box behind the word being said, hopping word to word; said words turn lime, a key word comes alone and large.

export const hop: SubtleStyle = {
	style: {
		font: { family: 'Montserrat', weight: 800 },
		case: 'upper',
		size: 3.8,
		wideScale: 1.5,
		lineHeight: 1.2,
		letterSpacing: 0,
		color: '#FFFFFF',
		activeColor: '#5A12D0',
		shadow: { x: 0, y: 0.15, blur: 0.7, color: 'rgba(0,0,0,0.55)' },
		emphasis: { color: '#45F715', scale: 1.9 },
		position: { x: 50, y: 56, marginX: 8 },
		page: { maxLines: 1, minFrames: 10, maxFrames: 80, gapBreakMs: 350, maxWords: 4, maxCharsPerLine: 24, maxCharsPerLineWide: 40 },
		anim: { padX: 0.16, padY: 0.26, gap: 1.45, handoff: 2 },
	},
	paint: ({ ctx, st, f, page, t, frame, ws }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const segs = segmentsOf(page);
		const seg = segs[activeSegment(segs, t.wordS, frame)]!;
		const avail = f.W * (1 - (2 * st.position.marginX) / 100);
		const base = baseFontSize(st.size, st, f) * (seg.hot ? e.scale ?? 1.9 : 1);
		const padX = a.padX * base;
		const texts = seg.idx.map((i) => applyCase(page.words[i]!.text, st.case));
		const run = fitRun(texts, st.font, base, { ls: st.letterSpacing, gap: a.gap, maxW: avail - 2 * padX });
		const cap = capHeight(st.font) * run.fs;
		const bh = cap + 2 * a.padY * run.fs;
		const cx = (f.W * (st.position.x ?? 50)) / 100;
		const cy = (f.H * st.position.y) / 100;
		const hand = f30(a.handoff, f.fps);
		run.boxes.forEach((b, j) => {
			const s = ws[seg.idx[j]!]!;
			const inK = s.since < 0 ? 0 : clamp01((s.since + 1) / (hand + 1));
			const outK = s.until > 0 ? 1 : clamp01(1 - (-s.until + 1) / (hand + 1));
			const opacity = Math.min(inK, outK);
			if (opacity <= 0.001) return;
			withPose(ctx, { opacity }, () => {
				ctx.fillStyle = st.activeColor!;
				ctx.fillRect(cx - run.w / 2 + b.left - padX, cy - bh / 2, b.w + 2 * padX, bh);
			});
		});
		withPose(ctx, { filter: styleShadow(st, f) }, () => {
			run.boxes.forEach((b, j) => {
				const i = seg.idx[j]!;
				const lime = seg.hot || ws[i]!.state === 'spoken';
				const word = page.words[i]!;
				drawWord(ctx, { box: placeBox(b, cx - run.w / 2, cy + cap / 2), fill: lime ? word.color ?? e.color ?? st.color : st.color });
			});
		});
	},
};
