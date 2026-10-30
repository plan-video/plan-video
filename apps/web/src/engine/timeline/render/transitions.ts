/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, Selected, Transition, TransitionIn, getTransitionWindow, store } from '@plan.video/runtime';

import { getDocumentEditor } from '../../editor';
import { joinAfter, joinBefore, sequenceJoins, takesTransition } from '../../transitions';
import { framesToPixels, getResolution } from '../view';

import type { Entity, World } from 'koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState, TransitionDrop } from '../surface';

const MARKER_SIZE = 16;
const MARKER_RADIUS = 5;
const STRIPE = 6;

const stripes = new Map<string, CanvasPattern | null>();

/** Thin diagonal lines in `color`, the texture of a transition's window. */
function stripePattern(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
	if (stripes.has(color)) return stripes.get(color)!;
	const tile = document.createElement('canvas');
	const scale = window.devicePixelRatio;
	tile.width = tile.height = STRIPE * scale;
	const g = tile.getContext('2d');
	if (!g) return null;
	g.scale(scale, scale);
	g.strokeStyle = color;
	g.lineWidth = 1;
	g.beginPath();
	// Two strokes, so the line carries on across the tile's corner.
	g.moveTo(-1, STRIPE + 1);
	g.lineTo(STRIPE + 1, -1);
	g.moveTo(STRIPE - 1, STRIPE + 1);
	g.lineTo(STRIPE + 1, STRIPE - 1);
	g.stroke();
	const pattern = ctx.createPattern(tile, 'repeat');
	pattern?.setTransform(new DOMMatrix().scale(1 / scale, 1 / scale));
	stripes.set(color, pattern);
	return pattern;
}

/**
 * The cuts of one sequence's row. A cut whose clip plays a transition shows
 * its window as faint stripes over the two clips and a marker on the seam,
 * which selects the clip when clicked. Every cut is noted on the surface in
 * canvas pixels, so a transition dragged in from the panel can find the one
 * under the pointer (see `findTransitionDrop`).
 */
export function renderTransitionMarkers(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	sequence: Entity,
	row: RowCursor,
): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const resolution = getResolution(world, scene);
	const dpr = window.devicePixelRatio;
	const matrix = ctx.getTransform();
	const size = Math.max(10, Math.min(MARKER_SIZE, row.height - 6));
	const mid = row.height / 2;

	for (const join of sequenceJoins(world, sequence)) {
		const x = framesToPixels(join.frame, resolution);

		// Where the seam is on the canvas, for a drop to aim at.
		const top = matrix.transformPoint(new DOMPoint(x, 0));
		surface.joins.push({ clip: join.left, edge: 'out', x: top.x / dpr, top: top.y / dpr, bottom: (top.y + row.height * matrix.d) / dpr });

		const drop = surface.transitionDrop;
		const dropping = drop?.clip === join.left && drop.edge === 'out';
		if (!join.left.has(Transition) && !dropping) continue;

		if (join.left.has(Transition)) {
			const span = getTransitionWindow(world, join.left, join.right);
			const from = framesToPixels(span.start, resolution);
			const to = framesToPixels(span.end, resolution);
			const pattern = stripePattern(ctx, surface.colors.keyframe);
			if (pattern && to > from) {
				ctx.save();
				ctx.globalAlpha = 0.45;
				ctx.fillStyle = pattern;
				ctx.fillRect(from, 2, to - from, row.height - 4);
				ctx.restore();
			}
		}

		pointer.scope(`join-${join.left.id()}`);
		const left = x - size / 2;
		const top0 = mid - size / 2;
		const { hovering, clicked } = pointer.region(left, top0, size, size);
		if (hovering) surface.cursor = 'pointer';
		if (clicked) getDocumentEditor(world).select(join.left);

		const active = dropping || join.left.has(Selected);

		ctx.save();
		ctx.beginPath();
		ctx.roundRect(left, top0, size, size, MARKER_RADIUS);
		ctx.fillStyle = active ? surface.colors.border.ring : surface.colors.background.default;
		ctx.fill();
		if (!active) {
			ctx.strokeStyle = hovering ? surface.colors.keyframe : surface.colors.border.input;
			ctx.lineWidth = 1;
			ctx.stroke();
		}

		// Two triangles meeting at the seam: one clip giving way to the next.
		const glyph = size * 0.3;
		ctx.beginPath();
		ctx.moveTo(x - glyph, mid - glyph * 0.85);
		ctx.lineTo(x, mid);
		ctx.lineTo(x - glyph, mid + glyph * 0.85);
		ctx.closePath();
		ctx.moveTo(x + glyph, mid - glyph * 0.85);
		ctx.lineTo(x, mid);
		ctx.lineTo(x + glyph, mid + glyph * 0.85);
		ctx.closePath();
		ctx.fillStyle = active ? '#FFFFFF' : surface.colors.keyframe;
		ctx.fill();
		ctx.restore();
	}
}

/**
 * The ends of `clips` that are not cuts: where each plays in or out on its
 * own. One that plays shows its window as faint stripes inside the clip and
 * a marker at the clip's edge; every one is noted on the surface for a
 * dragged transition to find, as the cuts are.
 */
export function renderEdgeMarkers(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	clips: Entity[],
	row: RowCursor,
): void {
	const { ctx } = surface;
	if (!ctx) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const dpr = window.devicePixelRatio;
	const matrix = ctx.getTransform();
	const size = Math.max(10, Math.min(MARKER_SIZE, row.height - 6));
	const mid = row.height / 2;

	for (const clip of clips) {
		if (!takesTransition(clip)) continue;
		const start = framesToPixels(computed.start[clip.id()] ?? 0, resolution);
		const end = framesToPixels(computed.end[clip.id()] ?? 0, resolution);

		for (const edge of ['in', 'out'] as const) {
			if ((edge === 'in' ? joinBefore : joinAfter)(world, clip)) continue;

			const x = edge === 'in' ? start : end;
			const top = matrix.transformPoint(new DOMPoint(x, 0));
			surface.joins.push({ clip, edge, x: top.x / dpr, top: top.y / dpr, bottom: (top.y + row.height * matrix.d) / dpr });

			const drop = surface.transitionDrop;
			const dropping = drop?.clip === clip && drop.edge === edge;
			const frames = clip.get(edge === 'in' ? TransitionIn : Transition)?.duration;
			if (frames === undefined && !dropping) continue;

			if (frames !== undefined) {
				const reach = Math.min(framesToPixels(frames, resolution), end - start);
				const from = edge === 'in' ? start : end - reach;
				const pattern = stripePattern(ctx, surface.colors.keyframe);
				if (pattern && reach > 0) {
					ctx.save();
					ctx.globalAlpha = 0.45;
					ctx.fillStyle = pattern;
					ctx.fillRect(from, 2, reach, row.height - 4);
					ctx.restore();
				}
			}

			// Inside the clip by its edge, clear of the trim handle.
			if (end - start < size + 8) continue;
			const left = edge === 'in' ? start + 4 : end - 4 - size;
			const active = dropping || clip.has(Selected);
			const centre = left + size / 2;
			const glyph = size * 0.3;
			// One triangle: pointing into the clip coming in, out of it going out.
			const tip = edge === 'in' ? 1 : -1;

			ctx.save();
			ctx.beginPath();
			ctx.roundRect(left, mid - size / 2, size, size, MARKER_RADIUS);
			ctx.fillStyle = active ? surface.colors.border.ring : surface.colors.background.default;
			ctx.fill();
			if (!active) {
				ctx.strokeStyle = surface.colors.border.input;
				ctx.lineWidth = 1;
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.moveTo(centre - glyph * 0.7 * tip, mid - glyph * 0.85);
			ctx.lineTo(centre + glyph * 0.7 * tip, mid);
			ctx.lineTo(centre - glyph * 0.7 * tip, mid + glyph * 0.85);
			ctx.closePath();
			ctx.fillStyle = active ? '#FFFFFF' : surface.colors.keyframe;
			ctx.fill();
			ctx.restore();
		}
	}
}

/** How far from a clip end, in canvas pixels, a dropped transition still lands on it. */
const DROP_REACH = 24;

/**
 * The clip end a transition dropped at `x`, `y` (canvas pixels) lands on: the
 * nearest one in the row under the pointer, or failing that the nearest one
 * across the rows, within reach. Read from the last frame's ends.
 */
export function findTransitionDrop(surface: TimelineSurfaceState, x: number, y: number): TransitionDrop | null {
	let best: { drop: TransitionDrop; distance: number; inRow: boolean } | null = null;
	for (const mark of surface.joins) {
		const distance = Math.abs(mark.x - x);
		if (distance > DROP_REACH) continue;
		const inRow = y >= mark.top && y <= mark.bottom;
		if (!best || (inRow && !best.inRow) || (inRow === best.inRow && distance < best.distance)) {
			best = { drop: { clip: mark.clip, edge: mark.edge }, distance, inRow };
		}
	}
	return best?.drop ?? null;
}
