/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { activeSegment, applyCase, baseFontSize, capHeight, drawWord, fitRun, placeBox, segmentsOf } from '../engine';

import type { SubtleStyle } from '../style';

// A hard-edged black label tight round the words, tilted differently each page; a key word gets a big label alone.

const TILT = [-3, 2.5, -1.5, 4, -2, 3, -0.5, 1.5, -2.5, 3.5];

export const ticket: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 700 },
		case: 'sentence',
		size: 3.6,
		wideScale: 1.5,
		lineHeight: 1.2,
		letterSpacing: -0.01,
		color: '#FFFFFF',
		shadow: null,
		container: { fill: '#000000', padX: 0.22, padY: 0.24 },
		emphasis: { color: '#F60069', scale: 1.7 },
		position: { x: 50, y: 65, marginX: 8 },
		page: { maxLines: 1, minFrames: 10, maxFrames: 80, gapBreakMs: 350, maxWords: 4, maxCharsPerLine: 22, maxCharsPerLineWide: 36 },
		anim: {},
	},
	paint: ({ ctx, st, f, page, pageIndex, t, frame }) => {
		const c = st.container!;
		const e = st.emphasis ?? {};
		const segs = segmentsOf(page);
		const k = activeSegment(segs, t.wordS, frame);
		const seg = segs[k]!;
		const avail = f.W * (1 - (2 * st.position.marginX) / 100);
		const base = baseFontSize(st.size, st, f) * (seg.hot ? e.scale ?? 1.7 : 1);
		const texts = seg.idx.map((i) => applyCase(page.words[i]!.text, st.case));
		const run = fitRun(texts, st.font, base, { ls: st.letterSpacing, maxW: avail - 2 * c.padX * base - 0.04 * f.W });
		const cap = capHeight(st.font) * run.fs;
		const lw = run.w + 2 * c.padX * run.fs;
		const lh = cap + 2 * c.padY * run.fs;
		const fill = seg.hot ? page.words[seg.idx[0]!]!.color ?? e.color ?? st.color : st.color;
		ctx.save();
		ctx.translate((f.W * (st.position.x ?? 50)) / 100, (f.H * st.position.y) / 100);
		ctx.rotate((TILT[(pageIndex * 3 + k) % TILT.length]! * Math.PI) / 180);
		ctx.fillStyle = c.fill;
		ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
		for (const b of run.boxes) drawWord(ctx, { box: placeBox(b, -run.w / 2, cap / 2), fill });
		ctx.restore();
	},
};
