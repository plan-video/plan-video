/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Snaps in frames, not pixels: rounding to pixels and back jitters a clip by a frame at fractional zooms.

import {
	AdjustmentLayer,
	ChildOf,
	ClipDragOrigin,
	Computed,
	Geometry,
	Group,
	Selected,
	TrimDragOrigin,
	getActiveEntity,
	getParentEntity,
	store,
} from '@plan.video/runtime';
import { Or } from 'koota';

import { SNAP_DISTANCE } from './config';
import { framesToPixels, getCurrentFrame } from './view';

import type { Entity, World } from 'koota';

const NODES = Or(Geometry, Group, AdjustmentLayer);

// Anything whose time moves with the drag (an ancestor bounded by it, a descendant carried by it) is no target.
export function getSnapFrames(world: World): number[] {
	const scene = getActiveEntity(world);
	if (scene === null) return [];

	const computed = store(world, Computed);

	const active = [...world.query(NODES, ClipDragOrigin), ...world.query(NODES, TrimDragOrigin)];
	const excluded = new Set<Entity>(active);

	for (const entity of active) {
		for (let parent = getParentEntity(entity); parent && parent !== scene; parent = getParentEntity(parent)) {
			excluded.add(parent);
		}
		for (const descendant of descendantsOf(world, entity)) excluded.add(descendant);
	}

	const frames = new Set<number>([0, getCurrentFrame(world, scene)]);

	for (const entity of descendantsOf(world, scene)) {
		if (excluded.has(entity) || entity.has(Selected)) continue;
		frames.add(computed.start[entity.id()] ?? 0);
		frames.add(computed.end[entity.id()] ?? 0);
	}

	return [...frames];
}

// Edges come from the drag-start snapshots, not where clips are now: a group's edges are its children's, which already moved.
export function findSnapDelta(world: World, resolution: number, offsetFrames: number): { delta: number; frame: number } | null {
	const origins = store(world, ClipDragOrigin);

	const edges = new Set<number>();
	for (const entity of world.query(NODES, ClipDragOrigin)) {
		const eid = entity.id();
		edges.add((origins.start[eid] ?? 0) + offsetFrames);
		edges.add((origins.end[eid] ?? 0) + offsetFrames);
	}

	return nearestSnap(getSnapFrames(world), edges, resolution);
}

export function findSnapFrame(world: World, resolution: number, frame: number): number | null {
	return nearestSnap(getSnapFrames(world), new Set([frame]), resolution)?.frame ?? null;
}

function nearestSnap(frames: number[], edges: Set<number>, resolution: number): { delta: number; frame: number } | null {
	let best: { delta: number; frame: number; distance: number } | null = null;

	for (const frame of frames) {
		for (const edge of edges) {
			const delta = edge - frame;
			const distance = Math.abs(framesToPixels(delta, resolution));
			if (distance >= SNAP_DISTANCE) continue;
			if (best && distance >= best.distance) continue;
			best = { delta, frame, distance };
		}
	}

	return best === null ? null : { delta: best.delta, frame: best.frame };
}

function descendantsOf(world: World, entity: Entity): Entity[] {
	const found: Entity[] = [];

	const walk = (parent: Entity): void => {
		for (const child of world.query(NODES, ChildOf(parent))) {
			found.push(child);
			walk(child);
		}
	};

	walk(entity);

	return found;
}
