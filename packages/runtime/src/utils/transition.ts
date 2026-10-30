/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Or } from 'koota';

import { store } from '../world/store';
import { AdjustmentLayer, ChildOf, Computed, Geometry, Group, Sequential, Transition, TransitionIn } from '../traits';
import { getParentNode } from '../queries/hierarchy';

import type { Entity, World } from 'koota';

export type TransitionWindow = { start: number; end: number; midpointFrame: number };

/** The left clip carries the Transition trait. */
export function getTransitionWindow(
	world: World,
	left: Entity,
	right: Entity,
): TransitionWindow {
	const computed = store(world, Computed);

	const leftEnd = computed.end[left.id()]!;
	const rightStart = computed.start[right.id()]!;

	// Midpoint between the two clips, but never before the left clip ends
	const midpointFrame = Math.max(Math.floor((leftEnd + rightStart) / 2), leftEnd);

	const duration = store(world, Transition).duration[left.id()] ?? 1;
	const start = midpointFrame - duration / 2;
	const end = midpointFrame + duration / 2;

	return { start, end, midpointFrame };
}

function sequenceSiblings(world: World, clip: Entity): readonly Entity[] | null {
	const parent = getParentNode(clip);
	if (parent === null || !parent.has(Sequential)) return null;
	return world.query(ChildOf(parent), Or(Geometry, Group, AdjustmentLayer));
}

/**
 * The clip `clip`'s Transition blends into: the next one in its sequence,
 * starting as it ends. Null outside a sequence, or before a gap, where the
 * clip plays out on its own.
 */
export function getTransitionPartner(world: World, clip: Entity): Entity | null {
	const siblings = sequenceSiblings(world, clip);
	if (!siblings) return null;
	const computed = store(world, Computed);
	const end = computed.end[clip.id()];
	return siblings.find((sibling) => sibling !== clip && computed.start[sibling.id()] === end) ?? null;
}

/**
 * The clip before `clip` in its sequence whose Transition already plays into
 * it, which a TransitionIn on `clip` gives way to.
 */
export function getIncomingTransition(world: World, clip: Entity): Entity | null {
	const siblings = sequenceSiblings(world, clip);
	if (!siblings) return null;
	const computed = store(world, Computed);
	const start = computed.start[clip.id()];
	return siblings.find((sibling) => sibling !== clip && sibling.has(Transition) && computed.end[sibling.id()] === start) ?? null;
}

export type EdgeTransition = {
	edge: 'in' | 'out';
	/** How much of the clip shows, 0 (gone) to 1 (all of it). */
	shown: number;
};

/** Where the in and out windows overlap, the one that shows less of the clip wins. Null when neither is playing. */
export function getEdgeTransition(world: World, clip: Entity, frame: number): EdgeTransition | null {
	const computed = store(world, Computed);
	const start = computed.start[clip.id()] ?? 0;
	const end = computed.end[clip.id()] ?? 0;
	let best: EdgeTransition | null = null;

	if (clip.has(TransitionIn) && !getIncomingTransition(world, clip)) {
		const duration = store(world, TransitionIn).duration[clip.id()] ?? 0;
		if (duration > 0 && frame >= start && frame < start + duration) {
			best = { edge: 'in', shown: (frame - start) / duration };
		}
	}

	if (clip.has(Transition) && !getTransitionPartner(world, clip)) {
		const duration = store(world, Transition).duration[clip.id()] ?? 0;
		if (duration > 0 && frame >= end - duration && frame < end) {
			const shown = (end - frame) / duration;
			if (!best || shown < best.shown) best = { edge: 'out', shown };
		}
	}

	return best;
}
