/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { applyCase, baseFontSize, capHeight, fitRun, styleShadow, titleCase, withPose } from '../engine';
import { paintText } from './kit-b';

import type { SubtleStyle } from '../style';

// One small condensed serif word at a time in acid yellow, hard cuts, no box; a key word turns italic and lighter.

export const haiku: SubtleStyle = {
	style: {
		font: { family: 'Instrument Serif', weight: 400 },
		case: 'sentence',
		size: 6.8,
		wideScale: 1.6,
		lineHeight: 1.2,
		letterSpacing: -0.02,
		color: '#F4EF36',
		shadow: { x: 0, y: 0.15, blur: 1.0, color: 'rgba(0,0,0,0.75)' },
		emphasis: { font: { family: 'Instrument Serif', weight: 400, italic: true }, color: '#FFF65A', scale: 1.2 },
		position: { x: 50, y: 72, marginX: 10 },
		page: { maxLines: 1, minFrames: 6, maxFrames: 45, gapBreakMs: 250, maxWords: 1, maxCharsPerLine: 20, maxCharsPerLineWide: 30 },
		anim: { stroke: 0.075, bold: 0.016 },
	},
	paint: ({ ctx, st, f, page, t, frame }) => {
		const e = st.emphasis ?? {};
		let i = 0;
		t.wordS.forEach((s, j) => {
			if (frame >= s) i = j;
		});
		const word = page.words[i]!;
		const hot = word.emphasis;
		const font = hot ? e.font ?? st.font : st.font;
		const base = baseFontSize(st.size, st, f) * (hot ? e.scale ?? 1 : 1);
		const avail = f.W * (1 - (2 * st.position.marginX) / 100);
		const run = fitRun([titleCase(applyCase(word.text, st.case))], font, base, { ls: st.letterSpacing, maxW: avail });
		const box = run.boxes[0]!;
		const x = (f.W * (st.position.x ?? 50)) / 100 - run.w / 2;
		const y = (f.H * st.position.y) / 100 + (capHeight(font) * run.fs) / 2;
		const fill = hot ? word.color ?? e.color ?? st.color : word.color ?? st.color;
		withPose(ctx, { filter: styleShadow(st, f) }, () => {
			paintText(ctx, box.text, x, y, { font, fs: run.fs, ls: box.ls, fill, stroke: '#1B1905', strokeWidth: run.fs * (st.anim.stroke ?? 0.045) });
			// The serif is hairline thin: a thin stroke in its own colour thickens it.
			if (st.anim.bold) paintText(ctx, box.text, x, y, { font, fs: run.fs, ls: box.ls, fill, stroke: fill, strokeWidth: run.fs * st.anim.bold, strokeOver: true });
		});
	},
};
