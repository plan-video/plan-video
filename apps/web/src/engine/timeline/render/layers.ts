/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	Geometry,
	Group,
	Hovering,
	Sequential,
	buildTimelineLayers,
	store,
} from '@plan.video/runtime';
import { Or } from 'koota';

import { getNodeHeight, getRowTransform, getSubtreeHeight } from '../layout';
import { getResolution, getViewport, pixelsToFrames } from '../view';
import { isDragging } from '../drag';
import { getClipAlpha, renderClip } from './clip';
import { renderKeyframeTrack } from './keyframes';
import { renderEdgeMarkers, renderTransitionMarkers } from './transitions';

import type { Entity, World } from 'koota';
import type { TimelineNode } from '@plan.video/runtime';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

// So a clip does not pop in the moment its edge crosses the viewport.
const VIEWPORT_PADDING = 10;

export function renderLayers(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const ctx = surface.ctx;
	if (!ctx) return;

	const resolution = getResolution(world, scene);
	const [left, right] = getViewport(world, scene, surface.layout.width);
	const minFrame = pixelsToFrames(left - VIEWPORT_PADDING, resolution);
	const maxFrame = pixelsToFrames(right + VIEWPORT_PADDING, resolution);

	const computed = store(world, Computed);
	const row: RowCursor = { top: 0, height: 0 };

	ctx.save();

	const walk = (nodes: TimelineNode[], parent: Entity | null): void => {
		for (const node of nodes) {
			if (node.kind === 'keyframe-track') {
				row.height = getNodeHeight(node);
				renderKeyframeTrack(world, scene, surface, node.entity, row);
				row.top += row.height;
				continue;
			}

			// A sub-item is a label in the DOM column and nothing on the canvas.
			if (node.kind === 'sub-item') {
				row.top += getNodeHeight(node);
				walk(node.children, parent);
				continue;
			}

			const start = computed.start[node.entity.id()] ?? 0;
			const end = computed.end[node.entity.id()] ?? 0;

			// An expanded child is drawn within its parent's row, so the whole subtree can be skipped.
			if (end < minFrame || start > maxFrame) {
				row.top += getSubtreeHeight(node);
				continue;
			}

			// A sequence's children are drawn in its own row (see `renderRow`).
			if (parent === null || !parent.has(Sequential)) {
				renderRow(world, scene, surface, node, row);
			}

			row.top += getNodeHeight(node);
			walk(node.children, node.entity);
		}
	};

	walk(buildTimelineLayers(world, scene), null);

	ctx.restore();
}

// A sequence has no time of its own to show, so it is drawn as its children
// side by side along the row.
function renderRow(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	node: TimelineNode,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	const transform = getRowTransform(world, scene, row.top);
	if (!transform) return;

	ctx.setTransform(transform);

	row.height = getNodeHeight(node);
	ctx.globalAlpha = getClipAlpha(node.entity);

	if (node.entity.has(Hovering)) {
		const [left, right] = getViewport(world, scene, surface.layout.width);
		ctx.globalAlpha = 0.5;
		ctx.fillStyle = surface.colors.background.accent;
		ctx.fillRect(left, 0, right - left, row.height);
		ctx.globalAlpha = 1;
	}

	if (!node.entity.has(Sequential)) {
		renderClip(world, scene, surface, node.entity, row);
		renderEdgeMarkers(world, scene, surface, [node.entity], row);
		return;
	}

	// A dragged clip is drawn last so it stays on top while moving.
	const children = [...world.query(Or(Geometry, Group, AdjustmentLayer), ChildOf(node.entity))];

	for (const child of children) {
		if (!isDragging(child)) renderClip(world, scene, surface, child, row);
	}
	for (const child of children) {
		if (isDragging(child)) renderClip(world, scene, surface, child, row);
	}

	// Over the clips, so a marker on a seam is what the pointer finds there.
	renderEdgeMarkers(world, scene, surface, children, row);
	renderTransitionMarkers(world, scene, surface, node.entity, row);
}
