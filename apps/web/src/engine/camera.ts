/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What a menu item, a key or the zoom control does to the view. The camera is
 * the project's — the file says where it stands — so every move of it is
 * reported to the document, the same way a pan is (see `CameraController`).
 */

import {
	Position,
	Root,
	Size,
	focusContent,
	focusEntities,
	focusRect,
	getActiveEntity,
	getCamera,
	getCameraMatrix,
	getEntityChildren,
	getSelection,
	getViewport,
	setCameraZoom,
	zoomCameraBy,
} from '@plan.video/runtime';

import { getDocumentEditor } from './editor';

import type { Rect } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

/**
 * The rect the empty-canvas placeholder stands in for. Zoom to fit frames it
 * until a scene exists; the placeholder clears it when it goes away.
 */
let emptyFrame: Rect | null = null;

export function setEmptyFrame(rect: Rect | null): void {
	emptyFrame = rect;
}

function reportCamera(world: World): void {
	getDocumentEditor(world).reportEdit(world.get(Root)!, 'camera', getCameraMatrix(world));
}

/** Zooms around the center of the viewport: above 1 in, below 1 out. */
export function zoomBy(world: World, factor: number): void {
	zoomCameraBy(world, factor);
	reportCamera(world);
}

/** Zooms to an absolute scale, 1 being 100%. */
export function zoomTo(world: World, scale: number): void {
	setCameraZoom(world, scale);
	reportCamera(world);
}

/** Frames everything on the stage, or the empty-canvas placeholder when the stage has nothing on it. */
export function zoomToFit(world: World): void {
	if (emptyFrame) focusRect(world, emptyFrame);
	else focusContent(world);
	reportCamera(world);
}

/** Frames that the canvas has to hold its size for before it counts as settled. */
const SETTLED_FRAMES = 6;
const SETTLE_TIMEOUT_MS = 1000;

/**
 * Zoom to fit now, and again each time the canvas changes size until it
 * holds still: a panel opening or closing next to it animates its width.
 */
export function zoomToFitWhenSettled(world: World): void {
	zoomToFit(world);
	let last = getViewport(world);
	let still = 0;
	const started = performance.now();
	const tick = () => {
		const viewport = getViewport(world);
		if (viewport && (viewport.width !== last?.width || viewport.height !== last?.height)) {
			last = viewport;
			still = 0;
			zoomToFit(world);
		} else {
			still++;
		}
		if (still < SETTLED_FRAMES && performance.now() - started < SETTLE_TIMEOUT_MS) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

/**
 * Frames `rect`, in stage space, when any of it is off screen; a box already
 * in view is left where it is. The box may not be laid out yet.
 */
export function bringRectIntoView(world: World, rect: Rect): void {
	const viewport = getViewport(world);
	const { a, d, e, f } = getCamera(world);
	const left = a * rect.x + e;
	const top = d * rect.y + f;
	const inView = viewport
		&& left >= 0 && top >= 0
		&& left + a * rect.width <= viewport.width
		&& top + d * rect.height <= viewport.height;
	if (inView) return;
	focusRect(world, rect);
	reportCamera(world);
}

/** Frames the selection, wherever on the stage it sits. */
export function zoomToSelection(world: World): void {
	const selected = getSelection(world);
	if (!selected.length) return;

	focusEntities(world, selected);
	reportCamera(world);
}

function entityRect(entity: Entity): Rect | null {
	const position = entity.get(Position);
	const size = entity.get(Size);
	if (!position || !size || size.width <= 0 || size.height <= 0) return null;
	return { x: position.x, y: position.y, width: size.width, height: size.height };
}

/** The box every scene on the stage occupies, from where each one was placed. */
export function stageContentRect(world: World): Rect | null {
	const root = world.get(Root);
	if (!root) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const child of getEntityChildren(world, root)) {
		const rect = entityRect(child);
		if (!rect) continue;
		minX = Math.min(minX, rect.x);
		minY = Math.min(minY, rect.y);
		maxX = Math.max(maxX, rect.x + rect.width);
		maxY = Math.max(maxY, rect.y + rect.height);
	}
	if (!(maxX > minX) || !(maxY > minY)) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The picture a project card should show: the scene the timeline is on, or
 * the whole stage when none is.
 */
export function coverRect(world: World): Rect | null {
	const active = getActiveEntity(world);
	if (active) {
		const rect = entityRect(active);
		if (rect) return rect;
	}
	return stageContentRect(world);
}

let openingRun = 0;

/**
 * Frames every scene on the stage, as zoom to fit does, and again each time
 * the canvas changes size until it holds still. Not just the scene the
 * timeline is on: with many scenes that zoomed into one of them, which read
 * as a random pick. A saved camera is an offset for the window it
 * was taken in, and the camera a world is born with frames a scene whose
 * corner is the origin — a scene made here is centered on the origin, so
 * that view leaves it up and to the left. Neither is reused.
 *
 * The move is not reported. Opening a project should not rewrite its file,
 * and the next open frames the stage for whatever size the window is then.
 */
export function settleOpeningView(world: World, alive: () => boolean = () => true): void {
	const run = ++openingRun;
	let last = getViewport(world);
	let still = 0;
	const started = performance.now();
	const step = () => {
		if (run !== openingRun || !alive()) return;

		const viewport = getViewport(world);
		if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
			if (performance.now() - started < SETTLE_TIMEOUT_MS) requestAnimationFrame(step);
			return;
		}
		const rect = stageContentRect(world);
		if (!rect) {
			// A scene can land a frame after the mount. An empty project never
			// does: its placeholder frames itself.
			const root = world.get(Root);
			const hasScene = !!root && getEntityChildren(world, root).length > 0;
			if (hasScene && performance.now() - started < SETTLE_TIMEOUT_MS) requestAnimationFrame(step);
			return;
		}

		focusRect(world, rect);
		if (!last || viewport.width !== last.width || viewport.height !== last.height) {
			last = viewport;
			still = 0;
		} else {
			still++;
		}
		if (still < SETTLED_FRAMES && performance.now() - started < SETTLE_TIMEOUT_MS) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}
