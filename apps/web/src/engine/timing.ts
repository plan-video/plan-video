/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Trims go through here, not the runtime's `trimEntityIn`/`trimEntityOut`: those write Delay/Trim
// directly, which moves the clip on screen but never tells the file.

import {
	Computed,
	FrameRate,
	Host,
	framesToSeconds,
	getSourceFrameAt,
	getTimelineOrigin,
	secondsToFrames,
	setPlayhead,
	store,
} from '@plan.video/runtime';
import { parseTime } from '@plan.video/jsx';

import { getDocumentEditor } from './editor';

import type { Time } from '@plan.video/jsx';
import type { Entity, World } from 'koota';

export type TimeProp = 'start' | 'end' | 'sourceIn' | 'sourceOut';

// Reads the host's authored copy, not the traits: Delay and Trim fold the four props together,
// and an edit has to know what the file actually says to rewrite it.
export function authoredTime(world: World, entity: Entity, name: TimeProp): number | undefined {
	const value = entity.get(Host)?.props[name];
	const seconds = typeof value === 'number' || typeof value === 'string'
		? parseTime(value as Time | string)
		: undefined;
	if (seconds === undefined) return undefined;

	return secondsToFrames(seconds, world.get(FrameRate)?.value ?? 30);
}

// `false` is the one PropValue the writer removes the attribute for. A `start` or `sourceIn` of 0
// is unset too, since absence is what 0 reads as on those.
export function editTime(world: World, entity: Entity, name: TimeProp, frames: number | null): void {
	const unset = frames === null || (frames === 0 && (name === 'start' || name === 'sourceIn'));
	const fps = world.get(FrameRate)?.value ?? 30;
	getDocumentEditor(world).editProperty(entity, name, unset ? false : framesToSeconds(frames, fps));
}

export function editWorkarea(world: World, scene: Entity, range: [start: number, end: number] | null): void {
	const fps = world.get(FrameRate)?.value ?? 30;
	getDocumentEditor(world).editProperty(
		scene,
		'workarea',
		range ? [framesToSeconds(range[0], fps), framesToSeconds(range[1], fps)] : false,
	);
}

// Only timeline gestures write the playhead to the file; playback and steps use `setPlayhead` alone,
// since a write per frame costs too much. No `previous`, so it never enters the history.
export function editPlayhead(world: World, scene: Entity, frame: number): void {
	setPlayhead(world, scene, frame);
	const fps = world.get(FrameRate)?.value ?? 30;
	const at = store(world, Computed).localTime[scene.id()] ?? 0;
	getDocumentEditor(world).reportEdit(scene, 'playhead', at === 0 ? false : framesToSeconds(at, fps));
}

// The out point is only implied while the node authors no end, so pin it first or the tail would follow the head.
export function trimIn(world: World, entity: Entity, frame: number): void {
	if (authoredTime(world, entity, 'end') === undefined) {
		editTime(world, entity, 'end', (entity.get(Computed)?.end ?? 0) - getTimelineOrigin(entity));
	}
	// Both read the origin, which the start write moves.
	const start = frame - getTimelineOrigin(entity);
	const source = getSourceFrameAt(entity, frame);
	editTime(world, entity, 'start', start);
	editTime(world, entity, 'sourceIn', source);
}

export function trimOut(world: World, entity: Entity, frame: number): void {
	if (authoredTime(world, entity, 'sourceOut') !== undefined) {
		editTime(world, entity, 'sourceOut', getSourceFrameAt(entity, frame));
	}
	editTime(world, entity, 'end', frame - getTimelineOrigin(entity));
}

// Start and end are both parent-relative, so a move shifts both; writing only start would stretch the clip.
// A container that takes its bounds from its children authors no end, so only its start moves.
export function moveEntityTo(world: World, entity: Entity, frame: number): void {
	const start = frame - getTimelineOrigin(entity);
	const delta = start - (authoredTime(world, entity, 'start') ?? 0);
	if (delta === 0) return;

	// Read the end before writing the start, which moves the origin the end is read against.
	const end = authoredTime(world, entity, 'end');
	if (end !== undefined) editTime(world, entity, 'end', end + delta);

	editTime(world, entity, 'start', start);
}
