/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The editor's copy of the runtime's sequence no-overlap rule (`resolveSequentialOverlaps`),
// spelled as document edits so the file says what the timeline shows. What was just
// dropped wins: siblings it covers are trimmed, removed, or split in two.

import { ChildOf, Computed, Geometry, Group, Sequential, getParentNode, isGroup, store } from '@plan.video/runtime';
import { Or } from 'koota';

import { getDocumentEditor } from './editor';
import { trimIn, trimOut } from './timing';

import type { DocumentEditor } from './editor';
import type { Entity, World } from 'koota';

/** `dragged` is authoritative: those clips keep what they are and never trim or remove each other. */
export function resolveSequentialOverlaps(world: World, dragged: Entity[]): void {
	if (dragged.length === 0) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);
	const ignore = new Set(dragged);

	for (const entity of dragged) {
		const parent = getParentNode(entity);
		if (parent === null || !parent.has(Sequential)) continue;

		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		// Snapshot first: resolving changes the live query, and a split's copy is the other half
		// of a sibling already dealt with, not another one.
		const siblings = [...world.query(Or(Geometry, Group), ChildOf(parent))]
			.filter((sibling) => !ignore.has(sibling));

		for (const sibling of siblings) {
			resolveEntityOverlap(world, editor, sibling, occStart, occEnd, ignore);
		}
	}
}

/**
 * For a new sequence with no dropped clip: the earlier start wins. Starts stay in order,
 * so the split-inside case cannot come up here, only edge trims and removals.
 */
export function resolveNewSequenceOverlaps(world: World, sequence: Entity): void {
	if (!sequence.has(Sequential)) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);

	const children = [...world.query(Or(Geometry, Group), ChildOf(sequence))]
		.sort((a, b) => (computed.start[a.id()] ?? 0) - (computed.start[b.id()] ?? 0));

	const ignore = new Set<Entity>();

	for (let i = 0; i < children.length; i++) {
		const entity = children[i]!;
		// An earlier authoritative clip may have trimmed or removed this one.
		if (!entity.isAlive()) continue;

		const occStart = computed.start[entity.id()];
		const occEnd = computed.end[entity.id()];
		if (occStart === undefined || occEnd === undefined || occEnd <= occStart) continue;

		for (let j = i + 1; j < children.length; j++) {
			const sibling = children[j]!;
			if (!sibling.isAlive()) continue;
			resolveEntityOverlap(world, editor, sibling, occStart, occEnd, ignore);
		}
	}
}

/** A group has no time of its own: its leaves are settled and its bounds follow. */
function resolveEntityOverlap(
	world: World,
	editor: DocumentEditor,
	entity: Entity,
	occStart: number,
	occEnd: number,
	ignore: Set<Entity>,
): void {
	const computed = store(world, Computed);

	const start = computed.start[entity.id()];
	const end = computed.end[entity.id()];
	if (start === undefined || end === undefined) return;

	// Touching edges abut, they do not overlap.
	if (end <= occStart || start >= occEnd) return;

	if (isGroup(entity)) {
		if (start >= occStart && end <= occEnd) {
			editor.remove(entity);
			return;
		}

		const children = [...world.query(Or(Geometry, Group), ChildOf(entity))]
			.filter((child) => !ignore.has(child));
		for (const child of children) {
			resolveEntityOverlap(world, editor, child, occStart, occEnd, ignore);
		}

		if (world.query(Or(Geometry, Group), ChildOf(entity)).length === 0) {
			editor.remove(entity);
		}
		return;
	}

	const startCovered = start >= occStart;
	const endCovered = end <= occEnd;

	if (startCovered && endCovered) {
		editor.remove(entity);
	} else if (!startCovered && endCovered) {
		trimOut(world, entity, occStart);
	} else if (startCovered && !endCovered) {
		trimIn(world, entity, occEnd);
	} else {
		// Copied before either half is trimmed, so the copy is spelled from the whole clip.
		const [pair] = editor.duplicateInPlace([entity]);

		trimOut(world, entity, occStart);
		if (pair) trimIn(world, pair.copy, occEnd);
	}
}
