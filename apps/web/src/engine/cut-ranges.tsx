/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Footage across a cut is split like the blade splits it (see `split.tsx`);
// a layer with no footage of its own is shortened so it stays one layer.
// Captions only follow their words, which the caller re-times. Everything goes
// through the editor synchronously, so a whole cut is one history step.

import { Sequence } from '@plan.video/reconciler';
import {
	AdjustmentLayer,
	Animation,
	AnimationPhase,
	ChildOf,
	Computed,
	Geometry,
	Group,
	findGeometryAsset,
	Host,
	getNextName,
	getParentEntity,
	getTimelineOrigin,
	handOffDecoders,
	isCaption,
	isGroup,
	isMask,
	isScene,
	store,
} from '@plan.video/runtime';
import { Or } from 'koota';

import { t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';
import { cloneFramesForSplit, clonePeaksForSplit } from './timeline';
import { authoredTime, editTime, trimIn, trimOut } from './timing';

import type { Entity, World } from 'koota';

// `[from, to)`, in frames.
export type FrameRange = readonly [from: number, to: number];

const NODES = Or(Geometry, Group, AdjustmentLayer);

const TIMED_ASSETS: ReadonlySet<string> = new Set(['VIDEO', 'AUDIO', 'SEQUENCE']);

// Ranges may come in any order but must not overlap. Worked last to first, so
// each is still where it was said to be: a cut only moves what is after it.
export function cutSceneRanges(world: World, scene: Entity, ranges: ReadonlyArray<FrameRange>): void {
	const ordered = ranges.filter(([from, to]) => to > from).sort((a, b) => b[0] - a[0]);
	for (const [from, to] of ordered) cutRange(world, scene, from, to);
}

function cutRange(world: World, scene: Entity, from: number, to: number): void {
	const computed = store(world, Computed);
	const length = to - from;

	const timed = (entity: Entity): boolean => {
		if (isScene(entity)) return true;
		const type = findGeometryAsset(world, entity)?.type;
		return type !== undefined && TIMED_ASSETS.has(type);
	};

	// Read before anything is cut: a split inserts beside what is being read.
	const leaves: { entity: Entity; start: number; end: number }[] = [];
	const visit = (entity: Entity): void => {
		if (isMask(entity)) return;
		const start = computed.start[entity.id()] ?? 0;
		const end = computed.end[entity.id()] ?? 0;
		if (end <= from) return;

		if (isCaption(entity)) {
			followWords(world, entity, from, to);
			return;
		}

		if (isGroup(entity)) {
			if (start >= to) {
				shift(world, entity, -length);
				return;
			}
			mapEnd(world, entity, from, to);
			for (const child of world.query(NODES, ChildOf(entity))) visit(child);
			return;
		}

		leaves.push({ entity, start, end });
	};
	for (const child of world.query(NODES, ChildOf(scene))) visit(child);

	const editor = getDocumentEditor(world);
	for (const { entity, start, end } of leaves) {
		if (!entity.isAlive()) continue;

		if (start >= to) {
			shift(world, entity, -length);
		} else if (start >= from && end <= to) {
			editor.remove(entity);
		} else if (!timed(entity)) {
			const origin = getTimelineOrigin(entity);
			editTime(world, entity, 'end', (end > to ? end - length : from) - origin);
			if (start > from) editTime(world, entity, 'start', from - origin);
		} else if (start < from && end > to) {
			splitAcross(world, entity, from, to);
		} else if (start < from) {
			trimOut(world, entity, from);
		} else {
			trimIn(world, entity, to);
			shift(world, entity, -length);
		}
	}
}

// Like a split, two halves beside each other under a scene are wrapped in a
// sequence so they read as the one clip they were.
function splitAcross(world: World, entity: Entity, from: number, to: number): void {
	const editor = getDocumentEditor(world);
	const [pair] = editor.duplicateInPlace(entity);
	if (!pair) {
		trimOut(world, entity, from);
		return;
	}
	const { copy } = pair;

	trimOut(world, entity, from);
	trimIn(world, copy, to);
	shift(world, copy, -(to - from));
	handOffDecoders(world, entity, copy);
	clonePeaksForSplit(entity.id(), copy.id());
	cloneFramesForSplit(entity.id(), copy.id());

	// A cut is not an edge: the way in stays at the head, the way out at the tail,
	// transitions only at the first half's start and the second half's end.
	dropAnimations(world, entity, AnimationPhase.OUT);
	dropAnimations(world, copy, AnimationPhase.IN);
	if (entity.get(Host)?.props.transition !== undefined) editor.editProperty(entity, 'transition', false);
	if (copy.get(Host)?.props.transitionIn !== undefined) editor.editProperty(copy, 'transitionIn', false);

	const parent = getParentEntity(entity);
	if (parent !== null && !isGroup(parent)) {
		editor.wrap([entity, copy], () => <Sequence name={getNextName(world, t('Sequence'))} />);
	}
}

function dropAnimations(world: World, entity: Entity, phase: AnimationPhase): void {
	const doomed = [...world.query(Animation, ChildOf(entity))].filter((animation) => animation.get(Animation)?.phase === phase);
	if (doomed.length > 0) getDocumentEditor(world).remove(doomed);
}

function shift(world: World, entity: Entity, delta: number): void {
	const end = authoredTime(world, entity, 'end');
	if (end !== undefined) editTime(world, entity, 'end', end + delta);
	editTime(world, entity, 'start', (authoredTime(world, entity, 'start') ?? 0) + delta);
}

function closeUp(frame: number, from: number, to: number): number {
	if (frame >= to) return frame - (to - from);
	return frame > from ? from : frame;
}

function mapEnd(world: World, entity: Entity, from: number, to: number): void {
	const end = authoredTime(world, entity, 'end');
	if (end === undefined) return;
	const origin = getTimelineOrigin(entity);
	const next = closeUp(origin + end, from, to) - origin;
	if (next !== end) editTime(world, entity, 'end', next);
}

// A caption starting after the cut starts that much earlier and reads its
// transcript from that much earlier too, since the words moved by as much.
function followWords(world: World, entity: Entity, from: number, to: number): void {
	// Frame 0 of the transcript plays at the caption's own origin. Read before the start moves it.
	const words = store(world, Computed).origin[entity.id()] ?? 0;
	const origin = getTimelineOrigin(entity);
	const start = authoredTime(world, entity, 'start');
	const sourceIn = authoredTime(world, entity, 'sourceIn');
	if (start !== undefined) {
		const moved = closeUp(origin + start, from, to) - origin;
		if (moved !== start) {
			editTime(world, entity, 'start', moved);
			if (sourceIn !== undefined) editTime(world, entity, 'sourceIn', Math.max(0, sourceIn + moved - start));
		}
	}
	mapEnd(world, entity, from, to);

	const sourceOut = authoredTime(world, entity, 'sourceOut');
	if (sourceOut !== undefined) {
		const next = closeUp(words + sourceOut, from, to) - words;
		if (next !== sourceOut) editTime(world, entity, 'sourceOut', next);
	}
}
