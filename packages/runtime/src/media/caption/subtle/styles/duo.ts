/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { applyCase, baseFontSize, capHeight, drawWord, f30, fadeIn, fadeOut, fitRun, placeBox, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// A big condensed caps headline word, a tiny spaced-out lead-in above it and a bold italic tail below.

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').length;

export const duo: SubtleStyle = {
	style: {
		font: { family: 'Anton', weight: 400 },
		case: 'upper',
		size: 10.5,
		wideScale: 1.2,
		lineHeight: 1.1,
		letterSpacing: 0.005,
		color: '#E8E22E',
		shadow: { x: 0, y: 0.3, blur: 1.2, color: 'rgba(0,0,0,0.4)' },
		position: { x: 50, y: 68, marginX: 6 },
		page: { maxLines: 1, minFrames: 14, maxFrames: 75, gapBreakMs: 350, maxWords: 4, maxCharsPerLine: 26, maxCharsPerLineWide: 40 },
		anim: {
			leadFont: { family: 'Inter', weight: 500 },
			tailFont: { family: 'Poppins', weight: 600, italic: true },
			leadSize: 1.5,
			tailSize: 2.8,
			leadTrack: 0.22,
			softColor: 'rgba(255,255,255,0.88)',
			leadIn: 4,
			tailIn: 6,
			pageOut: 4,
		},
	},
	paint: ({ ctx, st, f, page, t, frame, ws, left }) => {
		const a = st.anim;
		const n = page.words.length;
		let h = page.words.findIndex((w) => w.emphasis);
		if (h < 0) h = page.words.reduce((best, w, i) => (letters(w.text) >= letters(page.words[best]!.text) ? i : best), 0);
		const avail = f.W * (1 - (2 * st.position.marginX) / 100);
		const cx = (f.W * (st.position.x ?? 50)) / 100;
		const cy = (f.H * st.position.y) / 100;
		const fsHero = baseFontSize(st.size, st, f);
		const heroWord = page.words[h]!;
		const hero = fitRun([applyCase(heroWord.text, 'upper')], st.font, fsHero, { ls: st.letterSpacing, maxW: avail });
		const capH = capHeight(st.font) * hero.fs;
		const base = cy + capH / 2;
		const k = hero.fs / fsHero;
		const leadIdx = Array.from({ length: h }, (_, i) => i);
		const tailIdx = Array.from({ length: n - h - 1 }, (_, i) => h + 1 + i);
		const lead = leadIdx.length
			? fitRun(leadIdx.map((i) => applyCase(page.words[i]!.text, 'upper')), a.leadFont, baseFontSize(a.leadSize, st, f) * k, { ls: a.leadTrack, gap: 1.8, maxW: avail })
			: null;
		const tail = tailIdx.length
			? fitRun(tailIdx.map((i) => applyCase(page.words[i]!.text, 'lower')), a.tailFont, baseFontSize(a.tailSize, st, f) * k, { ls: 0, maxW: avail })
			: null;
		withPose(ctx, { opacity: fadeOut(left, f30(a.pageOut, f.fps)), filter: styleShadow(st, f) }, () => {
			if (lead) {
				withPose(ctx, { opacity: fadeIn(ws[leadIdx[0]!]!.since, f30(a.leadIn, f.fps)).opacity }, () => {
					for (const b of lead.boxes) drawWord(ctx, { box: placeBox(b, cx - lead.w / 2, base - capH - 0.2 * hero.fs), fill: a.softColor });
				});
			}
			if (frame >= t.wordS[h]!) drawWord(ctx, { box: placeBox(hero.boxes[0]!, cx - hero.w / 2, base), fill: heroWord.color ?? st.color });
			if (tail) {
				withPose(ctx, { opacity: fadeIn(ws[tailIdx[0]!]!.since, f30(a.tailIn, f.fps)).opacity }, () => {
					const y = base + 0.22 * hero.fs + capHeight(a.tailFont) * tail.fs;
					for (const b of tail.boxes) drawWord(ctx, { box: placeBox(b, cx - tail.w / 2, y), fill: a.softColor });
				});
			}
		});
	},
};
