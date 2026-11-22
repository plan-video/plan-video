/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { clamp01, easeOut, easeOutBack, f30, mix, px, textWidth, withPose } from '../engine';
import { paintText } from './kit-b';

import type { SubtleStyle } from '../style';

// Heavy round caps whose letters bounce in one by one along an arc, with a thick outline and a hard offset shadow.

export const impact: SubtleStyle = {
	style: {
		font: { family: 'Poppins', weight: 900 },
		case: 'upper',
		size: 6.4,
		wideScale: 1.1,
		lineHeight: 1.12,
		letterSpacing: -0.02,
		color: '#FFFFFF',
		activeColor: '#FEFA1D',
		shadow: null,
		position: { y: 70, marginX: 8 },
		page: { maxWords: 5, maxCharsPerLine: 12, maxCharsPerLineWide: 22, maxLines: 2, minFrames: 14, maxFrames: 80, gapBreakMs: 300 },
		anim: { letterIn: 5, stagger: 1, scaleFrom: 0.4, rotate: -10, rise: 46, arc: 14, drift: 10, stroke: 6, strokeColor: '#000000', shadowY: 4.5, shadowColor: '#000000' },
	},
	layout: () => ({ align: 'left' }),
	paint: ({ ctx, st, f, page, L, ws }) => {
		const a = st.anim;
		const dur = f30(a.letterIn, f.fps);
		const stagger = Math.max(1, f30(a.stagger, f.fps));
		const sw = px(f, a.stroke);
		L.words.forEach((box, i) => {
			const word = page.words[i]!;
			const fill = word.emphasis ? word.color ?? st.activeColor! : st.color;
			const chars = [...box.text];
			chars.forEach((ch, j) => {
				const since = ws[i]!.since - j * stagger;
				if (since < 0) return;
				const k = clamp01((since + 1) / (dur + 1));
				const e = easeOut(k);
				const x = box.left + (j ? textWidth(chars.slice(0, j).join(''), box.font, box.fs, box.ls) : 0);
				const w = textWidth(ch, box.font, box.fs, box.ls);
				const ox = x + w / 2;
				const oy = box.baseline - box.fs * 0.34;
				const pose = {
					ox,
					oy,
					scale: mix(a.scaleFrom, 1, easeOutBack(k, 2.4)),
					rotate: a.rotate * (1 - e) * (j % 2 ? 0.6 : 1),
					dx: -px(f, a.drift) * (1 - e),
					dy: px(f, a.rise) * (1 - e) - Math.sin(Math.PI * k) * px(f, a.arc),
					opacity: clamp01((since + 1) / 2),
				};
				withPose(ctx, pose, () => {
					const text = { font: box.font, fs: box.fs, ls: box.ls };
					paintText(ctx, ch, x, box.baseline + px(f, a.shadowY), { ...text, fill: a.shadowColor, stroke: a.shadowColor, strokeWidth: sw });
					paintText(ctx, ch, x, box.baseline, { ...text, fill, stroke: a.strokeColor, strokeWidth: sw });
				});
			});
		});
	},
};
