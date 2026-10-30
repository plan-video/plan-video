/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Sequence } from '@plan.video/reconciler';
import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	Geometry,
	Group,
	Host,
	Selected,
	getActiveEntity,
	getNextName,
	getParentEntity,
	handOffDecoders,
	isGroup,
	isSequence,
	store,
} from '@plan.video/runtime';
import { Or } from 'koota';

import { t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';
import { cloneFramesForSplit, clonePeaksForSplit } from './timeline';
import { trimIn, trimOut } from './timing';

import type { Entity, World } from 'koota';

const NODES = Or(Geometry, Group, AdjustmentLayer);

// The scene is the editing context, so it is never a target, even when selected.
function splitTargets(world: World, scene: Entity): Entity[] {
	const selection = [...world.query(Selected, NODES)].filter((entity) => entity !== scene);
	if (selection.length > 0) return selection;

	return [...world.query(NODES, ChildOf(scene))];
}

// Sequences are opened up: a sequence's time is whatever its children span. "Over it" is read from the bounds,
// not `Computed.visibility`, which playback only updates next tick; bounds also skip clips held visible through a transition.
function splitUnits(world: World, targets: Entity[], frame: number): Entity[] {
	const computed = store(world, Computed);
	const units = new Set<Entity>();

	const walk = (entity: Entity): void => {
		const start = computed.start[entity.id()] ?? 0;
		const end = computed.end[entity.id()] ?? 0;

		if (isSequence(entity)) {
			if (frame < start || frame >= end) return;
			for (const child of world.query(NODES, ChildOf(entity))) walk(child);
			return;
		}

		if (frame <= start || frame >= end) return;

		units.add(entity);
	};

	for (const entity of targets) walk(entity);

	return [...units];
}

export function splitAtPlayhead(world: World): Entity[] {
	const scene = getActiveEntity(world);
	if (scene === null) return [];

	const frame = store(world, Computed).localTime[scene.id()] ?? 0;
	const units = splitUnits(world, splitTargets(world, scene), frame);
	if (units.length === 0) return [];

	const editor = getDocumentEditor(world);
	// Copied before anything is trimmed, so each copy still runs to the end the whole clip ran to.
	const pairs = editor.duplicateInPlace(units);

	for (const { original, copy } of pairs) {
		trimOut(world, original, frame);
		trimIn(world, copy, frame);
		handOffDecoders(world, original, copy);
		clonePeaksForSplit(original.id(), copy.id());
		cloneFramesForSplit(original.id(), copy.id());
		// A cut is not an end: transitions stay at the head and tail, and none plays at the cut until one is put there.
		if (original.get(Host)?.props.transition !== undefined) editor.editProperty(original, 'transition', false);
		if (copy.get(Host)?.props.transitionIn !== undefined) editor.editProperty(copy, 'transitionIn', false);
	}

	// Two clips side by side under a scene are two layers, so the halves are wrapped to read as one clip.
	// A group or sequence parent (every sequence is a group) already does that.
	for (const { original, copy } of pairs) {
		const parent = getParentEntity(original);
		if (parent === null || isGroup(parent)) continue;

		editor.wrap([original, copy], () => <Sequence name={getNextName(world, t('Sequence'))} />);
	}

	const copies = pairs.map(({ copy }) => copy);
	if (copies.length > 0) editor.select(copies);

	return copies;
}
