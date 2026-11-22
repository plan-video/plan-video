/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { capHeight, colorMix, drawWord, easeOutBack, f30, fadeOut, styleShadow, textWidth, withPose } from '../engine';

import type { Ctx, WordBox } from '../engine';
import type { SubtleStyle } from '../style';

// Every letter flips in like a split-flap tile, turning edge-on and settling upright with a motion-blur trail.

function letter(ctx: Ctx, ch: string, box: WordBox, x: number, p: number, fill: string, shade: string, trail: number, capH: number): void {
	if (p <= 0) return;
	const cy = box.baseline - capH / 2;
	const one = (pp: number, opacity: number) => {
		const th = (Math.PI * 150 * (1 - Math.min(1, Math.max(0, pp)))) / 180;
		const sy = Math.cos(th);
		const turned = 1 - Math.abs(sy);
		withPose(ctx, { ox: 0, oy: cy, sy: Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy, opacity }, () => {
			drawWord(ctx, { box: { ...box, left: x, ls: 0 }, text: ch, fill: colorMix(turned * 0.65, fill, shade) });
		});
	};
	if (p < 1) {
		one(p - trail * 2, 0.16);
		one(p - trail, 0.3);
	}
	one(p, 1);
}

export const flip: SubtleStyle = {
	style: {
		font: { family: 'Montserrat', weight: 800 },
		case: 'lower',
		size: 4.4,
		wideScale: 1.3,
		lineHeight: 1.25,
		letterSpacing: 0,
		color: '#FFFFFF',
		shadow: { x: 0, y: 0.18, blur: 1.2, color: 'rgba(0,0,0,0.5)' },
		emphasis: { color: '#FFE066' },
		position: { y: 68, marginX: 8 },
		page: { maxWords: 4, maxCharsPerLine: 17, maxCharsPerLineWide: 32, maxLines: 2, minFrames: 14, maxFrames: 90, gapBreakMs: 350 },
		anim: { letterIn: 9, stagger: 1.2, overshoot: 1.15, trail: 0.1, shade: '#1A1208', pageOut: 4 },
	},
	paint: ({ ctx, st, f, page, L, ws, left }) => {
		const a = st.anim;
		const dur = f30(a.letterIn, f.fps);
		const stagger = a.stagger * (f.fps / 30);
		withPose(ctx, { filter: styleShadow(st, f), opacity: fadeOut(left, f30(a.pageOut, f.fps)) }, () => {
			L.words.forEach((box, i) => {
				const capH = capHeight(box.font) * box.fs;
				const word = page.words[i]!;
				const fill = word.emphasis ? word.color ?? st.emphasis?.color ?? st.color : st.color;
				const since = ws[i]!.since;
				[...box.text].forEach((ch, k) => {
					const x = box.left + textWidth(box.text.slice(0, k), box.font, box.fs, box.ls);
					const t = (since - k * stagger + 1) / (dur + 1);
					letter(ctx, ch, box, x, since < 0 ? 0 : easeOutBack(t, a.overshoot), fill, a.shade, a.trail, capH);
				});
			});
		});
	},
};
