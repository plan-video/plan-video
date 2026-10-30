/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Transitions as the panel, the timeline and the menus put them on. Every
 * clip has two ends. Its end is its `transition` prop: into the next clip
 * where that is a cut, or out on its own. Its start is its `transitionIn`
 * prop, unless it is the far side of a cut, whose transition the clip before
 * it carries (see `Transition` and `TransitionIn`). A join is two clips of one
 * sequence that meet, the left one carrying whatever plays between them.
 */

import { createSignal } from 'solid-js';
import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	FrameRate,
	Geometry,
	Group,
	Sequential,
	Transition,
	TransitionIn,
	colorToHex,
	framesToSeconds,
	getActiveEntity,
	getParentEntity,
	getParentNode,
	isAdjustmentLayer,
	isAudio,
	isMask,
	isScene,
	store,
} from '@plan.video/runtime';
import { TRANSITION_DIRECTIONS, TRANSITION_EASINGS, TRANSITION_TYPES } from '@plan.video/reconciler';
import { Or } from 'koota';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';
import type { TransitionType as TransitionName } from '@plan.video/jsx';

/** What dragging a transition tile carries: the style's name. */
export const TRANSITION_DRAG_TYPE = 'application/x-planvideo-transition';

/** How long a transition put on from the panel lasts, centred on a cut or inside a clip's end. */
export const TRANSITION_SECONDS = 0.5;

/** Which end of a clip: its start or its end. */
export type ClipEdge = 'in' | 'out';

/**
 * Where a transition at one end of a clip is written: the prop, on the clip
 * that carries it, and the clip it blends into if that end is a cut.
 */
export type Spot = {
	clip: Entity;
	prop: 'transition' | 'transitionIn';
	partner: Entity | null;
};

export type Join = {
	/** The clip going out, which carries the transition. */
	left: Entity;
	right: Entity;
	/** The frame the two meet at, in the sequence's own time. */
	frame: number;
};

/** The style the Transitions panel has picked, which "every cut" puts on. */
const [pickedTransition, setPickedTransition] = createSignal<TransitionName>('dissolve');
export { pickedTransition, setPickedTransition };

/**
 * An end of a clip whose settings the inspector should open: the Transitions
 * panel asks for one when it puts a transition on, so its settings show
 * where they are changed. The inspector clears it once it has opened it.
 */
const [transitionEndRequest, requestTransitionEnd] = createSignal<{ clip: Entity; edge: ClipEdge } | null>(null, {
	equals: false,
});
export { transitionEndRequest, requestTransitionEnd };

/** The joins of one sequence, left to right. */
export function sequenceJoins(world: World, sequence: Entity): Join[] {
	const computed = store(world, Computed);
	const clips = [...world.query(ChildOf(sequence), Or(Geometry, Group, AdjustmentLayer))].sort(
		(a, b) => (computed.start[a.id()] ?? 0) - (computed.start[b.id()] ?? 0),
	);
	const joins: Join[] = [];
	for (const left of clips) {
		const end = computed.end[left.id()];
		const right = clips.find((clip) => clip !== left && computed.start[clip.id()] === end);
		if (right && end !== undefined) joins.push({ left, right, frame: end });
	}
	return joins;
}

/** Whether `entity` sits anywhere under `ancestor`. */
function isUnder(entity: Entity, ancestor: Entity): boolean {
	for (let node = getParentEntity(entity); node; node = getParentEntity(node)) {
		if (node === ancestor) return true;
	}
	return false;
}

/** Every join in `scene`, across all its sequences. */
export function sceneJoins(world: World, scene: Entity): Join[] {
	return [...world.query(Sequential)].filter((sequence) => isUnder(sequence, scene)).flatMap((sequence) => sequenceJoins(world, sequence));
}

/** The join `clip` goes out of, if it is in a sequence and has a clip after it. */
export function joinAfter(world: World, clip: Entity): Join | null {
	const parent = getParentNode(clip);
	if (!parent?.has(Sequential)) return null;
	return sequenceJoins(world, parent).find((join) => join.left === clip) ?? null;
}

/** The join `clip` comes in from, if it is in a sequence and has a clip touching it before. */
export function joinBefore(world: World, clip: Entity): Join | null {
	const parent = getParentNode(clip);
	if (!parent?.has(Sequential)) return null;
	return sequenceJoins(world, parent).find((join) => join.right === clip) ?? null;
}

/** Whether a transition can go on `entity`: anything drawn on the canvas but a scene, a mask or an adjustment layer. */
export function takesTransition(entity: Entity): boolean {
	return !isScene(entity) && !isMask(entity) && !isAudio(entity) && !isAdjustmentLayer(entity);
}

/** Where a transition at `edge` of `clip` goes (see `Spot`). */
export function spotAt(world: World, clip: Entity, edge: ClipEdge): Spot {
	if (edge === 'out') return { clip, prop: 'transition', partner: joinAfter(world, clip)?.right ?? null };
	const join = joinBefore(world, clip);
	return join ? { clip: join.left, prop: 'transition', partner: clip } : { clip, prop: 'transitionIn', partner: null };
}

/** The spot a join's transition is written to. */
export function joinSpot(join: Join): Spot {
	return { clip: join.left, prop: 'transition', partner: join.right };
}

/** Both ends of each clip, once each: two clips side by side share the cut between them. */
export function clipSpots(world: World, clips: Entity[]): Spot[] {
	const spots: Spot[] = [];
	for (const clip of clips.filter(takesTransition)) {
		for (const edge of ['in', 'out'] as const) {
			const spot = spotAt(world, clip, edge);
			if (!spots.some((other) => other.clip === spot.clip && other.prop === spot.prop)) spots.push(spot);
		}
	}
	return spots;
}

/** What plays at `spot` now, if anything. */
export function spotTransition(spot: Spot) {
	return spot.clip.get(spot.prop === 'transition' ? Transition : TransitionIn);
}

/**
 * A transition's finer settings as the file spells them, each left out
 * while it is the style's own: which way it goes, the curve it plays along,
 * the colour a fade or flash goes through.
 */
export type TransitionFinish = {
	direction?: string;
	easing?: string;
	color?: string;
};

const nameOf = (names: Record<string, number>, value: number | undefined) =>
	Object.keys(names).find((name) => names[name] === value);

/** The finer settings at `spot` now. */
export function spotFinish(spot: Spot): TransitionFinish {
	const current = spotTransition(spot);
	const finish: TransitionFinish = {};
	if (!current) return finish;
	const direction = nameOf(TRANSITION_DIRECTIONS, current.direction);
	const easing = nameOf(TRANSITION_EASINGS, current.easing);
	if (direction) finish.direction = direction;
	if (easing) finish.easing = easing;
	if (current.color >= 0) finish.color = colorToHex(current.color);
	return finish;
}

/**
 * A length that fits the spot. A cut's is no longer than either clip, so
 * neither plays past its own end; a clip's own is no longer than half of it,
 * so its start and end have room for one each.
 */
function fittedSeconds(world: World, spot: Spot, seconds: number): number {
	const computed = store(world, Computed);
	const fps = world.get(FrameRate)?.value ?? 30;
	const length = (clip: Entity) => framesToSeconds((computed.end[clip.id()] ?? 0) - (computed.start[clip.id()] ?? 0), fps);
	const room = spot.partner ? Math.min(length(spot.clip), length(spot.partner)) : length(spot.clip) / 2;
	return Math.max(0.1, Math.round(Math.min(seconds, room) * 10) / 10);
}

/**
 * Writes `name` lasting `seconds` (fitted to it) at `spot`, keeping the
 * finer settings it already has unless handed others. Written whole: the
 * document reads a setting left out as the style's own.
 */
export function writeTransition(
	world: World,
	spot: Spot,
	name: TransitionName,
	seconds: number,
	finish: TransitionFinish = spotFinish(spot),
): void {
	getDocumentEditor(world).editProperty(spot.clip, spot.prop, { type: name, duration: fittedSeconds(world, spot, seconds), ...finish });
}

/** The name and length in seconds of what plays at `spot`, if anything. */
function spotSpec(world: World, spot: Spot): { name: TransitionName; seconds: number } | null {
	const current = spotTransition(spot);
	if (!current) return null;
	const name = nameOf(TRANSITION_TYPES, current.type) as TransitionName | undefined;
	return { name: name ?? 'dissolve', seconds: framesToSeconds(current.duration, world.get(FrameRate)?.value ?? 30) };
}

/** Sets each spot's transition to last `seconds`, fitted to it. One step to undo. */
export function setTransitionLength(world: World, spots: Spot[], seconds: number): void {
	for (const spot of spots) {
		const spec = spotSpec(world, spot);
		if (spec) writeTransition(world, spot, spec.name, seconds);
	}
}

/**
 * Changes finer settings on each spot's transition: a value sets one, null
 * puts the style's own back. One step to undo.
 */
export function setTransitionFinish(world: World, spots: Spot[], change: { [Key in keyof TransitionFinish]?: string | null }): void {
	for (const spot of spots) {
		const spec = spotSpec(world, spot);
		if (!spec) continue;
		const finish: TransitionFinish = { ...spotFinish(spot) };
		for (const key of Object.keys(change) as (keyof TransitionFinish)[]) {
			const value = change[key];
			if (value === null || value === undefined) delete finish[key];
			else finish[key] = value;
		}
		writeTransition(world, spot, spec.name, spec.seconds, finish);
	}
}

/**
 * Puts `name` on each spot, keeping the length one already has. One
 * synchronous burst of edits, so it is one step to undo.
 */
export function applyTransition(world: World, spots: Spot[], name: TransitionName): number {
	const fps = world.get(FrameRate)?.value ?? 30;
	for (const spot of spots) {
		const current = spotTransition(spot);
		writeTransition(world, spot, name, current ? framesToSeconds(current.duration, fps) : TRANSITION_SECONDS);
	}
	return spots.length;
}

/** Takes the transition off a spot. */
export function clearTransition(world: World, spot: Spot): void {
	// `false` is how the writer spells the prop's absence.
	getDocumentEditor(world).editProperty(spot.clip, spot.prop, false);
}

/** Puts `name` on every cut of the active scene. Returns how many it went on. */
export function applyTransitionEverywhere(world: World, name: TransitionName): number {
	const scene = getActiveEntity(world);
	if (!scene || !isScene(scene)) return 0;
	return applyTransition(world, sceneJoins(world, scene).map(joinSpot), name);
}

/** Takes both transitions off each of `clips` that has one. Returns how many it took off. */
export function removeTransitions(world: World, clips: Entity[]): number {
	const editor = getDocumentEditor(world);
	let removed = 0;
	for (const clip of clips) {
		for (const [trait, prop] of [[Transition, 'transition'], [TransitionIn, 'transitionIn']] as const) {
			if (!clip.has(trait)) continue;
			editor.editProperty(clip, prop, false);
			removed++;
		}
	}
	return removed;
}
