/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Every write goes through entity.set(Camera, …) so koota fires a change event: never mutate the
// record getCamera returns. Input bindings live with the editor's DOM layer.

import { Camera, Root } from '../traits';
import { MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from '../constants';
import { clamp, transformPoint } from '../math';
import { getCamera, getCameraInverse, getCameraScale, getContentBounds, getEntityBounds, getViewport } from '../queries/camera';

import type { Entity, World } from 'koota';
import type { Camera2D } from '../traits';
import type { CameraMatrix } from '../queries/camera';
import type { Rect } from '../math';

/** Default breathing room, in CSS pixels, left around a focused rect. */
const FOCUS_PADDING = 80;

/** Prefer the operations below. */
export function setCamera(world: World, camera: Partial<Camera2D>): void {
	world.get(Root)!.set(Camera, camera);
}

/** The capture pipeline renders here. */
export function resetCamera(world: World): void {
	setCamera(world, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
}

/** Unclamped, unlike the zoom operations: the gestures that produce a matrix were already held to the limits. */
export function setCameraMatrix(world: World, [a, b, c, d, e, f]: CameraMatrix): void {
	setCamera(world, { a, b, c, d, e, f });
}

/** In canvas CSS pixels; independent of zoom, as the camera's offset is already in screen pixels. */
export function panCamera(world: World, screenDx: number, screenDy: number): void {
	const { e, f } = getCamera(world);
	setCamera(world, { e: e - screenDx, f: f - screenDy });
}

/** Keeps the document point under (screenX, screenY) pinned; clamped to [MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM]. */
export function zoomCameraAt(world: World, screenX: number, screenY: number, factor: number): void {
	const inverse = getCameraInverse(world);
	if (inverse === null) return;

	const { a, b, c, d } = getCamera(world);
	const anchor = transformPoint(inverse, screenX, screenY);

	// Resolve the requested factor against the clamped scale, so zooming past
	// a limit stops instead of drifting the pinned point.
	const scale = Math.hypot(a, b);
	if (scale <= 0) return;
	const s = clamp(scale * factor, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM) / scale;
	if (s === 1) return;

	// M' = T(anchor) · S(s) · T(-anchor) · M
	setCamera(world, {
		a: a * s,
		b: b * s,
		c: c * s,
		d: d * s,
		e: screenX - (a * s * anchor.x + c * s * anchor.y),
		f: screenY - (b * s * anchor.x + d * s * anchor.y),
	});
}

export function zoomCameraBy(world: World, factor: number): void {
	const viewport = getViewport(world);
	if (!viewport) return;
	zoomCameraAt(world, viewport.width / 2, viewport.height / 2, factor);
}

/** 1 = 100%. */
export function setCameraZoom(world: World, scale: number): void {
	const current = getCameraScale(world);
	if (current <= 0) return;
	zoomCameraBy(world, scale / current);
}

export function resetCameraZoom(world: World): void {
	setCameraZoom(world, 1);
}

/** Never zooms past 100%: framing a small rect should bring it into view, not magnify it. */
export function focusRect(world: World, rect: Rect, padding = FOCUS_PADDING): void {
	const viewport = getViewport(world);
	if (!viewport || rect.width <= 0 || rect.height <= 0) return;

	const width = viewport.width - padding * 2;
	const height = viewport.height - padding * 2;
	if (width <= 0 || height <= 0) return;

	const scale = clamp(Math.min(width / rect.width, height / rect.height), MIN_CAMERA_ZOOM, 1);

	setCamera(world, {
		a: scale,
		b: 0,
		c: 0,
		d: scale,
		e: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
		f: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
	});
}

/** No-op if none of them has bounds yet. */
export function focusEntities(world: World, entities: Iterable<Entity>, padding = FOCUS_PADDING): void {
	const bounds = getEntityBounds(world, entities);
	if (bounds) focusRect(world, bounds, padding);
}

export function focusContent(world: World, padding = FOCUS_PADDING): void {
	const bounds = getContentBounds(world);
	if (bounds) focusRect(world, bounds, padding);
}
