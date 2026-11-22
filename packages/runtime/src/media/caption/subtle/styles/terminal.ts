/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { drawWord, dropShadow, f30, monoAdvance, textWidth, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// Green monospace typed a character at a time behind a blinking block cursor; a key word in inverse video.

export const terminal: SubtleStyle = {
	style: {
		font: { family: 'Courier Prime', weight: 700 },
		case: 'lower',
		size: 3.9,
		wideScale: 1.5,
		lineHeight: 1.45,
		letterSpacing: 0,
		color: '#35E066',
		activeColor: '#35E066',
		shadow: null,
		emphasis: { fill: '#35E066', color: '#06140A' },
		position: { y: 63, marginX: 8 },
		page: { maxWords: 6, maxCharsPerLine: 24, maxCharsPerLineWide: 44, maxLines: 2, minFrames: 18, maxFrames: 120, gapBreakMs: 400 },
		anim: { cps: 18, blink: 6 },
	},
	layout: () => ({ align: 'left' }),
	paint: ({ ctx, st, f, page, L, ws, frame }) => {
		const a = st.anim;
		const e = st.emphasis ?? {};
		const step = f.fps / a.cps;
		const shown = L.words.map(() => 0);
		let prev = -Infinity;
		let last = -1;
		L.words.forEach((box, wi) => {
			for (let k = 0; k < box.text.length; k++) {
				const t = Math.max(ws[wi]!.startF, prev + step);
				prev = t;
				if (frame >= t - 1e-6) {
					shown[wi]!++;
					last = wi;
				}
			}
		});
		const cw = Math.max(0, last);
		const cb = L.words[cw]!;
		const adv = monoAdvance(cb.font, cb.fs);
		const onHot = page.words[cw]!.emphasis && shown[cw]! > 0;
		const cx = cb.left + (shown[cw] ? textWidth(cb.text.slice(0, shown[cw]), cb.font, cb.fs, cb.ls) : 0) + (onHot ? adv * 0.18 : 0);
		const cyc = f30(a.blink, f.fps);
		const blink = 0.75 + 0.25 * Math.cos((2 * Math.PI * (frame % (cyc * 2))) / (cyc * 2));

		withPose(ctx, { filter: dropShadow(f, 0, 0, 5, 'rgba(0,0,0,0.75)') }, () => {
			L.words.forEach((box, i) => {
				if (!shown[i]) return;
				const text = box.text.slice(0, shown[i]);
				const word = page.words[i]!;
				if (!word.emphasis) {
					drawWord(ctx, { box, fill: st.color, text });
					return;
				}
				const over = box.fs * 0.1;
				ctx.fillStyle = word.color ?? e.fill ?? st.color;
				ctx.fillRect(box.left - over, box.baseline - box.fs * 0.86, textWidth(text, box.font, box.fs, box.ls) + 2 * over, box.fs * 1.12);
				drawWord(ctx, { box, fill: e.color ?? '#06140A', text });
			});
			ctx.globalAlpha *= blink;
			ctx.fillStyle = st.activeColor!;
			ctx.fillRect(cx + adv * 0.04, cb.baseline - cb.fs * 0.8, adv * 0.92, cb.fs * 1.02);
		});
	},
};
