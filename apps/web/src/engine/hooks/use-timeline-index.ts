/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { buildTimelineLayers, getActiveEntity } from '@plan.video/runtime';
import { useWorld } from '@plan.video/koota-solid';

import { useDerived } from './use-derived';

import type { TimelineIndexValue, TimelineNode } from '@plan.video/runtime';
import type { Accessor } from 'solid-js';

// Reported only when the tree's shape changed: every rebuild is fresh objects,
// and re-rendering the column each frame would be the whole cost of having one.
export function useTimelineIndex(): Accessor<TimelineIndexValue> {
	const world = useWorld();

	return useDerived<TimelineIndexValue>(
		() => {
			const root = getActiveEntity(world);
			return { root, layers: root === null ? [] : buildTimelineLayers(world, root) };
		},
		(prev, next) => prev.root === next.root && sameLayers(prev.layers, next.layers),
	);
}

// Field by field rather than a serialized key: no allocation, and it stops at the first difference.
function sameLayers(a: TimelineNode[], b: TimelineNode[]): boolean {
	if (a.length !== b.length) return false;

	for (let i = 0; i < a.length; i++) {
		const left = a[i]!;
		const right = b[i]!;

		if (
			left.entity !== right.entity
			|| left.kind !== right.kind
			|| left.expanded !== right.expanded
			|| left.expandable !== right.expandable
			|| !sameLayers(left.children, right.children)
		) return false;
	}

	return true;
}
