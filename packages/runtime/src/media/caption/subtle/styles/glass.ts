/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { baseFontSize, blockBox, colorMix, drawContainer, drawWord, easeOut, f30, fadeIn, fadeOut, mix, styleShadow, withPose } from '../engine';

import type { SubtleStyle } from '../style';

// One frosted-glass pill per page in soft lowercase; upcoming words are dim and brighten as they are said.

export const glass: SubtleStyle = {
	style: {
		font: { family: 'Inter', weight: 500 },
		case: 'lower',
		size: 3.7,
		wideScale: 1.35,
		lineHeight: 1.28,
		letterSpacing: -0.005,
		color: '#F4EFF1',
		shadow: { x: 0, y: 0.1, blur: 0.3, color: 'rgba(0,0,0,0.18)' },
		backdropBlur: 20,
		container: { kind: 'pill', fill: 'rgba(86,80,78,0.46)', highlight: 'rgba(255,255,255,0.55)', padX: 0.9, padY: 0.62, radius: 0.7 },
		emphasis: { color: '#FFC46B', font: { family: 'Inter', weight: 600 } },
		position: { y: 74, marginX: 9 },
		page: { maxWords: 6, maxCharsPerLine: 24, maxCharsPerLineWide: 44, maxLines: 2, minFrames: 18, maxFrames: 120, gapBreakMs: 400 },
		anim: { pageIn: 3, pageOut: 3, pageScaleFrom: 0.96, wordIn: 3, dim: 0.38 },
	},
	spec: (page, st) => page.words.map((w) => (w.emphasis && st.emphasis?.font ? { font: st.emphasis.font } : {})),
	layout: (st, f) => ({ padX: st.container!.padX * baseFontSize(st.size, st, f) }),
	paint: ({ ctx, st, f, page, L, ws, since, left }) => {
		const a = st.anim;
		const c = st.container!;
		const box = blockBox(L, c.padX * L.fs, c.padY * L.fs);
		const opacity = Math.min(fadeIn(since, f30(a.pageIn, f.fps)).opacity, fadeOut(left, f30(a.pageOut, f.fps)));
		const scale = mix(a.pageScaleFrom, 1, easeOut((since + 1) / (f30(a.pageIn, f.fps) + 1)));
		drawContainer(ctx, {
			kind: 'pill', box, f, radius: c.radius * L.fs, fill: c.fill, highlight: c.highlight, opacity, scale, backdrop: st.backdropBlur ?? 0,
		});
		withPose(ctx, { ox: box.x + box.w / 2, oy: box.y + box.h / 2, scale, opacity, filter: styleShadow(st, f) }, () => {
			L.words.forEach((b, i) => {
				const s = ws[i]!.since;
				const k = s < 0 ? 0 : easeOut((s + 1) / (f30(a.wordIn, f.fps) + 1));
				const word = page.words[i]!;
				const hot = word.color ?? st.emphasis?.color ?? st.color;
				drawWord(ctx, { box: b, fill: word.emphasis ? colorMix(k, st.color, hot) : st.color, opacity: mix(a.dim, 1, k) });
			});
		});
	},
};
