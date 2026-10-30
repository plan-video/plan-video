/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A gesture lives on the entities it touches (the snapshot traits), not in a
// variable here, so a clip scrolled off screen and back is still being dragged.
// Writes go through the editor's time props, the same edit as the inspector's.

import {
	AdjustmentLayer,
	ClipDragOrigin,
	Computed,
	Geometry,
	Group,
	KeyframeDragOrigin,
	Selected,
	TrimDragOrigin,
	findAssetDuration,
	readSpeedCurve,
	store,
	timelineFrameAtSource,
} from '@plan.video/runtime';
import { Not, Or } from 'koota';

import { clamp } from '@/utils';
import { resolveSequentialOverlaps } from '../overlap';
import { authoredTime, moveEntityTo, trimIn, trimOut } from '../timing';
import { findSnapDelta, findSnapFrame } from './snapping';
import { settleCaptionWordEdits } from './render/caption';
import { framesToPixels, pixelsToFrames } from './view';

import type { Entity, World } from 'koota';
import type { TimelineSurfaceState } from './surface';

const NODES = Or(Geometry, Group, AdjustmentLayer);

export type TrimEdge = 'in' | 'out';

// Closing happens here because letting go of the pointer is not an event any
// clip receives; a clip only hears that it is still being dragged.
export function updateDragGestures(world: World, surface: TimelineSurfaceState): void {
	const position = surface.pointer?.position;
	const dragging = !!position && position.state !== 'idle';

	if (!dragging) {
		surface.press = null;
		endGesture(world, ClipDragOrigin);
		endGesture(world, TrimDragOrigin);
		for (const keyframe of world.query(KeyframeDragOrigin)) keyframe.remove(KeyframeDragOrigin);
		settleCaptionWordEdits(world);
		return;
	}

	// The rest of the selection is snapshotted here, once, not per clip: a clip
	// scrolled out of view is not drawn and would be left behind by the drag.
	if (world.query(NODES, ClipDragOrigin, Selected).length > 0) {
		for (const entity of world.query(NODES, Selected, Not(ClipDragOrigin))) {
			beginClipDrag(world, entity);
		}
	}
}

// Settles the sequences the clips landed in: the moved clips win, neighbours give way.
function endGesture(world: World, origin: typeof ClipDragOrigin | typeof TrimDragOrigin): void {
	const moved = [...world.query(NODES, origin)];
	if (moved.length === 0) return;

	for (const entity of moved) entity.remove(origin);

	resolveSequentialOverlaps(world, moved);
}

export function beginClipDrag(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	entity.add(ClipDragOrigin);
	entity.set(ClipDragOrigin, {
		authored: authoredTime(world, entity, 'start') ?? 0,
		start: computed.start[eid] ?? 0,
		end: computed.end[eid] ?? 0,
	});
}

export function applyClipDrag(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	resolution: number,
): void {
	const origin = entity.get(ClipDragOrigin)!;

	const floor = -earliestDraggedStart(world);
	const offset = Math.max(pixelsToFrames(draggedPixels(surface), resolution), floor);

	// One snap for the whole drag, unless it would pull back past the floor the pointer just hit.
	const snap = findSnapDelta(world, resolution, offset);
	const snapped = snap !== null && offset - snap.delta >= floor;
	if (snapped) surface.snapX = framesToPixels(snap.frame, resolution);

	moveEntityTo(world, entity, origin.start + offset - (snapped ? snap.delta : 0));
}

function earliestDraggedStart(world: World): number {
	const origins = store(world, ClipDragOrigin);
	let earliest = Number.POSITIVE_INFINITY;
	for (const entity of world.query(NODES, ClipDragOrigin)) {
		earliest = Math.min(earliest, origins.start[entity.id()] ?? 0);
	}
	return Number.isFinite(earliest) ? earliest : 0;
}

export function beginTrim(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	entity.add(TrimDragOrigin);
	entity.set(TrimDragOrigin, {
		start: computed.start[eid] ?? 0,
		end: computed.end[eid] ?? 0,
	});
}

export function applyTrim(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	edge: TrimEdge,
	resolution: number,
): void {
	const origin = entity.get(TrimDragOrigin)!;
	const offset = pixelsToFrames(draggedPixels(surface), resolution);

	const [min, max] = trimBounds(world, entity, edge, origin);
	const wanted = (edge === 'in' ? origin.start : origin.end) + offset;

	// Snapped only where the edge could have gone anyway, or it would look like it
	// stuck and then slipped.
	const snapped = findSnapFrame(world, resolution, wanted);
	const frame = clamp(snapped !== null && snapped > min && snapped < max ? snapped : wanted, min, max);

	if (snapped !== null && frame === snapped) surface.snapX = framesToPixels(frame, resolution);

	if (edge === 'in') trimIn(world, entity, frame);
	else trimOut(world, entity, frame);
}

// Each clip is its own row, so a neighbour is no constraint: only the other
// edge and how much source is left at this end.
function trimBounds(
	world: World,
	entity: Entity,
	edge: TrimEdge,
	origin: { start: number; end: number },
): [min: number, max: number] {
	let min = edge === 'in' ? 0 : origin.start + 1;
	let max = edge === 'in' ? origin.end - 1 : Number.POSITIVE_INFINITY;

	const duration = findAssetDuration(world, entity);
	if (duration === null) return [min, max];

	const computed = entity.get(Computed);
	const rate = computed?.playbackRate || 1;
	const curve = readSpeedCurve(entity);
	const sourceStart = computed?.origin ?? 0;

	if (edge === 'in') min = Math.max(min, sourceStart);
	else max = Math.min(max, curve.keys.length > 0 ? timelineFrameAtSource(entity, duration) : sourceStart + duration / rate);

	return [min, max];
}

function draggedPixels(surface: TimelineSurfaceState): number {
	const position = surface.pointer?.position;
	return position && position.state !== 'idle' ? position.deltaX : 0;
}

export function isDragging(entity: Entity): boolean {
	return entity.has(ClipDragOrigin) || entity.has(TrimDragOrigin);
}
