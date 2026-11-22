/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	baseFontSize,
	blockBox,
	blurCss,
	clamp01,
	colorMix,
	drawContainer,
	drawWord,
	easeInOut,
	easeOut,
	easeOutBack,
	easeOutExpo,
	f30,
	mix,
	styleShadow,
	withPose,
} from '../engine';

import type { FontSpec, Frame, Style, WordSpec } from '../engine';
import type { PaintProps, SubtleStyle } from '../style';

// Subtle's data-driven style: everything comes from `anim.recipe`. Lengths are ems of the font size, frames at 30 fps.

type Plate = { kind: 'page' | 'line' | 'word'; color: string; radius: number; padX: number; padY: number; backdropBlur: number };

type Recipe = {
	unit: 'word' | 'line' | 'page';
	enter: { kind: string; frames: number; ease: string; distance: number; overshoot: number; stagger: number };
	exit: { kind: string; frames: number };
	upcoming: { opacity: number; color: string | null };
	active: { color: string | null; scale: number; opacity: number };
	spoken: { color: string | null; opacity: number };
	plate: Plate | null;
	stroke: { width: number; color: string } | null;
	emphasis: { color: string | null; scale: number; font: FontSpec | null };
	align: 'center' | 'left';
};

/** A recipe's own keys, any of which may be left to the defaults. */
export type RecipeSpec = {
	unit?: Recipe['unit'];
	enter?: Partial<Recipe['enter']>;
	exit?: Partial<Recipe['exit']>;
	upcoming?: Partial<Recipe['upcoming']>;
	active?: Partial<Recipe['active']>;
	spoken?: Partial<Recipe['spoken']>;
	plate?: Partial<Plate>;
	stroke?: Recipe['stroke'];
	emphasis?: Partial<Recipe['emphasis']>;
	align?: Recipe['align'];
};

const PLATE: Plate = { kind: 'page', color: 'rgba(0,0,0,0.6)', radius: 0.3, padX: 0.4, padY: 0.15, backdropBlur: 0 };

function recipeOf(st: Style): Recipe {
	const r = (st.anim.recipe ?? {}) as RecipeSpec;
	return {
		unit: r.unit ?? 'word',
		enter: { kind: 'fade', frames: 6, ease: 'out-cubic', distance: 0.4, overshoot: 1.12, stagger: 0, ...r.enter },
		exit: { kind: 'cut', frames: 4, ...r.exit },
		upcoming: { opacity: 0, color: null, ...r.upcoming },
		active: { color: null, scale: 1, opacity: 1, ...r.active },
		spoken: { color: null, opacity: 1, ...r.spoken },
		plate: r.plate ? { ...PLATE, ...r.plate } : null,
		stroke: r.stroke ?? null,
		emphasis: { color: null, scale: 1, font: null, ...r.emphasis },
		align: r.align ?? 'center',
	};
}

const ease = (name: string, t: number) =>
	name === 'out-back' ? easeOutBack(t, 1.5) : name === 'out-expo' ? easeOutExpo(t) : name === 'linear' ? clamp01(t) : easeOut(t);

type Fx = { opacity: number; dx: number; dy: number; scale: number; blur: number };
const IDENT: Fx = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0 };

/** One unit's entrance, `c` frames after its clock started (negative: not yet). */
function enterFx(e: Recipe['enter'], c: number, f: Frame, fs: number): Fx {
	if (c < 0) return { ...IDENT, opacity: 0 };
	const dur = f30(e.frames, f.fps);
	const kr = clamp01((c + 1) / (dur + 1));
	const k = ease(e.ease, kr);
	// A quick fade, so motion never pops.
	const fast = clamp01((c + 1) / Math.min(3, dur + 1));
	const d = e.distance * fs;
	switch (e.kind) {
		case 'fade':
			return { ...IDENT, opacity: easeInOut(kr) };
		case 'pop': {
			const from = 0.6;
			const o = Math.max(1, e.overshoot);
			const s = o > 1.001
				? kr < 0.55 ? from + (o - from) * easeOut(kr / 0.55) : o + (1 - o) * easeInOut((kr - 0.55) / 0.45)
				: from + (1 - from) * k;
			return { ...IDENT, scale: s, opacity: fast };
		}
		case 'rise':
			return { ...IDENT, dy: d * (1 - k), opacity: Math.max(clamp01(k), fast * 0.5) };
		case 'drop':
			return { ...IDENT, dy: -d * (1 - k), opacity: Math.max(clamp01(k), fast * 0.5) };
		case 'blur-in':
			return { ...IDENT, opacity: clamp01(k), blur: d * 0.35 * (1 - k) };
		default:
			return IDENT;
	}
}

/** How the page leaves over its last frames. */
function exitFx(x: Recipe['exit'], left: number, f: Frame, fs: number): Fx {
	const dur = f30(x.frames, f.fps);
	if (x.kind === 'cut' || left > dur) return IDENT;
	const k = clamp01(left / dur);
	const o = easeInOut(k);
	switch (x.kind) {
		case 'fade':
			return { ...IDENT, opacity: o };
		case 'drop':
			return { ...IDENT, opacity: o, dy: (1 - k) * fs * 0.3 };
		case 'rise':
			return { ...IDENT, opacity: o, dy: -(1 - k) * fs * 0.3 };
		case 'blur-out':
			return { ...IDENT, opacity: o, blur: (1 - k) * fs * 0.12 };
		default:
			return IDENT;
	}
}

function paint({ ctx, st, f, page, L, frame, since, left, ws }: PaintProps): void {
	const r = recipeOf(st);
	const pl = r.plate;
	const fs = L.fs;
	const ex = exitFx(r.exit, left, f, fs);
	const tr = f30(3, f.fps);
	const lineClock = (li: number) => frame - ws[L.lines[li]!.idx[0]!]!.startF;

	withPose(ctx, { ox: L.cx, oy: L.cy, scale: ex.scale, dy: ex.dy, filter: blurCss(f, ex.blur) || undefined }, () => {
		if (pl?.kind === 'page') {
			const box = blockBox(L, pl.padX * fs, pl.padY * fs);
			const e = r.unit === 'page' ? enterFx(r.enter, since, f, fs) : { ...IDENT, opacity: clamp01((since + 1) / (tr + 1)) };
			withPose(ctx, { ox: L.cx, oy: L.cy, scale: e.scale, dx: e.dx, dy: e.dy, opacity: Math.min(1, e.opacity) * ex.opacity }, () => {
				drawContainer(ctx, { kind: 'chip', box, f, radius: Math.min(pl.radius * fs, box.h / 2), fill: pl.color, backdrop: pl.backdropBlur });
			});
		}
		if (pl?.kind === 'line') {
			L.lines.forEach((ln, li) => {
				const h = L.lineH + 2 * pl.padY * fs;
				const box = { x: ln.left - pl.padX * fs, y: ln.y - h / 2, w: ln.w + 2 * pl.padX * fs, h };
				const c = r.unit === 'page' || r.upcoming.opacity > 0.01 ? since : lineClock(li);
				withPose(ctx, { opacity: clamp01((c + 1) / (tr + 1)) * ex.opacity }, () => {
					drawContainer(ctx, { kind: 'chip', box, f, radius: Math.min(pl.radius * fs, box.h / 2), fill: pl.color, backdrop: pl.backdropBlur });
				});
			});
		}

		const gated = r.upcoming.opacity > 0.01;
		const upOp = gated ? r.upcoming.opacity : r.unit === 'word' ? 0 : 1;
		const em = r.emphasis;

		withPose(ctx, { filter: styleShadow(st, f) }, () => {
			L.words.forEach((b, i) => {
				const w = ws[i]!;
				const word = page.words[i]!;
				const isEmph = word.emphasis;
				const rank = r.unit === 'line' ? L.lines[b.line]!.idx.indexOf(i) : i;
				const stagger = r.unit === 'word' && !gated ? 0 : r.enter.stagger * rank;
				const c = r.unit === 'word'
					? (gated ? since - stagger : w.since)
					: r.unit === 'line'
						? (gated ? since : lineClock(b.line)) - stagger
						: since - stagger;
				const fx = enterFx(r.enter, c, f, fs);

				const inK = w.since < 0 ? 0 : clamp01((w.since + 1) / (tr + 1));
				const outK = w.until > 0 ? 1 : 1 - clamp01((-w.until + 1) / (tr + 1));
				const hot = isEmph ? word.color ?? em.color : null;
				let fill = st.color;
				if (hot) {
					fill = hot;
				} else {
					const cu = r.upcoming.color ?? st.color;
					const ca = r.active.color ?? st.color;
					const cs = r.spoken.color ?? st.color;
					const c1 = cu === ca ? ca : colorMix(inK, cu, ca);
					fill = c1 === cs || outK >= 1 ? c1 : colorMix(1 - outK, c1, cs);
				}
				const stateOp = mix(mix(upOp, r.active.opacity, inK), r.spoken.opacity, 1 - outK);
				const aK = Math.min(inK, outK);
				const stateScale = mix(1, isEmph ? Math.max(r.active.scale, 1) : r.active.scale, aK);
				const cy = b.baseline - L.capH / 2;

				withPose(ctx, {
					ox: b.cx,
					oy: cy,
					scale: fx.scale * stateScale,
					dx: fx.dx,
					dy: fx.dy,
					opacity: clamp01(fx.opacity) * stateOp * ex.opacity,
					filter: blurCss(f, fx.blur) || undefined,
				}, () => {
					drawWord(ctx, { box: b, fill, ...(r.stroke ? { stroke: { color: r.stroke.color, width: 2 * r.stroke.width * b.fs } } : {}) });
				});
			});
		});
	});
}

/** A style drawn by its `anim.recipe`. */
export function recipeStyle(style: Style): SubtleStyle {
	return {
		style,
		spec: (page, st) => {
			const r = recipeOf(st);
			return page.words.map((w): WordSpec => {
				if (!w.emphasis) return {};
				const s: WordSpec = {};
				if (r.emphasis.font) s.font = r.emphasis.font;
				if (r.emphasis.scale !== 1) s.size = r.emphasis.scale;
				return s;
			});
		},
		layout: (st, f) => {
			const r = recipeOf(st);
			const fs = baseFontSize(st.size, st, f);
			// The spoken word swells and a pop overshoots on top: keep room for both.
			const grow = Math.max(0, r.active.scale - 1);
			const pop = r.unit === 'word' && r.enter.kind === 'pop' ? Math.max(1, r.enter.overshoot) : 1;
			const edge = Math.max(0, r.active.scale * pop - 1);
			const pad = (r.plate && r.plate.kind !== 'word' ? r.plate.padX * fs : 0) + edge * fs * 2;
			return { align: r.align, padX: pad, gap: 1 + grow * 4 + (r.stroke ? r.stroke.width * 6 : 0) };
		},
		paint,
	};
}
