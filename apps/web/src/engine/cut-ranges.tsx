/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Taking stretches of time out of a scene, the way a pause is cut out of a
 * talk: what plays in a stretch goes, and everything after it moves up to
 * close the gap, on every layer at once so picture, sound and overlays stay
 * together.
 *
 * Footage running across a cut is split there like the blade splits it (see
 * `split.tsx`), and the half after it slides back. A layer with no footage of
 * its own, such as a title over the whole talk, is shortened instead, so it
 * stays one layer. Captions are neither: their words live in the transcript,
 * which the caller re-times along with the cut, so here a caption only has
 * its own times kept in line with the words.
 *
 * Everything goes through the editor, synchronously, so a whole cut is one
 * step of the history.
 */

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

/** A stretch of scene time, `[from, to)`, in frames. */
export type FrameRange = readonly [from: number, to: number];

const NODES = Or(Geometry, Group, AdjustmentLayer);

/** Sources that run in time, and so are split at a cut rather than shortened. */
const TIMED_ASSETS: ReadonlySet<string> = new Set(['VIDEO', 'AUDIO', 'SEQUENCE']);

/**
 * Cuts `ranges` out of `scene`. They may come in any order, but must not
 * overlap. Worked from the last to the first, so each is still where it was
 * said to be when its turn comes: a cut only moves what is after it.
 */
export function cutSceneRanges(world: World, scene: Entity, ranges: ReadonlyArray<FrameRange>): void {
	const ordered = ranges.filter(([from, to]) => to > from).sort((a, b) => b[0] - a[0]);
	for (const [from, to] of ordered) cutRange(world, scene, from, to);
}

function cutRange(world: World, scene: Entity, from: number, to: number): void {
	const computed = store(world, Computed);
	const length = to - from;

	// A `<video>` carries its media itself, a `<rect>` with a video fill on the fill.
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
			// Wholly after the cut, it moves as one and its children with it.
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
			// A title or shape over the cut: one layer, shorter by what went.
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

/**
 * Footage over the whole cut: the part before it stays, and a copy plays the
 * part after it from where the cut began. Like a split, two halves beside
 * each other under a scene are wrapped in a sequence so they read as the one
 * clip they were.
 */
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

	// A cut is not an edge: the clip's way in stays at its head, its way out
	// at its tail, and its transitions only at the first half's start and the
	// second half's end.
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

/** Moves a node by `delta` frames, keeping its length and what it plays. */
function shift(world: World, entity: Entity, delta: number): void {
	const end = authoredTime(world, entity, 'end');
	if (end !== undefined) editTime(world, entity, 'end', end + delta);
	editTime(world, entity, 'start', (authoredTime(world, entity, 'start') ?? 0) + delta);
}

/** Where scene frame `frame` lands once `[from, to)` is gone. */
function closeUp(frame: number, from: number, to: number): number {
	if (frame >= to) return frame - (to - from);
	return frame > from ? from : frame;
}

/** A container's own end, when it sets one, moved the way the cut moves what it holds. */
function mapEnd(world: World, entity: Entity, from: number, to: number): void {
	const end = authoredTime(world, entity, 'end');
	if (end === undefined) return;
	const origin = getTimelineOrigin(entity);
	const next = closeUp(origin + end, from, to) - origin;
	if (next !== end) editTime(world, entity, 'end', next);
}

/**
 * A caption's words are re-timed in its transcript, which keeps the caption
 * itself where it is. What it says about time still has to follow them: a
 * caption that starts after the cut starts that much earlier, and reads its
 * transcript from that much earlier too, since the words moved by as much.
 */
function followWords(world: World, entity: Entity, from: number, to: number): void {
	// The source side, where the words are: frame 0 of the transcript plays at
	// the caption's own origin. Read before the start moves it.
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
