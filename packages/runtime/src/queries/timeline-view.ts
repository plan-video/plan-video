/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The round-trip form; the editor's own reads go through its view helpers. Writes live in
// actions/timeline-view.ts.

import { FrameRate, Timeline } from '../traits';
import { store } from '../world/store';

import type { Entity, World } from 'koota';

/** Zoom px per second, x seconds, y px: seconds rather than the trait's frames, so it survives a frame-rate change. */
export type TimelineView = [zoom: number, x: number, y: number];

/** The scene's view in file form, or null while it has never been looked at. */
export function getTimelineView(world: World, scene: Entity): TimelineView | null {
	if (!scene.has(Timeline)) return null;

	const fps = world.get(FrameRate)?.value ?? 30;
	const view = store(world, Timeline);
	const eid = scene.id();

	return [(view.resolution[eid] ?? 1) * fps, (view.scrollX[eid] ?? 0) / fps, view.scrollY[eid] ?? 0];
}
