/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// In actions, not queries: it trims, deletes and splits clips via the overwrite model.

import { Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Geometry, Group, Sequential, Computed,
} from '../traits';
import { isGroup } from '../queries/predicates';
import { getEntityTree, getParentNode } from '../queries/hierarchy';
import { cloneSubtree } from '../world/serialize';
import { deleteEntity } from './entities';
import { trimEntityIn, trimEntityOut } from './timing';

import type { Entity, World } from 'koota';

/**
 * No two direct children of a Sequential overlap in time. Siblings a dragged clip overlaps are
 * removed when covered, trimmed on an edge, or split around it when it lands inside; groups resolve
 * at the leaf level, and an emptied group is removed.
 */
export function resolveSequentialOverlaps(world: World, dragged: Entity[]): void {
	if (dragged.length === 0) return;

	const computed = store(world, Computed);

	// Dragged clips never trim or remove each other.
	const ignore = new Set(dragged);

	for (const entity of dragged) {
		const parent = getParentNode(entity);
		if (parent === null || !parent.has(Sequential)) continue;

		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		// Snapshot the sibling list before mutating: resolution deletes, trims,
		// and clones, all of which change the live query result.
		const siblings = [...world.query(Or(Geometry, Group), ChildOf(parent))]
			.filter(sibling => !ignore.has(sibling));

		for (const sibling of siblings) {
			resolveEntityOverlap(world, sibling, occStart, occEnd, ignore);
		}
	}
}

/**
 * No dragged clips to defer to, so earlier clips (by start frame) win and later ones are trimmed or
 * removed. Each pass trims all later siblings uniformly, so starts stay monotonic and the split
 * case can't arise here.
 */
export function resolveNewSequenceOverlaps(world: World, sequence: Entity): void {
	if (!sequence.has(Sequential)) return;

	const computed = store(world, Computed);

	const children = [...world.query(Or(Geometry, Group), ChildOf(sequence))]
		.sort((a, b) => (computed.start[a.id()] ?? 0) - (computed.start[b.id()] ?? 0));

	const ignore = new Set<Entity>();

	for (let i = 0; i < children.length; i++) {
		const entity = children[i]!;
		// An earlier authoritative clip may have removed or trimmed this one.
		if (!world.has(entity)) continue;
		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		for (let j = i + 1; j < children.length; j++) {
			const sibling = children[j]!;
			if (!world.has(sibling)) continue;
			resolveEntityOverlap(world, sibling, occStart, occEnd, ignore);
		}
	}
}

function resolveEntityOverlap(
	world: World,
	entity: Entity,
	occStart: number,
	occEnd: number,
	ignore: Set<Entity>,
): void {
	const computed = store(world, Computed);

	const start = computed.start[entity.id()];
	const end = computed.end[entity.id()];
	if (start === undefined || end === undefined) return;

	// No temporal overlap. Touching edges (end === occStart or start === occEnd)
	// are abutting, not overlapping.
	if (end <= occStart || start >= occEnd) return;

	// Plain groups (incl. nested Sequential containers) have no intrinsic trim;
	// resolve their leaves and let the group's bounds recompute from what's left.
	if (isGroup(entity)) {
		if (start >= occStart && end <= occEnd) {
			deleteEntity(world, entity);
			return;
		}

		const children = [...world.query(Or(Geometry, Group), ChildOf(entity))]
			.filter(child => !ignore.has(child));
		for (const child of children) {
			resolveEntityOverlap(world, child, occStart, occEnd, ignore);
		}

		const remaining = world.query(Or(Geometry, Group), ChildOf(entity));
		if (remaining.length === 0) deleteEntity(world, entity);
		return;
	}

	const startCovered = start >= occStart;
	const endCovered = end <= occEnd;

	if (startCovered && endCovered) {
		deleteEntity(world, entity);
	} else if (!startCovered && endCovered) {
		trimEntityOut(world, entity, occStart);
	} else if (startCovered && !endCovered) {
		trimEntityIn(world, entity, occEnd);
	} else {
		// The dropped clip lands inside this one: split it into two halves around
		// the span. Clone first so the copy inherits the original (un-shrunk)
		// window, then shrink the original to the left half and the copy to the
		// right half.
		const result = cloneSubtree(world, getEntityTree(world, entity));
		const copy = result.get(entity);

		trimEntityOut(world, entity, occStart);
		if (copy !== undefined) {
			trimEntityIn(world, copy, occEnd);
		}
	}
}
