/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { TransitionType } from '../constants';
import { drawTransitionCut, drawTransitionEdge, transitionLook, type TransitionBox, type TransitionPose } from './transition-draw';

const BOX: TransitionBox = { x: 0, y: 0, width: 1920, height: 1080 };
const AREA = BOX.width * BOX.height;

type Shape = { x: number; y: number; width: number; height: number };
type Mark = { kind: 'draw'; side: 0 | 1; pose: TransitionPose; alpha: number; area: number; full: boolean } | { kind: 'fill'; alpha: number };

/** The bounds of what a pose's clip paths, through a recording context. */
function clipShape(pose: TransitionPose): Shape | null {
	if (!pose.clip) return BOX;
	const shapes: Shape[] = [];
	const recorder = {
		rect: (x: number, y: number, width: number, height: number) => shapes.push({ x, y, width, height }),
		arc: (x: number, y: number, radius: number, from = 0, to = Math.PI * 2) => {
			if (radius > 0 && Math.abs(to - from) > 1e-6) shapes.push({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 });
		},
		moveTo: () => {},
		closePath: () => {},
	};
	pose.clip(recorder as unknown as CanvasRenderingContext2D);
	if (shapes.length === 0) return null;
	const left = Math.min(...shapes.map((shape) => shape.x));
	const top = Math.min(...shapes.map((shape) => shape.y));
	const right = Math.max(...shapes.map((shape) => shape.x + shape.width));
	const bottom = Math.max(...shapes.map((shape) => shape.y + shape.height));
	const area = shapes.reduce((sum, shape) => sum + Math.max(0, shape.width) * Math.max(0, shape.height), 0);
	return area > 0 ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

/** How much of the box a draw covers, after its offset and scale. */
function shownArea(pose: TransitionPose): { area: number; full: boolean } {
	const shape = clipShape(pose);
	const scale = pose.scale ?? 1;
	if (!shape || scale <= 1e-3) return { area: 0, full: false };
	const cx = BOX.width / 2;
	const cy = BOX.height / 2;
	const x0 = cx + (shape.x - cx) * scale + (pose.dx ?? 0);
	const y0 = cy + (shape.y - cy) * scale + (pose.dy ?? 0);
	const x1 = x0 + shape.width * scale;
	const y1 = y0 + shape.height * scale;
	const width = Math.max(0, Math.min(x1, BOX.width) - Math.max(x0, 0));
	const height = Math.max(0, Math.min(y1, BOX.height) - Math.max(y0, 0));
	return { area: width * height, full: width * height >= AREA * 0.999 };
}

function record(paint: (painter: Parameters<typeof drawTransitionCut>[0]) => void): Mark[] {
	const marks: Mark[] = [];
	const ctx = {
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		fillStyle: '#000',
		save() {},
		restore() {
			ctx.globalAlpha = 1;
		},
		beginPath() {},
		rect() {},
		clip() {},
		fillRect() {
			marks.push({ kind: 'fill', alpha: ctx.globalAlpha });
		},
		createRadialGradient: () => ({ addColorStop() {} }),
	};
	paint({
		ctx: ctx as unknown as CanvasRenderingContext2D,
		box: BOX,
		frame: BOX,
		draw: (side, pose = {}) => marks.push({ kind: 'draw', side, pose, alpha: pose.alpha ?? 1, ...shownArea(pose) }),
	});
	return marks;
}

const isPlain = (pose: TransitionPose) =>
	Math.abs(pose.dx ?? 0) < 0.5 &&
	Math.abs(pose.dy ?? 0) < 0.5 &&
	Math.abs((pose.scale ?? 1) - 1) < 1e-3 &&
	Math.abs(pose.rotate ?? 0) < 1e-3 &&
	(pose.blur ?? 0) < 0.25 &&
	Math.abs((pose.brightness ?? 1) - 1) < 1e-3 &&
	(pose.split ?? 0) < 0.5;

/** What the frame ends up showing: the marks after the last plain, opaque draw that covers the whole box. */
function showing(marks: Mark[]) {
	let from = 0;
	marks.forEach((mark, index) => {
		if (mark.kind === 'draw' && mark.full && mark.alpha >= 0.999 && isPlain(mark.pose)) from = index;
	});
	return marks.slice(from).filter((mark) => (mark.kind === 'fill' ? mark.alpha > 1e-3 : mark.alpha > 1e-3 && mark.area > AREA * 0.005));
}

/** Only `side`, untouched, across the whole box. */
function expectOnly(marks: Mark[], side: 0 | 1) {
	const shown = showing(marks);
	expect(shown.length).toBeGreaterThan(0);
	for (const mark of shown) {
		expect(mark.kind).toBe('draw');
		if (mark.kind !== 'draw') continue;
		expect(mark.side).toBe(side);
		expect(mark.alpha).toBeGreaterThanOrEqual(0.999);
		expect(isPlain(mark.pose)).toBe(true);
	}
	const area = shown.reduce((sum, mark) => sum + (mark.kind === 'draw' ? mark.area : 0), 0);
	expect(area).toBeGreaterThanOrEqual(AREA * 0.999);
}

const TYPES = Object.values(TransitionType).filter((value): value is TransitionType => typeof value === 'number');

describe('drawTransitionCut', () => {
	// Otherwise the picture jumps as the transition's window opens or closes.
	it.each(TYPES.map((type) => [TransitionType[type], type] as const))('%s starts on the clip going out and ends on the one coming in', (_, type) => {
		const look = transitionLook(type);
		expectOnly(record((painter) => drawTransitionCut(painter, look, 0)), 0);
		expectOnly(record((painter) => drawTransitionCut(painter, look, 1)), 1);
	});
});

describe('drawTransitionEdge', () => {
	it.each(TYPES.map((type) => [TransitionType[type], type] as const))('%s ends on the clip itself, untouched', (_, type) => {
		const look = transitionLook(type);
		expectOnly(record((painter) => drawTransitionEdge(painter, look, 'in', 1)), 0);
		expectOnly(record((painter) => drawTransitionEdge(painter, look, 'out', 1)), 0);
	});

	// An impact lands as a hard cut, so it shows from its first frame.
	it.each(TYPES.filter((type) => type !== TransitionType.IMPACT).map((type) => [TransitionType[type], type] as const))(
		'%s shows nothing of a clip not yet in',
		(_, type) => {
			const look = transitionLook(type);
			expect(showing(record((painter) => drawTransitionEdge(painter, look, 'in', 0)))).toEqual([]);
		},
	);

	it.each(TYPES.map((type) => [TransitionType[type], type] as const))('%s leaves nothing of a clip on its way out', (_, type) => {
		const look = transitionLook(type);
		expect(showing(record((painter) => drawTransitionEdge(painter, look, 'out', 0)))).toEqual([]);
	});
});
