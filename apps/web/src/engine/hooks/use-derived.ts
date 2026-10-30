/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, untrack, type Accessor } from 'solid-js';

import { useEngineContext } from '../context';

/**
 * For state systems write without events (the Computed store, `store()`), which `useTrait`
 * can't follow. `read` is sampled once per engine tick after the systems run and notifies
 * only on change (`===` unless `equals`, so return primitives). Signals inside it aren't tracked.
 */
export function useDerived<T>(read: () => T, equals?: (prev: T, next: T) => boolean): Accessor<T> {
	const { frame } = useEngineContext();

	const sample = () => {
		frame();
		return untrack(read);
	};

	// An explicit `equals: undefined` would switch the memo's default
	// comparison off, not leave it alone.
	return equals ? createMemo(sample, undefined, { equals }) : createMemo(sample);
}
