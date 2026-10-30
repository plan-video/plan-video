/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A grade is one SVG filter: a colour matrix (saturation), then a table per channel. Both work pixel
// by pixel, so a scene's grade applied to each of its draws is the grade of the finished frame.

import { store } from '../world/store';
import { Cache, Grade, Hidden } from '../traits';

import type { Entity, World } from 'koota';

export const GRADE_SLIDERS = [
	'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
	'temperature', 'tint', 'saturation',
] as const;

export type GradeSlider = (typeof GRADE_SLIDERS)[number];

/** The wheels, shadows to highlights: lift, gamma (midtones) and gain. */
export const GRADE_WHEELS = ['lift', 'gamma', 'gain'] as const;

export type GradeWheel = (typeof GRADE_WHEELS)[number];

type WheelProps = {
	[W in GradeWheel as `${W}Hue` | `${W}Amount` | `${W}Level`]: number;
};

export type GradeAdjustments = Record<GradeSlider, number> & WheelProps;

export type GradeValues = GradeAdjustments & {
	/** One of GRADE_LOOKS, or '' for none. */
	look: string;
	/** How much of the look, 0..100. */
	lookAmount: number;
};

export const NEUTRAL_ADJUSTMENTS: GradeAdjustments = {
	exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
	temperature: 0, tint: 0, saturation: 0,
	liftHue: 0, liftAmount: 0, liftLevel: 0,
	gammaHue: 0, gammaAmount: 0, gammaLevel: 0,
	gainHue: 0, gainAmount: 0, gainLevel: 0,
};

export const NEUTRAL_GRADE: GradeValues = { ...NEUTRAL_ADJUSTMENTS, look: '', lookAmount: 100 };

export const GRADE_KEYS = Object.keys(NEUTRAL_GRADE) as (keyof GradeValues)[];

/** Each scaled by `lookAmount`, in the order the picker shows them. */
export const GRADE_LOOKS: Record<string, Partial<GradeAdjustments>> = {
	warm: { temperature: 35, tint: 4, saturation: 8 },
	cool: { temperature: -35, tint: -4, saturation: -4 },
	fresh: { exposure: 8, temperature: -12, tint: -10, contrast: 8, saturation: 12 },
	golden: { temperature: 40, gammaHue: 40, gammaAmount: 22, highlights: -12, saturation: 10 },
	tealOrange: { liftHue: 190, liftAmount: 40, gainHue: 32, gainAmount: 32, contrast: 18, saturation: 12 },
	vivid: { contrast: 22, saturation: 38, shadows: 12, highlights: -12 },
	film: { contrast: -12, blacks: 28, whites: -12, liftHue: 200, liftAmount: 14, gainHue: 40, gainAmount: 16, saturation: -12 },
	faded: { blacks: 42, contrast: -25, saturation: -28 },
	moody: { exposure: -14, contrast: 24, highlights: -26, liftHue: 210, liftAmount: 28, saturation: -22 },
	mono: { saturation: -100 },
	noir: { saturation: -100, contrast: 38, blacks: -16, highlights: 10 },
};

/** The last `<grade>` child that is not hidden. */
export function readGrade(world: World, entity: Entity): GradeValues | null {
	if (!entity.has(Cache)) return null;
	const grades = store(world, Cache).grades[entity.id()];
	if (!grades) return null;

	for (let index = grades.length - 1; index >= 0; index--) {
		const grade = grades[index]!;
		if (grade.isAlive() && !grade.has(Hidden)) return grade.get(Grade) ?? null;
	}
	return null;
}

const toRadians = (degrees: number) => degrees * Math.PI / 180;

/** Sliders and levels add up; wheels add as the colour vectors they are. */
export function effectiveGrade(values: GradeValues): GradeAdjustments {
	const look = GRADE_LOOKS[values.look];
	const share = look ? Math.max(0, values.lookAmount) / 100 : 0;
	const out = { ...values } as GradeAdjustments & Partial<Pick<GradeValues, 'look' | 'lookAmount'>>;
	delete out.look;
	delete out.lookAmount;
	if (!look || share === 0) return out;

	for (const key of GRADE_SLIDERS) out[key] += (look[key] ?? 0) * share;

	for (const wheel of GRADE_WHEELS) {
		const hue = `${wheel}Hue` as const;
		const amount = `${wheel}Amount` as const;
		const level = `${wheel}Level` as const;
		const x = out[amount] * Math.cos(toRadians(out[hue])) + (look[amount] ?? 0) * share * Math.cos(toRadians(look[hue] ?? 0));
		const y = out[amount] * Math.sin(toRadians(out[hue])) + (look[amount] ?? 0) * share * Math.sin(toRadians(look[hue] ?? 0));
		out[amount] = Math.hypot(x, y);
		out[hue] = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
		out[level] += (look[level] ?? 0) * share;
	}
	return out;
}

const EPSILON = 1e-3;

function isNeutral(grade: GradeAdjustments): boolean {
	for (const key of GRADE_SLIDERS) if (Math.abs(grade[key]) > EPSILON) return false;
	for (const wheel of GRADE_WHEELS) {
		if (Math.abs(grade[`${wheel}Amount`]) > EPSILON || Math.abs(grade[`${wheel}Level`]) > EPSILON) return false;
	}
	return true;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

const smoothstep = (edge0: number, edge1: number, x: number) => {
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};

/** A soft hill at `center`, 1 at the top and 0 from `width` away. */
const bump = (x: number, center: number, width: number) => {
	const u = (x - center) / width;
	return u <= -1 || u >= 1 ? 0 : (1 - u * u) ** 2;
};

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toSrgb = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

/** A pure hue as RGB, 0..1. */
function hueRgb(hue: number): [number, number, number] {
	const h = ((hue % 360) + 360) % 360 / 60;
	const x = 1 - Math.abs((h % 2) - 1);
	if (h < 1) return [1, x, 0];
	if (h < 2) return [x, 1, 0];
	if (h < 3) return [0, 1, x];
	if (h < 4) return [0, x, 1];
	if (h < 5) return [x, 0, 1];
	return [1, 0, x];
}

/**
 * How far a wheel pushes each channel: towards its hue by its amount, with
 * the channels' mean taken off so a colour does not also brighten, plus its
 * level on all three.
 */
function wheelShift(grade: GradeAdjustments, wheel: GradeWheel): [number, number, number] {
	const rgb = hueRgb(grade[`${wheel}Hue`]);
	const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
	const amount = grade[`${wheel}Amount`] / 100;
	const level = grade[`${wheel}Level`] / 100;
	return [
		amount * (rgb[0] - mean) + level,
		amount * (rgb[1] - mean) + level,
		amount * (rgb[2] - mean) + level,
	];
}

const SAMPLES = 64;

/** The transfer table of one channel, `SAMPLES` values from black to white. */
function channelTable(grade: GradeAdjustments, channel: 0 | 1 | 2): number[] {
	const temperature = grade.temperature / 100;
	const tint = grade.tint / 100;
	// Warm lifts red and lowers blue; a positive tint is magenta, less green.
	const balance = [
		1 + 0.1 * temperature + 0.03 * tint,
		1 - 0.08 * tint,
		1 - 0.1 * temperature + 0.03 * tint,
	][channel]!;
	// Two stops either way, in linear light.
	const exposure = 2 ** (grade.exposure / 50);
	// A pivoted power curve about the middle grey: steeper above 1.
	const contrast = 2 ** (grade.contrast / 100);
	const lift = wheelShift(grade, 'lift')[channel];
	const gamma = wheelShift(grade, 'gamma')[channel];
	const gain = wheelShift(grade, 'gain')[channel];

	const table: number[] = [];
	for (let index = 0; index < SAMPLES; index++) {
		let y = toSrgb(clamp01(toLinear(index / (SAMPLES - 1)) * balance * exposure));

		y = y < 0.5 ? 0.5 * (2 * y) ** contrast : 1 - 0.5 * (2 - 2 * y) ** contrast;

		const tone = y;
		y += (grade.highlights / 100) * 0.15 * bump(tone, 0.72, 0.35);
		y += (grade.shadows / 100) * 0.15 * bump(tone, 0.28, 0.35);
		y += (grade.whites / 100) * 0.12 * smoothstep(0.5, 1, tone);
		y += (grade.blacks / 100) * 0.12 * (1 - smoothstep(0, 0.5, tone));
		y = clamp01(y);

		y = y * (1 + 0.35 * gain);
		y = y + 0.2 * lift * (1 - y);
		y = clamp01(y) ** (2 ** (-0.8 * gamma));

		table.push(clamp01(y));
	}
	return table;
}

/** The colour matrix for saturation, Rec. 709 weights, as feColorMatrix values. */
function saturationMatrix(saturation: number): number[] {
	const s = Math.max(0, 1 + saturation / 100);
	const r = 0.2126 * (1 - s);
	const g = 0.7152 * (1 - s);
	const b = 0.0722 * (1 - s);
	return [
		r + s, g, b, 0, 0,
		r, g + s, b, 0, 0,
		r, g, b + s, 0, 0,
		0, 0, 0, 1, 0,
	];
}

export type GradePrimitives = {
	matrix: string;
	red: string;
	green: string;
	blue: string;
};

const join = (values: number[]) => values.map((value) => Math.round(value * 10000) / 10000).join(' ');

/** The filter primitives for `values`, or null when the grade changes nothing. */
export function gradePrimitives(values: GradeValues): GradePrimitives | null {
	const grade = effectiveGrade(values);
	if (isNeutral(grade)) return null;
	return {
		matrix: join(saturationMatrix(grade.saturation)),
		red: join(channelTable(grade, 0)),
		green: join(channelTable(grade, 1)),
		blue: join(channelTable(grade, 2)),
	};
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Filters the canvas has been handed, by what they draw, least recently used
 * first. A grade being dragged makes one a step, so the old ones go.
 */
const filters = new Map<string, SVGFilterElement>();
const MAX_FILTERS = 64;
let holder: SVGSVGElement | null = null;
let nextId = 0;

/**
 * Builds `<filter>` content for `primitives` into `filter`: the matrix, then
 * the tables. sRGB throughout, as the tables are written in it.
 */
export function fillGradeFilter(filter: SVGFilterElement, primitives: GradePrimitives): void {
	const ns = filter.namespaceURI ?? SVG_NS;
	filter.setAttribute('color-interpolation-filters', 'sRGB');
	filter.replaceChildren();

	const matrix = document.createElementNS(ns, 'feColorMatrix');
	matrix.setAttribute('type', 'matrix');
	matrix.setAttribute('values', primitives.matrix);
	filter.append(matrix);

	const transfer = document.createElementNS(ns, 'feComponentTransfer');
	for (const [tag, table] of [['feFuncR', primitives.red], ['feFuncG', primitives.green], ['feFuncB', primitives.blue]] as const) {
		const func = document.createElementNS(ns, tag);
		func.setAttribute('type', 'table');
		func.setAttribute('tableValues', table);
		transfer.append(func);
	}
	filter.append(transfer);
}

/**
 * A CSS filter for `values` the canvas can use (`url(#…)`), or null when the
 * grade changes nothing or there is no document to hold the filter in.
 */
export function gradeFilterUrl(values: GradeValues): string | null {
	const primitives = gradePrimitives(values);
	if (primitives === null || typeof document === 'undefined' || !document.body) return null;

	const key = `${primitives.matrix}|${primitives.red}|${primitives.green}|${primitives.blue}`;
	let filter = filters.get(key);

	if (filter?.isConnected) {
		filters.delete(key);
	} else {
		if (!holder?.isConnected) {
			holder = document.createElementNS(SVG_NS, 'svg');
			holder.setAttribute('aria-hidden', 'true');
			holder.setAttribute('width', '0');
			holder.setAttribute('height', '0');
			// Not display:none, which some browsers take as no filter at all.
			holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
			document.body.append(holder);
			filters.clear();
		}
		filter = document.createElementNS(SVG_NS, 'filter');
		filter.id = `pv-grade-${nextId++}`;
		fillGradeFilter(filter, primitives);
		holder.append(filter);
	}

	filters.set(key, filter);
	for (const [stale, element] of filters) {
		if (filters.size <= MAX_FILTERS) break;
		element.remove();
		filters.delete(stale);
	}

	return `url(#${filter.id})`;
}

export function gradeFilter(world: World, entity: Entity): string | null {
	const values = readGrade(world, entity);
	return values ? gradeFilterUrl(values) : null;
}
