/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Cache and KeyframeTrack.target are derived state, written through stores without change events.

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Cache,
	Geometry, Group, AdjustmentLayer, IsMask, Paint, Stroke, Shadow, Effect, Grade,
	TextRange, KeyframeTrack, Keyframe, Animation,
} from '../traits';
import { isStage } from '../queries/predicates';
import { getParentEntity, getParentNode } from '../queries/hierarchy';
import { sortByFrame, sortByItemIndex } from '../utils/sort';
import { recomputeEntityTimeRange } from './timing';
import { resetAnimatedValues } from '../systems/motion';

import type { Entity, World } from 'koota';

/** Call after a ChildOf change. `exclude` drops one entity: koota fires relation remove events while the departing child is still in the old parent's queries. */
export function rebuildCaches(world: World, entity: Entity, parent: Entity | null, exclude: Entity | null = null) {
	if (parent === null || isStage(parent)) return;
	if (!parent.has(Cache)) parent.add(Cache);

	const cache = store(world, Cache);
	const pid = parent.id();
	const collect = (...params: Parameters<World['query']>) =>
		[...world.query(...params)].filter(e => e !== exclude);

	if (entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer)) {
		cache.children[pid] = collect(
			Or(Geometry, Group, AdjustmentLayer), ChildOf(parent), Not(IsMask),
		).sort(sortByItemIndex);
	}

	if (entity.has(IsMask)) {
		cache.masks[pid] = collect(Geometry, IsMask, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	// A track attached directly, or carried by a sub-entity (a paint, stroke,
	// effect...) that is attached with tracks already under it: JSX builds
	// bottom-up, so a paint's tracks exist before the paint meets its node.
	if (entity.has(KeyframeTrack) || (!isNodeEntity(entity) && carriesKeyframeTrack(world, entity))) {
		const node = findClosestParentGeometry(parent);
		aggregateKeyframeTracks(world, node, exclude);
		resetAnimatedValues(world, node);
		if (node && speedTrackUnder(node)) recomputeEntityTimeRange(world, node);
	}

	if (entity.has(Keyframe)) {
		cache.keyframes[pid] = collect(Keyframe, ChildOf(parent))
			.sort(sortByFrame);
		refreshSpeedBounds(world, parent);
	}

	if (entity.has(Animation)) {
		cache.animations[pid] = collect(Animation, ChildOf(parent))
			.sort(sortByItemIndex);
		resetAnimatedValues(world, parent);
	}

	// A geometry carrying Paint is not a fill of its parent: that is its own
	// intrinsic paint (see getIntrinsicPaint). Nor is a stroke: its Paint is
	// what the outline is drawn with.
	if (entity.has(Paint) && !entity.has(Geometry) && !entity.has(Stroke)) {
		cache.fills[pid] = collect(Paint, Not(Geometry), Not(Stroke), ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Stroke)) {
		cache.strokes[pid] = collect(Stroke, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Effect)) {
		cache.effects[pid] = collect(Effect, ChildOf(parent), Not(Shadow))
			.sort(sortByItemIndex);
	}

	if (entity.has(Grade)) {
		cache.grades[pid] = collect(Grade, ChildOf(parent))
			.sort(sortByItemIndex);
	}

	if (entity.has(Shadow)) {
		cache.shadows[pid] = collect(Shadow, ChildOf(parent), Not(Effect))
			.sort(sortByItemIndex);
	}

	if (entity.has(TextRange)) {
		cache.textRanges[pid] = collect(TextRange, ChildOf(parent))
			.sort(sortByItemIndex);
	}
}

const CACHE_LISTS = [
	'children', 'fills', 'shadows', 'strokes', 'effects', 'grades',
	'textRanges', 'masks', 'keyframeTracks', 'keyframes', 'animations',
] as const;

/** A destroy strips the entity's traits before it fires the ChildOf removal, so `rebuildCaches` (which files by trait) can't do this; membership still says. */
export function evictFromCaches(world: World, entity: Entity, parent: Entity | null): void {
	if (parent === null || isStage(parent) || !parent.has(Cache)) return;

	const cache = store(world, Cache);
	const pid = parent.id();

	for (const list of CACHE_LISTS) {
		const members = cache[list][pid];
		// A fresh array, not a splice: the lists are read as derived state, and
		// a new identity is the only signal a reader gets that one changed.
		if (members?.includes(entity)) {
			cache[list][pid] = members.filter((member) => member !== entity);
			// The motion system resets Computed only while motion remains, so
			// the last animation to leave must put the base values back itself
			// (rebuildCaches cannot: a destroy strips the traits it files by).
			if (list === 'animations' || list === 'keyframeTracks') {
				resetAnimatedValues(world, parent);
			}
			if (list === 'keyframeTracks') recomputeEntityTimeRange(world, parent);
			if (list === 'keyframes') refreshSpeedBounds(world, parent);
		}
	}
}

/** Edited by hand: koota fires onRemove before the `IsMask` tag is cleared, so the queries can't be trusted. */
export function refileMask(world: World, entity: Entity, parent: Entity | null, mask: boolean): void {
	if (parent === null || isStage(parent)) return;
	if (!parent.has(Cache)) parent.add(Cache);

	const cache = store(world, Cache);
	const pid = parent.id();
	const without = (list: Entity[] | undefined) => (list ?? []).filter((e) => e !== entity);

	const masks = without(cache.masks[pid]);
	const children = without(cache.children[pid]);
	(mask ? masks : children).push(entity);

	cache.masks[pid] = masks.sort(sortByItemIndex);
	cache.children[pid] = children.sort(sortByItemIndex);
}

/** A speed curve changes how long the clip is, so its bounds are re-derived. */
function refreshSpeedBounds(world: World, holder: Entity | null): void {
	const track = holder?.has(Keyframe) ? getParentEntity(holder) : holder;
	if (!track?.has(KeyframeTrack) || track.get(KeyframeTrack)!.property !== 'playbackRate') return;
	const node = findClosestParentGeometry(track);
	if (node) recomputeEntityTimeRange(world, node);
}

function speedTrackUnder(node: Entity): boolean {
	return (node.get(Cache)?.keyframeTracks ?? []).some((track) => track.get(KeyframeTrack)?.property === 'playbackRate');
}

function isNodeEntity(entity: Entity): boolean {
	return entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer);
}

function carriesKeyframeTrack(world: World, entity: Entity): boolean {
	for (const child of world.query(ChildOf(entity))) {
		if (child.has(KeyframeTrack)) return true;
		if (isNodeEntity(child)) continue;
		if (carriesKeyframeTrack(world, child)) return true;
	}
	return false;
}

export function findClosestParentGeometry(entity: Entity): Entity | null {
	let current: Entity | null = entity;
	while (current) {
		if (isNodeEntity(current)) {
			return current;
		}
		current = getParentNode(current);
	}
	return null;
}

/** Stops at nested nodes, and refreshes each track's denormalised `target` so cache readers needn't walk ChildOf. */
export function aggregateKeyframeTracks(world: World, node: Entity | null, exclude: Entity | null = null): void {
	if (node === null) return;
	if (!node.has(Cache)) node.add(Cache);

	const keyframeTrack = store(world, KeyframeTrack);
	const tracks: Entity[] = [];

	const walk = (entity: Entity) => {
		for (const child of world.query(ChildOf(entity))) {
			if (child === exclude) continue;
			if (child.has(KeyframeTrack)) {
				keyframeTrack.target[child.id()] = getParentNode(child);
				tracks.push(child);
				continue;
			}
			if (isNodeEntity(child)) continue;
			walk(child);
		}
	};

	walk(node);
	store(world, Cache).keyframeTracks[node.id()] = tracks;
}
