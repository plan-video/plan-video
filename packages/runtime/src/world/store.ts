/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getStore } from 'koota';

import type { ExtractStore, Trait, World } from 'koota';

// Direct SoA access for hot paths (no snapshots, no change events). koota registers a trait's store
// lazily on first add/query and bare getStore throws before that, so this registers it once per world.
export function store<T extends Trait>(world: World, trait: T): ExtractStore<T> {
	try {
		return getStore(world, trait);
	} catch {
		world.query(trait);
		return getStore(world, trait);
	}
}
