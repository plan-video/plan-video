/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Written through the store rather than `entity.set`: where the timeline looks isn't an edit of
// the project, so nothing observes it.

import { FrameRate, Timeline } from '../traits';
import { store } from '../world/store';

import type { Entity, World } from 'koota';
import type { TimelineView } from '../queries/timeline-view';

/** Zoom px per second, x seconds, y px. Unclamped, like `setCameraMatrix`; a zoom of 0 or less is refused whole. */
export function setTimelineView(world: World, scene: Entity, [zoom, x, y]: TimelineView): void {
	if (!(zoom > 0) || !Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) return;

	const fps = world.get(FrameRate)?.value ?? 30;
	if (!scene.has(Timeline)) scene.add(Timeline);

	const view = store(world, Timeline);
	const eid = scene.id();
	view.resolution[eid] = zoom / fps;
	view.scrollX[eid] = x * fps;
	view.scrollY[eid] = y;
}
