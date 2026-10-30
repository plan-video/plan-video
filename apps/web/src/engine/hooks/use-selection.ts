/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AdjustmentLayer, Geometry, Group, Keyframe, Selected } from '@plan.video/runtime';
import { useQuery } from '@plan.video/koota-solid';
import { createMemo } from 'solid-js';

/** Write via `useEditor().select/deselect/clearSelection`, which report to the source; never touch the trait. */
export function useSelection() {
	const selected = useQuery(Selected);

	const nodes = createMemo(() =>
		selected().filter(entity => entity.has(Geometry) || entity.has(Group) || entity.has(AdjustmentLayer)),
	);
	const keyframes = createMemo(() => selected().filter(entity => entity.has(Keyframe)));
	const first = createMemo(() => nodes()[0] ?? null);

	return { nodes, keyframes, first };
}
