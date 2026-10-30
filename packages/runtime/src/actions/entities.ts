/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// No history layer here: the app records undo entries by observing koota add/remove/change events.

import { DEFAULT_DURATION_FRAMES } from '../constants';
import { Computed, Cache } from '../traits';

import type { Entity, World } from 'koota';

/** Computed/Cache are pre-attached (systems index their stores unconditionally); starts as a child of the stage. */
export function createEntity(world: World): Entity {
	return world.spawn(
		// Overrides where the neutral trait default differs from the values a
		// fresh unparented entity must render with.
		Computed({
			width: 300,
			height: 300,
			strokeWidth: 1,
			end: DEFAULT_DURATION_FRAMES,
			duration: DEFAULT_DURATION_FRAMES,
		}),
		Cache,
	);
}

/** ChildOf is autoDestroy 'orphan', so destroying the root cascades through every descendant. */
export function deleteEntity(_world: World, entity: Entity) {
	entity.destroy();
}
