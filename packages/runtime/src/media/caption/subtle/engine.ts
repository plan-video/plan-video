/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A canvas port of Subtle's caption engine (github.com/0xpratzyy/subtle, MIT, © 2026 Refs).
// Sizes are % of the frame height and timings are frames at 30 fps, as in its style files.

import { fontString } from './fonts';

import type { FontSpec } from './fonts';

export type { FontSpec } from './fonts';

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type SWord = {
	text: string;
	startMs: number;
	endMs: number;
	line: number;
	emphasis: boolean;
	/** The word's own colour from the caption's word styles; a style may use it for its highlight. */
	color?: string;
};
export type SPage = { startMs: number; endMs: number; words: SWord[] };

/** `unit`: canvas pixels per frame pixel, for filter and shadow lengths, which the transform doesn't scale. */
export type Frame = { W: number; H: number; fps: number; wide: boolean; unit: number };
export type Box = { x: number; y: number; w: number; h: number };

export type PageRules = {
	maxWords?: number;
	maxCharsPerLine?: number;
	maxCharsPerLineWide?: number;
	maxLines?: number;
	minFrames?: number;
	maxFrames?: number;
	gapBreakMs?: number;
};

/** One of Subtle's style files; the keys under `anim`, `emphasis` and `container` are each style's own. */
export type Style = {
	font: FontSpec;
	emphasisFont?: FontSpec;
	noteFont?: FontSpec;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	emphasis?: Record<string, any>;
	case: 'upper' | 'sentence' | 'lower';
	size: number;
	wideScale?: number;
	lineHeight?: number;
	letterSpacing?: number;
	color: string;
	activeColor?: string;
	dimColor?: string | null;
	shadow?: { x: number; y: number; blur: number; color: string } | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	container?: Record<string, any> | null;
	backdropBlur?: number;
	position: { x?: number; y: number; marginX: number };
	page: PageRules;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	anim: Record<string, any>;
};

// ---------- easing ----------

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
export const easeOutQuart = (t: number) => 1 - (1 - clamp01(t)) ** 4;
export const easeInOut = (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
/** Ease out with a small overshoot, settling at 1. */
export const easeOutBack = (t: number, s = 1.2) => {
	const x = clamp01(t) - 1;
	return 1 + (s + 1) * x ** 3 + s * x ** 2;
};
export function easeOutExpo(t: number): number {
	return cubicBezier(0.16, 1, 0.3, 1, clamp01(t));
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
	const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (at(x1, x2, mid) < x) lo = mid;
		else hi = mid;
	}
	return at(y1, y2, (lo + hi) / 2);
}

function parseRgba(color: string): [number, number, number, number] {
	const hex = color.trim().match(/^#([0-9a-f]{3,8})$/i)?.[1];
	if (hex) {
		const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
		const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
		return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
	}
	const parts = color.match(/rgba?\(([^)]+)\)/i)?.[1]?.split(',').map((p) => parseFloat(p));
	if (parts && parts.length >= 3) return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
	return [255, 255, 255, 1];
}

const rgba = ([r, g, b, a]: [number, number, number, number]) =>
	`rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(4)})`;

export function colorMix(t: number, a: string, b: string): string {
	const from = parseRgba(a);
	const to = parseRgba(b);
	const k = clamp01(t);
	return rgba([mix(from[0], to[0], k), mix(from[1], to[1], k), mix(from[2], to[2], k), mix(from[3], to[3], k)]);
}

export function withAlpha(color: string, alpha: number): string {
	const [r, g, b, a] = parseRgba(color);
	return rgba([r, g, b, a * alpha]);
}

// ---------- time ----------

/** Frames at 30 fps -> frames at the frame's rate. */
export const f30 = (n: number, fps: number) => Math.max(1, Math.round((n * fps) / 30));
/** px at 1080p -> px at this frame height. */
export const px = (f: Frame, v: number) => (v * f.H) / 1080;

export type PageTiming = { s: number; e: number; wordS: number[]; wordE: number[] };

export function pageTiming(page: SPage, fps: number): PageTiming {
	const at = (ms: number) => (ms * fps) / 1000;
	const s = at(page.startMs);
	const wordS = page.words.map((w) => at(w.startMs));
	return {
		s,
		e: Math.max(at(page.endMs), s + 1),
		wordS,
		wordE: page.words.map((w, i) => Math.max(at(w.endMs), wordS[i]! + 1)),
	};
}

export type WordState = {
	i: number;
	state: 'upcoming' | 'active' | 'spoken';
	/** 0..1 while the word is being said. */
	progress: number;
	/** Frames since the word started, negative before. */
	since: number;
	/** Frames until the word ends, negative after. */
	until: number;
	startF: number;
	endF: number;
};

export function wordStates(t: PageTiming, frame: number): WordState[] {
	return t.wordS.map((startF, i) => {
		const endF = t.wordE[i]!;
		const state = frame < startF ? 'upcoming' : frame >= endF ? 'spoken' : 'active';
		return { i, state, progress: clamp01((frame - startF) / (endF - startF)), since: frame - startF, until: endF - frame, startF, endF };
	});
}

// ---------- measuring ----------

let measurer: Ctx | null = null;

function measureCtx(): Ctx {
	if (measurer) return measurer;
	const canvas = typeof OffscreenCanvas !== 'undefined'
		? new OffscreenCanvas(1, 1)
		: (globalThis as unknown as { document: Document }).document.createElement('canvas');
	measurer = canvas.getContext('2d') as Ctx;
	return measurer;
}

/** Sets the font and spacing a word is drawn with; `ls` is letter spacing in ems. */
export function setFont(ctx: Ctx, font: FontSpec, fs: number, ls = 0): void {
	ctx.font = fontString(font, fs);
	ctx.letterSpacing = `${ls * fs}px`;
}

export function textWidth(text: string, font: FontSpec, fs: number, ls = 0): number {
	const ctx = measureCtx();
	setFont(ctx, font, fs, ls);
	return ctx.measureText(text).width;
}

export function spaceWidth(font: FontSpec, fs: number, ls = 0): number {
	const ctx = measureCtx();
	setFont(ctx, font, 200, 0);
	return ((ctx.measureText('n n').width - ctx.measureText('nn').width) / 200) * fs + ls * fs;
}

const caps = new Map<string, number>();

/** Cap height as a fraction of the font size, from the real "H". */
export function capHeight(font: FontSpec): number {
	const key = fontString(font, 200);
	let value = caps.get(key);
	if (value === undefined) {
		const ctx = measureCtx();
		setFont(ctx, font, 200);
		value = ctx.measureText('H').actualBoundingBoxAscent / 200;
		if (!(value > 0.3)) value = 0.7;
		caps.set(key, value);
	}
	return value;
}

/** Fonts measure differently once loaded. */
export function forgetMeasures(): void {
	caps.clear();
}

export const monoAdvance = (font: FontSpec, fs: number) => textWidth('MMMMMMMMMM', font, fs) / 10;

export const applyCase = (text: string, c: Style['case']) =>
	c === 'upper' ? text.toLocaleUpperCase() : c === 'lower' ? text.toLocaleLowerCase() : text;

export const baseFontSize = (sizePct: number, st: Style, f: Frame) => (sizePct / 100) * f.H * (f.wide ? st.wideScale ?? 1.35 : 1);

// ---------- page layout ----------

/** Per-word overrides: mixed fonts, scaled words, replaced text, extra room after a word (ems of the base size). */
export type WordSpec = { text?: string; font?: FontSpec; size?: number; ls?: number; dy?: number; pad?: number };
export type WordBox = {
	i: number;
	text: string;
	font: FontSpec;
	fs: number;
	ls: number;
	left: number;
	w: number;
	cx: number;
	line: number;
	baseline: number;
};
export type LineBox = { y: number; baseline: number; left: number; w: number; idx: number[] };
export type Layout = {
	fs: number;
	words: WordBox[];
	lines: LineBox[];
	cx: number;
	cy: number;
	left: number;
	top: number;
	blockW: number;
	blockH: number;
	lineH: number;
	capH: number;
};
export type LayoutOpts = {
	specs?: WordSpec[];
	sizePct?: number;
	x?: number;
	y?: number;
	padX?: number;
	align?: 'center' | 'left';
	gap?: number;
	maxLines?: number;
};

function breakLines(widths: number[], space: number): number[] {
	if (widths.length < 2) return widths.map(() => 0);
	let best = 1;
	let bestMax = Infinity;
	for (let k = 1; k < widths.length; k++) {
		const a = widths.slice(0, k).reduce((x, y) => x + y, 0) + space * (k - 1);
		const b = widths.slice(k).reduce((x, y) => x + y, 0) + space * (widths.length - k - 1);
		if (Math.max(a, b) < bestMax) {
			bestMax = Math.max(a, b);
			best = k;
		}
	}
	return widths.map((_, i) => (i < best ? 0 : 1));
}

/** Measures a page, wraps it, shrinks it to the side margins, and gives one box per word. */
export function layoutPage(page: SPage, st: Style, f: Frame, o: LayoutOpts = {}): Layout {
	const ls0 = st.letterSpacing ?? 0;
	const specs = page.words.map((_, i) => o.specs?.[i] ?? {});
	const texts = page.words.map((w, i) => specs[i]!.text ?? applyCase(w.text, st.case));
	const fonts = specs.map((s) => s.font ?? st.font);
	const muls = specs.map((s) => s.size ?? 1);
	const lss = specs.map((s) => s.ls ?? ls0);
	const avail = f.W * (1 - (2 * st.position.marginX) / 100) - 2 * (o.padX ?? 0);
	const maxLines = o.maxLines ?? Math.max(2, st.page.maxLines ?? 2);
	let fs = baseFontSize(o.sizePct ?? st.size, st, f);
	let wordLine = page.words.map((w) => Math.min(w.line, 3));

	const measure = (size: number) => ({
		widths: texts.map((t, i) => textWidth(t, fonts[i]!, size * muls[i]!, lss[i]) + (specs[i]!.pad ?? 0) * size),
		space: spaceWidth(st.font, size, ls0) * (o.gap ?? 1),
	});
	const widest = (lines: number[], m: { widths: number[]; space: number }) => {
		const sums = new Map<number, number>();
		lines.forEach((l, i) => sums.set(l, (sums.get(l) ?? -m.space) + m.widths[i]! + m.space));
		return Math.max(...sums.values());
	};
	let m = measure(fs);
	let w = widest(wordLine, m);
	if (w > avail) {
		let scale = avail / w;
		if (scale < 0.8 && new Set(wordLine).size < 2 && texts.length > 1 && maxLines > 1) {
			wordLine = breakLines(m.widths, m.space);
			w = widest(wordLine, m);
			scale = Math.min(1, avail / w);
		}
		fs *= scale;
		m = measure(fs);
		w = widest(wordLine, m);
		if (w > avail) {
			fs *= (avail / w) * 0.995;
			m = measure(fs);
		}
	}

	const lineIds = [...new Set(wordLine)].sort((a, b) => a - b);
	const lh = fs * (st.lineHeight ?? 1.15);
	const capH = capHeight(st.font) * fs;
	const cx = (f.W * (o.x ?? st.position.x ?? 50)) / 100;
	const cy = (f.H * (o.y ?? st.position.y)) / 100;
	const blockH = lh * lineIds.length;
	const blockW = widest(wordLine, m);
	const words: WordBox[] = [];
	const lines: LineBox[] = lineIds.map((id, li) => {
		const idx = texts.map((_, i) => i).filter((i) => wordLine[i] === id);
		const lw = idx.reduce((s, i) => s + m.widths[i]!, 0) + m.space * (idx.length - 1);
		const y = cy - blockH / 2 + lh * (li + 0.5);
		const baseline = y + capH / 2;
		const left = o.align === 'left' ? cx - blockW / 2 : cx - lw / 2;
		let x = left;
		for (const i of idx) {
			const own = m.widths[i]! - (specs[i]!.pad ?? 0) * fs;
			words[i] = { i, text: texts[i]!, font: fonts[i]!, fs: fs * muls[i]!, ls: lss[i]!, left: x, w: own, cx: x + own / 2, line: li, baseline: baseline + (specs[i]!.dy ?? 0) * fs };
			x += m.widths[i]! + m.space;
		}
		return { y, baseline, left, w: lw, idx };
	});
	return { fs, words, lines, cx, cy, left: cx - blockW / 2, top: cy - blockH / 2, blockW, blockH, lineH: lh, capH };
}

export const blockBox = (L: Layout, padX: number, padY: number): Box => ({
	x: L.left - padX,
	y: L.top - padY,
	w: L.blockW + 2 * padX,
	h: L.blockH + 2 * padY,
});

/** Sizes one word to span `widthPx`, never above `maxFs`. */
export function fitWord(text: string, font: FontSpec, widthPx: number, maxFs: number, ls = 0) {
	const w100 = textWidth(text, font, 100, ls);
	const fs = Math.min(maxFs, (100 * widthPx) / w100);
	return { fs, w: textWidth(text, font, fs, ls) };
}

/** Each highlighted word is its own segment; each run of other words is one. */
export type Segment = { idx: number[]; hot: boolean };
export function segmentsOf(page: SPage): Segment[] {
	const out: Segment[] = [];
	page.words.forEach((w, i) => {
		const last = out[out.length - 1];
		if (!w.emphasis && last && !last.hot) last.idx.push(i);
		else out.push({ idx: [i], hot: w.emphasis });
	});
	return out;
}

/** The segment holding the word being said: the last whose first word has started, else the first. */
export function activeSegment(segs: Segment[], wordStartF: number[], frame: number): number {
	let k = 0;
	segs.forEach((s, j) => {
		if (frame >= wordStartF[s.idx[0]!]!) k = j;
	});
	return k;
}

export type Run = { boxes: WordBox[]; w: number; fs: number };
/** Words on one line from x 0 at baseline 0, shrunk to fit `maxW`. */
export function fitRun(texts: string[], font: FontSpec, fs: number, o: { ls?: number; gap?: number; maxW: number }): Run {
	const ls = o.ls ?? 0;
	const gap = o.gap ?? 1;
	const measure = (s: number) => {
		const ws = texts.map((t) => textWidth(t, font, s, ls));
		const sp = spaceWidth(font, s, ls) * gap;
		return { ws, sp, tot: ws.reduce((a, b) => a + b, 0) + sp * (texts.length - 1) };
	};
	let m = measure(fs);
	if (m.tot > o.maxW) {
		fs *= (o.maxW / m.tot) * 0.995;
		m = measure(fs);
	}
	let x = 0;
	const boxes = texts.map((t, i) => {
		const b: WordBox = { i, text: t, font, fs, ls, left: x, w: m.ws[i]!, cx: x + m.ws[i]! / 2, line: 0, baseline: 0 };
		x += m.ws[i]! + m.sp;
		return b;
	});
	return { boxes, w: m.tot, fs };
}

export const placeBox = (b: WordBox, dx: number, baseline: number): WordBox => ({ ...b, left: b.left + dx, cx: b.cx + dx, baseline });

export const titleCase = (t: string) => t.replace(/^([^\p{L}]*)(\p{L})/u, (_, a: string, b: string) => a + b.toUpperCase());

export const hasNumeral = (text: string) => /[\d$₹€£%]/.test(text);

/** The flagged words, or the longest word when none is. */
export function keyWords(page: SPage): Set<number> {
	const out = new Set<number>();
	page.words.forEach((w, i) => w.emphasis && out.add(i));
	if (!out.size) {
		let best = 0;
		const len = (i: number) => page.words[i]!.text.replace(/\W/g, '').length;
		page.words.forEach((_, i) => len(i) > len(best) && (best = i));
		out.add(best);
	}
	return out;
}

// ---------- drawing ----------

/** Filter pieces. Lengths are px at 1080p, scaled to the frame and then to the canvas. */
export const dropShadow = (f: Frame, x: number, y: number, blur: number, color: string) =>
	`drop-shadow(${(px(f, x) * f.unit).toFixed(2)}px ${(px(f, y) * f.unit).toFixed(2)}px ${(px(f, blur / 2) * f.unit).toFixed(2)}px ${color})`;
export const blurCss = (f: Frame, v: number) => (v > 0.01 ? `blur(${(px(f, v) * f.unit).toFixed(2)}px)` : '');
export const joinFilters = (...parts: (string | undefined | false | null)[]) => parts.filter(Boolean).join(' ') || undefined;
/** The style's `shadow` ({x, y, blur} in % of the frame height). */
export const styleShadow = (st: Pick<Style, 'shadow'>, f: Frame) =>
	st.shadow
		? `drop-shadow(${((st.shadow.x / 100) * f.H * f.unit).toFixed(2)}px ${((st.shadow.y / 100) * f.H * f.unit).toFixed(2)}px ${(((st.shadow.blur / 100) * f.H * f.unit) / 2).toFixed(2)}px ${st.shadow.color})`
		: undefined;

export type Pose = { ox?: number; oy?: number; scale?: number; sx?: number; sy?: number; rotate?: number; dx?: number; dy?: number; opacity?: number; filter?: string };

/** Moves, scales (about ox, oy), fades and filters what `draw` paints. Rotation is in degrees. */
export function withPose(ctx: Ctx, pose: Pose, draw: () => void): void {
	const opacity = pose.opacity ?? 1;
	if (opacity <= 0.001) return;
	ctx.save();
	const ox = pose.ox ?? 0;
	const oy = pose.oy ?? 0;
	const sx = (pose.sx ?? 1) * (pose.scale ?? 1);
	const sy = (pose.sy ?? 1) * (pose.scale ?? 1);
	ctx.translate((pose.dx ?? 0) + ox, (pose.dy ?? 0) + oy);
	if (pose.rotate) ctx.rotate((pose.rotate * Math.PI) / 180);
	if (sx !== 1 || sy !== 1) ctx.scale(sx || 1e-4, sy || 1e-4);
	ctx.translate(-ox, -oy);
	ctx.globalAlpha *= opacity;
	if (pose.filter) ctx.filter = ctx.filter && ctx.filter !== 'none' ? `${ctx.filter} ${pose.filter}` : pose.filter;
	draw();
	ctx.restore();
}

export type Paint = string | CanvasGradient;

export type WordProps = {
	box: WordBox;
	fill: Paint;
	/** Overrides the box's text (a typed-on slice, say). */
	text?: string;
	opacity?: number;
	dx?: number;
	dy?: number;
	/** About the word's baseline-left corner. */
	scale?: number;
	filter?: string;
	/** An outline under the fill: width in px of the frame. */
	stroke?: { color: string; width: number };
};

/** One word, placed by its baseline. */
export function drawWord(ctx: Ctx, p: WordProps): void {
	const { box } = p;
	withPose(ctx, { ox: box.left, oy: box.baseline, scale: p.scale, dx: p.dx, dy: p.dy, opacity: p.opacity, filter: p.filter }, () => {
		setFont(ctx, box.font, box.fs, box.ls);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		const text = p.text ?? box.text;
		if (p.stroke && p.stroke.width > 0) {
			ctx.lineJoin = 'round';
			ctx.lineWidth = p.stroke.width;
			ctx.strokeStyle = p.stroke.color;
			ctx.strokeText(text, box.left, box.baseline);
		}
		ctx.fillStyle = p.fill;
		ctx.fillText(text, box.left, box.baseline);
	});
}

// ---------- reveals: pure functions of frames since a start ----------

export type Reveal = { opacity: number; dy: number; scale: number; blur: number };
const still: Reveal = { opacity: 1, dy: 0, scale: 1, blur: 0 };

/** The first frame already shows a sliver, so a word never lags its sound. */
export const fadeIn = (since: number, dur: number): Reveal => ({ ...still, opacity: since < 0 ? 0 : easeInOut((since + 1) / (dur + 1)) });
export const riseIn = (f: Frame, since: number, dur: number, rise: number): Reveal => {
	const k = since < 0 ? 0 : easeOut((since + 1) / (dur + 1));
	return { ...still, opacity: k, dy: px(f, rise) * (1 - k) };
};
export const blurIn = (_f: Frame, since: number, dur: number, blur: number): Reveal => {
	const k = since < 0 ? 0 : easeOut((since + 1) / (dur + 1));
	return { ...still, opacity: k, blur: blur * (1 - k) };
};
export const scaleFromBaseline = (since: number, dur: number, from = 0.1, fadeFrames = 2): Reveal => {
	if (since < 0) return { ...still, opacity: 0, scale: from };
	const k = clamp01((since + 1) / (dur + 1));
	return { opacity: clamp01((since + 1) / fadeFrames), dy: 0, blur: 0, scale: mix(from, 1, easeOutBack(k, 1.6)) };
};
/** Page fade over its last `dur` frames. */
export const fadeOut = (left: number, dur: number) => clamp01(left / Math.max(1, dur));

/** A fill that shows `x..x+w` up to a soft edge travelling left to right: p 0 hides it all, 1 shows it all. */
export function featherFill(ctx: Ctx, color: string, x: number, w: number, p: number, feather = 0.3): CanvasGradient {
	const fw = Math.max(2, feather * w);
	const e = x + p * (w + fw);
	const gradient = ctx.createLinearGradient(e - fw, 0, e, 0);
	gradient.addColorStop(0, color);
	gradient.addColorStop(1, withAlpha(color, 0));
	return gradient;
}

// ---------- containers ----------

export type ContainerKind = 'pill' | 'chip' | 'block';
export const radiusFor = (kind: ContainerKind, h: number, f: Frame) => (kind === 'pill' ? h / 2 : kind === 'chip' ? h * 0.28 : px(f, 4));

export type ContainerProps = {
	kind: ContainerKind;
	box: Box;
	f: Frame;
	radius?: number;
	fill?: Paint;
	/** Top-edge highlight colour. */
	highlight?: string;
	/** A filter, usually a drop-shadow. */
	shadow?: string;
	opacity?: number;
	scale?: number;
	rotate?: number;
	/** Blurs the picture under the shape, in px at 1080p. */
	backdrop?: number;
};

export function drawContainer(ctx: Ctx, c: ContainerProps): void {
	const { box, f } = c;
	const r = Math.min(c.radius ?? radiusFor(c.kind, box.h, f), box.h / 2, box.w / 2);
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	withPose(ctx, { ox: cx, oy: cy, scale: c.scale, rotate: c.rotate, opacity: c.opacity }, () => {
		if (c.backdrop) backdropBlur(ctx, box, r, px(f, c.backdrop) * f.unit);
		ctx.save();
		if (c.shadow) ctx.filter = c.shadow;
		ctx.beginPath();
		ctx.roundRect(box.x, box.y, box.w, box.h, r);
		ctx.fillStyle = c.fill ?? 'rgba(255,255,255,0.2)';
		ctx.fill();
		ctx.restore();
		if (c.highlight) {
			const edge = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
			edge.addColorStop(0, c.highlight);
			edge.addColorStop(0.45, withAlpha(c.highlight, 0));
			ctx.beginPath();
			ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, r);
			ctx.lineWidth = Math.max(1, px(f, 1.2));
			ctx.strokeStyle = edge;
			ctx.stroke();
		}
	});
}

/** Blurs what is already drawn under a rounded box (the frosted glass under a pill). */
export function backdropBlur(ctx: Ctx, box: Box, radius: number, blur: number): void {
	if (blur <= 0.5) return;
	ctx.save();
	try {
		ctx.beginPath();
		ctx.roundRect(box.x, box.y, box.w, box.h, radius);
		ctx.clip();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
		ctx.filter = `blur(${blur.toFixed(2)}px)`;
		ctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0);
	} catch {
		// A canvas that can't be read back keeps the plain tint.
	}
	ctx.restore();
}
