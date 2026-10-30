/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Camera trait maps document space to canvas CSS pixels; render and transform scale it by
// RenderSurface.resolution to reach device pixels (getViewMatrix). Writes live in actions/camera.ts.

import { Or } from 'koota';

import { Camera, Root, RenderSurface, WorldBounds, Geometry, Group, Hidden, ChildOf, Mode, PreviewQuality } from '../traits';
import { store } from '../world/store';
import { invert2D, transformPoint } from '../math';

import type { Entity, World } from 'koota';
import type { Camera2D } from '../traits';
import type { Mat2D, Point, Rect } from '../math';

/** Below this the camera is singular and screen↔document mapping is undefined. */
const MIN_DETERMINANT = 1e-12;

export type Viewport = { width: number; height: number };

/** Read-only: write it through actions/camera.ts. */
export function getCamera(world: World): Camera2D {
	return world.get(Root)!.get(Camera)!;
}

/** Uniform zoom factor of the camera (1 = 100%). */
export function getCameraScale(world: World): number {
	const { a, b } = getCamera(world);
	return Math.hypot(a, b);
}

/** In CSS `matrix()` / canvas `setTransform` order: the whole transform, so a view survives the trip to the file and back. */
export type CameraMatrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export function getCameraMatrix(world: World): CameraMatrix {
	const { a, b, c, d, e, f } = getCamera(world);
	return [a, b, c, d, e, f];
}

/** Null when the camera has been scaled to nothing. */
export function getCameraInverse(world: World): Mat2D | null {
	const camera = getCamera(world);
	if (Math.abs(camera.a * camera.d - camera.b * camera.c) < MIN_DETERMINANT) return null;
	return invert2D(camera);
}

/**
 * Camera × resolution: the document→device-pixel matrix the renderer puts on
 * the context and the transform system feeds top-level nodes.
 */
export function getViewMatrix(world: World): Mat2D {
	const { a, b, c, d, e, f } = getCamera(world);
	const resolution = world.get(RenderSurface)?.resolution ?? 1;

	return {
		a: a * resolution, b: b * resolution,
		c: c * resolution, d: d * resolution,
		e: e * resolution, f: f * resolution,
	};
}

/** Smallest share of the surface a reduced preview draws with. */
const MIN_PREVIEW_SCALE = 0.1;

/**
 * How much of the surface's resolution the scene is drawn at: the world's
 * PreviewQuality in a live preview, 1 in any offline render. Device-pixel
 * values the context does not scale on its own (shadow offsets, blur radii)
 * multiply by it.
 */
export function getPreviewScale(world: World): number {
	if (world.get(Mode)?.value !== 'realtime') return 1;
	const value = world.get(PreviewQuality)?.value ?? 1;
	return Number.isFinite(value) ? Math.min(1, Math.max(MIN_PREVIEW_SCALE, value)) : 1;
}

/**
 * Visible stage size in CSS pixels, or null before a surface is mounted. Taken
 * from the render surface rather than the DOM so it matches what was drawn.
 */
export function getViewport(world: World): Viewport | null {
	const surface = world.get(RenderSurface);
	const canvas = surface?.canvas;
	if (!canvas) return null;

	const resolution = surface.resolution || 1;
	return { width: canvas.width / resolution, height: canvas.height / resolution };
}

export function screenToWorld(world: World, screenX: number, screenY: number): Point {
	const inverse = getCameraInverse(world);
	return inverse === null ? { x: 0, y: 0 } : transformPoint(inverse, screenX, screenY);
}

export function worldToScreen(world: World, worldX: number, worldY: number): Point {
	return transformPoint(getCamera(world), worldX, worldY);
}

/** Null until one has been through the transform system. WorldBounds live only in the SoA store, post-camera and post-DPR, so they are read by id and the view matrix undone here. */
export function getEntityBounds(world: World, entities: Iterable<Entity>): Rect | null {
	const view = getViewMatrix(world);
	if (Math.abs(view.a * view.d - view.b * view.c) < MIN_DETERMINANT) return null;
	const inverse = invert2D(view);

	const bounds = store(world, WorldBounds);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

	for (const entity of entities) {
		const eid = entity.id();
		if (bounds.minX[eid] === undefined) continue;

		// All four corners, so the result stays an AABB even if the camera is
		// ever given a rotation.
		for (const [x, y] of [
			[bounds.minX[eid], bounds.minY[eid]], [bounds.maxX[eid], bounds.minY[eid]],
			[bounds.maxX[eid], bounds.maxY[eid]], [bounds.minX[eid], bounds.maxY[eid]],
		] as const) {
			const point = transformPoint(inverse, x, y);
			minX = Math.min(minX, point.x);
			maxX = Math.max(maxX, point.x);
			minY = Math.min(minY, point.y);
			maxY = Math.max(maxY, point.y);
		}
	}

	const width = maxX - minX;
	const height = maxY - minY;
	if (!(width > 0) || !(height > 0)) return null;

	return { x: minX, y: minY, width, height };
}

export function getContentBounds(world: World): Rect | null {
	const content = world.query(Or(Geometry, Group), ChildOf(world.get(Root)!))
		.filter((entity) => !entity.has(Hidden));

	return getEntityBounds(world, content);
}
