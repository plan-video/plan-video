/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Shared by the canvas that draws clips and the DOM column that labels them, so a row and
// its label stay the same height.

import { ClipHeight, Timeline, store } from '@plan.video/runtime';

import { DEFAULT_CLIP_HEIGHT, KEYFRAME_TRACK_HEIGHT } from './config';

import type { TimelineNode } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

/** Threaded through the render pass rather than kept on the surface: it only means anything mid-walk. */
export type RowCursor = {
	top: number;
	height: number;
};

export function getNodeHeight(node: TimelineNode): number {
	if (node.kind === 'geometry') {
		return node.entity.get(ClipHeight)?.value ?? DEFAULT_CLIP_HEIGHT;
	}

	return KEYFRAME_TRACK_HEIGHT;
}

export function getSubtreeHeight(node: TimelineNode): number {
	let height = getNodeHeight(node);
	for (const child of node.children) height += getSubtreeHeight(child);
	return height;
}

export function getRowsHeight(nodes: TimelineNode[]): number {
	let height = 0;
	for (const node of nodes) height += getSubtreeHeight(node);
	return height;
}

/** So a render function can work in the row's own space from (0, 0). */
export function getRowTransform(world: World, scene: Entity, top: number): DOMMatrix | undefined {
	return store(world, Timeline).transform[scene.id()]?.translate(0, top);
}
