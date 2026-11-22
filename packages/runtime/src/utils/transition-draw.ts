/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How each transition style draws, apart from the world: the renderer hands it the two clips, and the
// editor's preview tiles hand it two pictures, so a tile shows exactly what an export will.

import { TransitionDirection, TransitionEasing, TransitionType } from '../constants';
import { colorToHex } from './color';
import { rgbSplitFilter } from './svg-filter';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type TransitionBox = { x: number; y: number; width: number; height: number };

/** In the parent's units, about the box's middle. `clip` adds paths in the posed clip's own space. */
export type TransitionPose = {
	scale?: number;
	rotate?: number;
	dx?: number;
	dy?: number;
	alpha?: number;
	blur?: number;
	brightness?: number;
	split?: number;
	clip?: (ctx: Ctx2D) => void;
};

export type TransitionPainter = {
	ctx: Ctx2D;
	/** Both clips' box at a cut, the one clip's at an edge. */
	box: TransitionBox;
	/** The parent's frame, which slides and fades cover. */
	frame: TransitionBox;
	/** 0 is the clip going out, 1 the clip coming in. An edge has one clip, drawn for either. */
	draw: (side: 0 | 1, pose?: TransitionPose) => void;
};

export type TransitionLook = {
	type: TransitionType;
	direction: TransitionDirection;
	/** With an easing set, `t` goes through that instead of the style's own curve, so Linear really is linear. */
	ease: (t: number, own: (t: number) => number) => number;
	color: (own: string) => string;
};

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const linear = (t: number) => t;

const EASINGS: Record<TransitionEasing, ((t: number) => number) | null> = {
	[TransitionEasing.AUTO]: null,
	[TransitionEasing.LINEAR]: linear,
	[TransitionEasing.EASE_IN]: easeInCubic,
	[TransitionEasing.EASE_OUT]: easeOutCubic,
	[TransitionEasing.EASE_IN_OUT]: easeInOutCubic,
};

type Way = 'left' | 'right' | 'up' | 'down';

const WAYS: Record<Way, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

const DIRECTIONS: Record<TransitionDirection, Way | null> = {
	[TransitionDirection.AUTO]: null,
	[TransitionDirection.LEFT]: 'left',
	[TransitionDirection.RIGHT]: 'right',
	[TransitionDirection.UP]: 'up',
	[TransitionDirection.DOWN]: 'down',
};

function wayOf(direction: TransitionDirection, own: Way): [number, number] {
	return WAYS[DIRECTIONS[direction] ?? own];
}

/** `color` is a packed RGB, or negative for the style's own. */
export function transitionLook(
	type: TransitionType,
	direction = TransitionDirection.AUTO,
	easing = TransitionEasing.AUTO,
	color = -1,
): TransitionLook {
	const set = EASINGS[easing] ?? null;
	return {
		type,
		direction,
		ease: (t, own) => (set ?? own)(clamp01(t)),
		color: (own) => (color >= 0 ? colorToHex(color) : own),
	};
}

/**
 * A painter's `draw` for `paint`: poses it about the box's middle, then clips
 * and filters it. A canvas filter's lengths ignore the transform, so blur and
 * split are scaled by it to look the same in a small preview as in an export.
 */
export function posedDraw(ctx: Ctx2D, box: TransitionBox, paint: (side: 0 | 1) => void): TransitionPainter['draw'] {
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	return (side, pose = {}) => {
		const alpha = pose.alpha ?? 1;
		if (alpha <= 0) return;
		ctx.save();
		ctx.translate(cx + (pose.dx ?? 0), cy + (pose.dy ?? 0));
		if (pose.rotate) ctx.rotate(pose.rotate);
		if (pose.scale !== undefined && pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
		ctx.translate(-cx, -cy);
		if (pose.clip) {
			ctx.beginPath();
			pose.clip(ctx);
			ctx.clip();
		}
		ctx.globalAlpha *= alpha;

		const m = ctx.getTransform();
		const toCanvas = Math.hypot(m.a, m.b);
		const parts: string[] = [];
		if (pose.brightness !== undefined && Math.abs(pose.brightness - 1) > 1e-3) parts.push(`brightness(${pose.brightness.toFixed(3)})`);
		if (pose.split) {
			const split = rgbSplitFilter(pose.split * toCanvas);
			if (split) parts.push(split);
		}
		if (pose.blur && pose.blur >= 0.25) parts.push(`blur(${(pose.blur * toCanvas).toFixed(2)}px)`);
		if (parts.length > 0) {
			const current = ctx.filter;
			ctx.filter = current && current !== 'none' ? `${current} ${parts.join(' ')}` : parts.join(' ');
		}

		paint(side);
		ctx.restore();
	};
}

function wipeRect(ctx: Ctx2D, box: TransitionBox, [ux, uy]: [number, number], fraction: number, leading: boolean): void {
	const w = ux ? box.width * fraction : box.width;
	const h = uy ? box.height * fraction : box.height;
	const far = (u: number) => (u > 0) === leading;
	const x = ux && far(ux) ? box.x + box.width - w : box.x;
	const y = uy && far(uy) ? box.y + box.height - h : box.y;
	ctx.rect(x, y, w, h);
}

const STRIPES = 6;
const STRIPE_STAGGER = 0.45;

/** Bands across the way it wipes, each wiping in a little after the one before. */
function stripesPath(ctx: Ctx2D, box: TransitionBox, way: [number, number], progress: number, leading: boolean): void {
	const across = way[0] !== 0;
	for (let index = 0; index < STRIPES; index++) {
		const delay = (STRIPE_STAGGER * index) / (STRIPES - 1);
		const local = easeInOutCubic(clamp01((progress - delay) / (1 - STRIPE_STAGGER)));
		if (local <= 0) continue;
		const band = across
			? { x: box.x, y: box.y + (box.height * index) / STRIPES, width: box.width, height: box.height / STRIPES + 0.5 }
			: { x: box.x + (box.width * index) / STRIPES, y: box.y, width: box.width / STRIPES + 0.5, height: box.height };
		wipeRect(ctx, band, way, local, leading);
	}
}

function clockPath(ctx: Ctx2D, box: TransitionBox, fraction: number): void {
	if (fraction <= 0) return;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const radius = Math.hypot(box.width, box.height) / 2 + 1;
	ctx.moveTo(cx, cy);
	ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
	ctx.closePath();
}

/** The two halves of a split, each as `clip` paths, and which way each one leaves. */
function splitHalves(box: TransitionBox, direction: TransitionDirection) {
	const [ux] = wayOf(direction, 'left');
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	return ux !== 0
		? [
				{ clip: (ctx: Ctx2D) => ctx.rect(box.x, box.y, cx - box.x, box.height), ux: -1, uy: 0 },
				{ clip: (ctx: Ctx2D) => ctx.rect(cx, box.y, box.x + box.width - cx, box.height), ux: 1, uy: 0 },
			]
		: [
				{ clip: (ctx: Ctx2D) => ctx.rect(box.x, box.y, box.width, cy - box.y), ux: 0, uy: -1 },
				{ clip: (ctx: Ctx2D) => ctx.rect(box.x, cy, box.width, box.y + box.height - cy), ux: 0, uy: 1 },
			];
}

/** Warm light washing over the box: three soft lights drifting across, screened over what is there. */
function lightLeak(ctx: Ctx2D, box: TransitionBox, progress: number, strength: number, color: string): void {
	if (strength <= 0.002) return;
	const size = Math.max(box.width, box.height);
	const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
	const light = (fx: number, fy: number, radius: number, stops: [number, string][]) => {
		const [x, y] = at(fx, fy);
		const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * size);
		for (const [offset, value] of stops) gradient.addColorStop(offset, value);
		ctx.fillStyle = gradient;
		ctx.fillRect(box.x, box.y, box.width, box.height);
	};
	const [r, g, b] = hexRgb(color);
	const tint = (alpha: number) => `rgba(${r},${g},${b},${alpha})`;

	ctx.save();
	ctx.beginPath();
	ctx.rect(box.x, box.y, box.width, box.height);
	ctx.clip();
	ctx.globalCompositeOperation = 'screen';
	ctx.globalAlpha *= strength;
	light(-0.1 + 0.9 * progress, 0.2 + 0.2 * progress, 0.75, [[0, tint(1)], [0.45, tint(0.55)], [1, tint(0)]]);
	light(1.05 - 0.6 * progress, 0.85 - 0.3 * progress, 0.55, [[0, 'rgba(255,72,110,0.85)'], [0.5, 'rgba(255,72,110,0.3)'], [1, 'rgba(255,72,110,0)']]);
	light(0.15 + 0.7 * progress, 0.5, 0.4, [[0, 'rgba(255,244,214,0.95)'], [0.4, 'rgba(255,214,150,0.4)'], [1, 'rgba(255,214,150,0)']]);
	ctx.restore();
}

function hexRgb(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16);
	return Number.isFinite(value) ? [(value >> 16) & 255, (value >> 8) & 255, value & 255] : [255, 138, 61];
}

function seeded(seed: number) {
	let state = (seed * 2654435761) >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

/**
 * A glitch's look at `progress`: a few tearing slices over a frame split into
 * its colours, both `intensity` strong. `side` picks which clip each draw
 * shows, or none. The randomness steps 20 times over it, so it reads as frames.
 */
function glitch(paint: TransitionPainter, progress: number, intensity: number, side: (roll: number) => 0 | 1 | null): void {
	const { box, draw } = paint;
	const random = seeded(Math.floor(progress * 20) + 1);
	const reach = Math.max(box.width, box.height);
	const split = intensity * reach * 0.012;
	const show = (pose: TransitionPose) => {
		const which = side(random());
		if (which !== null) draw(which, pose);
	};
	show({ split, dx: (random() - 0.5) * intensity * box.width * 0.03 });
	if (intensity < 0.15) return;
	const slices = 2 + Math.floor(random() * 4 * intensity);
	for (let index = 0; index < slices; index++) {
		const y = box.y + random() * box.height;
		const height = box.height * (0.02 + random() * 0.14);
		const dx = (random() - 0.5) * intensity * box.width * 0.18;
		show({ split: split * 1.6, dx, clip: (ctx) => ctx.rect(box.x - box.width, y, box.width * 3, height) });
	}
}

/** Damped shake for an impact `q` (0..1) after the hit: offsets, a turn and the zoom that hides the edges. */
function impactPose(box: TransitionBox, q: number) {
	const decay = (1 - clamp01(q)) ** 2;
	return {
		scale: 1 + 0.2 * decay,
		dx: Math.sin(q * 41) * decay * box.width * 0.028,
		dy: Math.cos(q * 33) * decay * box.height * 0.034,
		rotate: Math.sin(q * 27) * decay * 0.025,
		blur: decay * Math.max(box.width, box.height) * 0.006,
	};
}

function fill(ctx: Ctx2D, box: TransitionBox, color: string, alpha: number, mode?: GlobalCompositeOperation): void {
	if (alpha <= 0) return;
	ctx.save();
	ctx.globalAlpha *= alpha;
	if (mode) ctx.globalCompositeOperation = mode;
	ctx.fillStyle = color;
	ctx.fillRect(box.x, box.y, box.width, box.height);
	ctx.restore();
}

/** The cut between two clips, `completion` (0..1) of the way through. */
export function drawTransitionCut(paint: TransitionPainter, look: TransitionLook, completion: number): void {
	const { ctx, box, frame, draw } = paint;
	const { type } = look;
	const p = look.ease(completion, linear);
	const e = look.ease(completion, easeInOutCubic);
	// How far the blurs reach: a share of the frame, so they read the same at any size.
	const blurReach = Math.max(box.width, box.height) * 0.02;

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT:
		case TransitionType.SLIDE_FROM_LEFT: {
			const q = look.ease(completion, (t) => 1 - (1 - t) ** 2);
			const [ux, uy] = wayOf(look.direction, type === TransitionType.SLIDE_FROM_RIGHT ? 'left' : 'right');
			draw(0);
			draw(1, { dx: (-ux * (1 - q) * frame.width) | 0, dy: (-uy * (1 - q) * frame.height) | 0 });
			break;
		}
		case TransitionType.FADE_TO_BLACK:
		case TransitionType.FADE_TO_WHITE: {
			draw(p < 0.5 ? 0 : 1);
			fill(ctx, frame, look.color(type === TransitionType.FADE_TO_BLACK ? '#000000' : '#FFFFFF'), p < 0.5 ? 2 * p : 2 * (1 - p));
			break;
		}
		case TransitionType.PUSH_LEFT:
		case TransitionType.PUSH_UP:
		case TransitionType.WHIP: {
			const whip = type === TransitionType.WHIP;
			const q = whip ? look.ease(completion, easeInOutQuint) : e;
			const [ux, uy] = wayOf(look.direction, type === TransitionType.PUSH_UP ? 'up' : 'left');
			const distance = ux ? box.width : box.height;
			const shift = Math.round(q * distance);
			const blur = whip ? Math.sin(Math.PI * p) * blurReach * 1.5 : 0;
			draw(0, { dx: ux * shift, dy: uy * shift, blur });
			draw(1, { dx: ux * (shift - distance), dy: uy * (shift - distance), blur });
			break;
		}
		case TransitionType.ZOOM_IN: {
			// The next clip settles from a little larger, so no edge shows round it.
			draw(1, { scale: 1.15 - 0.15 * e, alpha: smoothstep(clamp01((p - 0.15) / 0.6)) });
			draw(0, { scale: 1 + 0.6 * e, alpha: 1 - smoothstep(clamp01(p / 0.75)) });
			break;
		}
		case TransitionType.ZOOM_OUT: {
			draw(0, { scale: 1 - 0.25 * e, alpha: 1 - smoothstep(clamp01((p - 0.1) / 0.65)) });
			draw(1, { scale: 1.45 - 0.45 * e, alpha: smoothstep(clamp01(p / 0.7)) });
			break;
		}
		case TransitionType.CROSS_ZOOM: {
			if (p < 0.5) {
				const q = easeInCubic(p * 2);
				draw(0, { scale: 1 + 1.2 * q, blur: q * blurReach * 2 });
				// A brief overlap either side of the cut, so it does not pop.
				if (p > 0.42) draw(1, { scale: 2.2, blur: blurReach * 2, alpha: (p - 0.42) / 0.16 });
			} else {
				const q = easeOutCubic((p - 0.5) * 2);
				if (p < 0.58) draw(0, { scale: 2.2, blur: blurReach * 2 });
				draw(1, { scale: 2.2 - 1.2 * q, blur: (1 - q) * blurReach * 2, alpha: p < 0.58 ? 0.5 + (p - 0.5) / 0.16 : 1 });
			}
			break;
		}
		case TransitionType.SPIN: {
			draw(0, { scale: 1 + 0.15 * e, alpha: 1 - smoothstep(clamp01((p - 0.35) / 0.5)) });
			draw(1, { scale: e, rotate: (1 - e) * -Math.PI, alpha: smoothstep(clamp01(p / 0.3)) });
			break;
		}
		case TransitionType.FLASH: {
			draw(p < 0.5 ? 0 : 1);
			fill(ctx, box, look.color('#FFFFFF'), p < 0.5 ? smoothstep(clamp01(p / 0.5)) : 1 - smoothstep(clamp01((p - 0.5) / 0.5)));
			break;
		}
		case TransitionType.BLUR: {
			draw(0, { blur: e * blurReach * 2 });
			draw(1, { alpha: e, blur: (1 - e) * blurReach * 2 });
			break;
		}
		case TransitionType.WIPE: {
			draw(0);
			draw(1, { clip: (c) => wipeRect(c, box, wayOf(look.direction, 'right'), e, false) });
			break;
		}
		case TransitionType.IRIS: {
			draw(0);
			draw(1, { clip: (c) => c.arc(box.x + box.width / 2, box.y + box.height / 2, (e * Math.hypot(box.width, box.height)) / 2, 0, Math.PI * 2) });
			break;
		}
		case TransitionType.LIGHT_LEAK: {
			draw(0);
			draw(1, { alpha: smoothstep(clamp01((p - 0.3) / 0.4)) });
			lightLeak(ctx, box, p, Math.sin(Math.PI * p) ** 0.8, look.color('#FF8A3D'));
			break;
		}
		case TransitionType.BLOOM: {
			// Out through overexposure and back: the frame burns to white at the cut.
			const glow = p < 0.5 ? smoothstep(clamp01(p / 0.5)) : smoothstep(clamp01((1 - p) / 0.5));
			const pose = { brightness: 1 + 2.2 * glow, blur: glow * blurReach * 0.5 };
			if (p < 0.58) draw(0, pose);
			if (p > 0.42) draw(1, { ...pose, alpha: smoothstep(clamp01((p - 0.42) / 0.16)) });
			fill(ctx, box, '#FFFFFF', glow ** 3 * 0.4, 'screen');
			break;
		}
		case TransitionType.SPLIT: {
			draw(1, { scale: 1.12 - 0.12 * e, alpha: smoothstep(clamp01(p / 0.25)) });
			const distance = (ux: number) => (ux ? box.width : box.height) / 2;
			for (const half of splitHalves(box, look.direction)) {
				const away = e * distance(half.ux);
				draw(0, { clip: half.clip, dx: half.ux * away, dy: half.uy * away });
			}
			break;
		}
		case TransitionType.STRIPES: {
			draw(0);
			draw(1, { clip: (c) => stripesPath(c, box, wayOf(look.direction, 'right'), p, false) });
			break;
		}
		case TransitionType.CLOCK: {
			draw(0);
			draw(1, { clip: (c) => clockPath(c, box, e) });
			break;
		}
		case TransitionType.GLITCH: {
			// The glitch flickers between the clips around the cut.
			const intensity = Math.sin(Math.PI * p) ** 0.7;
			glitch(paint, p, intensity, (roll) => (roll < clamp01((p - 0.32) / 0.36) ? 1 : 0));
			break;
		}
		case TransitionType.IMPACT: {
			if (p < 0.5) {
				const q = easeInCubic(p / 0.5);
				draw(0, { scale: 1 + 0.14 * q, blur: q * blurReach * 0.7 });
			} else {
				const q = (p - 0.5) / 0.5;
				draw(1, impactPose(box, q));
				fill(ctx, box, '#FFFFFF', (1 - clamp01(q / 0.18)) * 0.45, 'screen');
			}
			break;
		}
		default: {
			draw(0);
			draw(1, { alpha: look.ease(completion, linear) });
			break;
		}
	}
}

/**
 * One clip's edge, with nothing on the other side: each style plays as its
 * half of a cut would. `shown` is how much of the clip is in, 0..1.
 */
export function drawTransitionEdge(paint: TransitionPainter, look: TransitionLook, edge: 'in' | 'out', shown: number): void {
	const { ctx, box, draw } = paint;
	const { type } = look;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const s = look.ease(shown, linear);
	const e = look.ease(shown, easeInOutCubic);
	const side = edge === 'in' ? 1 : -1;
	const blurReach = Math.max(box.width, box.height) * 0.02;

	const offset = (own: Way, away: number) => {
		const [ux, uy] = wayOf(look.direction, own);
		const sign = edge === 'in' ? -1 : 1;
		return { dx: Math.round(sign * ux * away * box.width), dy: Math.round(sign * uy * away * box.height) };
	};

	const fadeThrough = (color: string) => {
		const alpha = clamp01(s / 0.4);
		draw(0, { alpha });
		fill(ctx, box, color, alpha * smoothstep(clamp01((1 - s) / 0.6)));
	};

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT:
		case TransitionType.SLIDE_FROM_LEFT: {
			const q = look.ease(shown, (t) => 1 - (1 - t) ** 2);
			draw(0, offset(type === TransitionType.SLIDE_FROM_RIGHT ? 'left' : 'right', 1 - q));
			break;
		}
		case TransitionType.PUSH_LEFT:
			draw(0, offset('left', 1 - e));
			break;
		case TransitionType.PUSH_UP:
			draw(0, offset('up', 1 - e));
			break;
		case TransitionType.WHIP: {
			const q = look.ease(shown, easeInOutQuint);
			draw(0, { ...offset('left', 1 - q), blur: Math.sin((Math.PI * (1 - s)) / 2) * blurReach * 1.5 });
			break;
		}
		case TransitionType.FADE_TO_BLACK:
			fadeThrough(look.color('#000000'));
			break;
		case TransitionType.FADE_TO_WHITE:
			fadeThrough(look.color('#FFFFFF'));
			break;
		case TransitionType.ZOOM_IN:
			draw(0, { scale: edge === 'in' ? 1.15 - 0.15 * e : 1 + 0.6 * (1 - e), alpha: smoothstep(clamp01(s / 0.6)) });
			break;
		case TransitionType.ZOOM_OUT:
			draw(0, { scale: 0.75 + 0.25 * e, alpha: smoothstep(clamp01(s / 0.6)) });
			break;
		case TransitionType.CROSS_ZOOM: {
			const q = edge === 'in' ? 1 - easeOutCubic(s) : easeInCubic(1 - s);
			draw(0, { scale: 1 + 1.2 * q, blur: q * blurReach * 2, alpha: clamp01(s / 0.3) });
			break;
		}
		case TransitionType.SPIN:
			draw(0, { scale: e, rotate: (1 - e) * -side * Math.PI, alpha: smoothstep(clamp01(s / 0.3)) });
			break;
		case TransitionType.FLASH: {
			if (s >= 0.5) draw(0);
			fill(ctx, box, look.color('#FFFFFF'), s >= 0.5 ? smoothstep(clamp01((1 - s) / 0.5)) : smoothstep(clamp01(s / 0.5)));
			break;
		}
		case TransitionType.BLUR:
			draw(0, { alpha: e, blur: (1 - e) * blurReach * 2 });
			break;
		case TransitionType.WIPE:
			draw(0, { clip: (c) => wipeRect(c, box, wayOf(look.direction, 'right'), e, edge === 'out') });
			break;
		case TransitionType.IRIS:
			draw(0, { clip: (c) => c.arc(cx, cy, (e * Math.hypot(box.width, box.height)) / 2, 0, Math.PI * 2) });
			break;
		case TransitionType.LIGHT_LEAK: {
			draw(0, { alpha: smoothstep(clamp01((s - 0.15) / 0.5)) });
			lightLeak(ctx, box, edge === 'in' ? s : 1 - s, Math.sin(Math.PI * s) ** 0.8, look.color('#FF8A3D'));
			break;
		}
		case TransitionType.BLOOM: {
			const glow = 1 - smoothstep(s);
			draw(0, { brightness: 1 + 2.2 * glow, blur: glow * blurReach * 0.5, alpha: smoothstep(clamp01(s / 0.35)) });
			break;
		}
		case TransitionType.SPLIT: {
			const distance = (ux: number) => (ux ? box.width : box.height) / 2;
			for (const half of splitHalves(box, look.direction)) {
				const away = (1 - e) * distance(half.ux);
				draw(0, { clip: half.clip, dx: half.ux * away, dy: half.uy * away });
			}
			break;
		}
		case TransitionType.STRIPES:
			draw(0, { clip: (c) => stripesPath(c, box, wayOf(look.direction, 'right'), s, edge === 'out') });
			break;
		case TransitionType.CLOCK:
			draw(0, { clip: (c) => clockPath(c, box, e) });
			break;
		case TransitionType.GLITCH: {
			// Flickers in (or out) as it settles.
			const intensity = (1 - s) ** 0.6;
			glitch(paint, edge === 'in' ? s : 1 - s, intensity, (roll) => (roll < s * 1.5 ? 0 : null));
			break;
		}
		case TransitionType.IMPACT: {
			if (edge === 'in') {
				draw(0, impactPose(box, s));
				fill(ctx, box, '#FFFFFF', (1 - clamp01(s / 0.18)) * 0.45, 'screen');
			} else {
				const q = easeInCubic(1 - s);
				draw(0, { scale: 1 + 0.14 * q, blur: q * blurReach * 0.7, alpha: clamp01(s / 0.15) });
			}
			break;
		}
		default:
			draw(0, { alpha: s });
			break;
	}
}
