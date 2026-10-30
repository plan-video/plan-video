/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	aabbsIntersect, getEntityBounds, getEntityChildren, getViewport, Hidden, Root, screenToWorld,
} from '@plan.video/runtime';

import type { AABB, Point } from '@plan.video/runtime';
import type { World } from 'koota';

/** In document space; null before a surface is mounted. */
function viewportBounds(world: World): AABB | null {
	const viewport = getViewport(world);
	if (!viewport) return null;

	// All four corners, so the box still holds if the camera is ever rotated.
	const corners = [
		screenToWorld(world, 0, 0),
		screenToWorld(world, viewport.width, 0),
		screenToWorld(world, viewport.width, viewport.height),
		screenToWorld(world, 0, viewport.height),
	];

	return {
		minX: Math.min(...corners.map((corner) => corner.x)),
		minY: Math.min(...corners.map((corner) => corner.y)),
		maxX: Math.max(...corners.map((corner) => corner.x)),
		maxY: Math.max(...corners.map((corner) => corner.y)),
	};
}

/** A node the transform system has not measured yet is left out. */
function occupied(world: World): AABB[] {
	const boxes: AABB[] = [];

	for (const entity of getEntityChildren(world, world.get(Root)!)) {
		if (entity.has(Hidden)) continue;
		const rect = getEntityBounds(world, [entity]);
		if (!rect) continue;
		boxes.push({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height });
	}

	return boxes;
}

const centerOf = (box: AABB): Point => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Beside something already there, level with it (right, else left), nearest the view's middle
 * first. The view's middle when nothing has a free side; the origin before a surface mounts.
 */
export function findEmptyPlacement(world: World, width: number, height: number, gap: number): Point {
	const viewport = viewportBounds(world);
	const center = viewport ? centerOf(viewport) : { x: 0, y: 0 };

	const boxes = occupied(world);
	if (boxes.length === 0) return center;

	const inView = viewport ? boxes.filter((box) => aabbsIntersect(box, viewport)) : [];
	const ordered = (inView.length > 0 ? inView : boxes)
		.slice()
		.sort((a, b) => distance(centerOf(a), center) - distance(centerOf(b), center));

	const free = (rect: AABB): boolean => !boxes.some((box) => aabbsIntersect(rect, box));

	for (const box of ordered) {
		const y = (box.minY + box.maxY) / 2;
		const minY = y - height / 2;
		const maxY = y + height / 2;

		const right = box.maxX + gap;
		if (free({ minX: right, minY, maxX: right + width, maxY })) {
			return { x: right + width / 2, y };
		}

		const left = box.minX - gap;
		if (free({ minX: left - width, minY, maxX: left, maxY })) {
			return { x: left - width / 2, y };
		}
	}

	return center;
}
