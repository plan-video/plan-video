/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// View state lives on the shown scene's `Timeline` trait and is written through the store,
// not `entity.set`: a scroll is not a project edit, so nothing should observe it. It reaches
// the file as `<scene timeline>`, reported by the controller (see `./controller`).

import { Computed, FrameRate, Timeline, getActiveEntity, store } from '@plan.video/runtime';

import { DEFAULT_TIMELINE_RESOLUTION, RULER_HEIGHT, TIMELINE_PADDING_LEFT } from './config';

import type { Entity, World } from 'koota';

export function getTimelineScene(world: World): Entity | null {
	return getActiveEntity(world);
}

/** The scroll starts slightly negative so frame 0 sits a padding's width in from the left edge. */
export function ensureTimelineView(world: World, scene: Entity): void {
	if (scene.has(Timeline)) return;

	scene.add(Timeline);

	const view = store(world, Timeline);
	const eid = scene.id();
	view.resolution[eid] = DEFAULT_TIMELINE_RESOLUTION;
	view.scrollX[eid] = -TIMELINE_PADDING_LEFT / DEFAULT_TIMELINE_RESOLUTION;
	view.scrollY[eid] = 0;

	updateTimelineTransform(world, scene);
}

/** Pixels per frame; never 0, which would collapse the timeline onto one column. */
export function getResolution(world: World, scene: Entity): number {
	return store(world, Timeline).resolution[scene.id()] || DEFAULT_TIMELINE_RESOLUTION;
}

/** In frames, not pixels, so zoom does not move it. */
export function getScrollX(world: World, scene: Entity): number {
	return store(world, Timeline).scrollX[scene.id()] ?? 0;
}

/** In pixels. */
export function getScrollY(world: World, scene: Entity): number {
	return store(world, Timeline).scrollY[scene.id()] ?? 0;
}

/** Kept at or past the padding, so the timeline cannot be pushed away from its own beginning. */
export function setScrollX(world: World, scene: Entity, frames: number): void {
	const resolution = getResolution(world, scene);
	store(world, Timeline).scrollX[scene.id()] = Math.max(-TIMELINE_PADDING_LEFT / resolution, frames);
}

export function setScrollY(world: World, scene: Entity, pixels: number): void {
	store(world, Timeline).scrollY[scene.id()] = pixels;
}

export function setResolution(world: World, scene: Entity, resolution: number): void {
	store(world, Timeline).resolution[scene.id()] = resolution;
}

export function framesToPixels(frames: number, resolution: number): number {
	return Math.floor(frames * resolution);
}

export function pixelsToFrames(pixels: number, resolution: number): number {
	return Math.round(pixels / resolution);
}

export function getCurrentFrame(world: World, scene: Entity): number {
	return store(world, Computed).localTime[scene.id()] ?? 0;
}

export function getFrameRate(world: World): number {
	return world.get(FrameRate)?.value ?? 30;
}

/** In the timeline's own pixels; render loops clip to it so a long project draws as cheaply as a short one. */
export function getViewport(world: World, scene: Entity, width: number): [left: number, right: number] {
	const left = getScrollX(world, scene) * getResolution(world, scene);
	return [left, left + width];
}

/** Called by every draw pass and by the gestures that move the view, so whatever wrote the store last is drawn. */
export function updateTimelineTransform(world: World, scene: Entity): void {
	ensureTimelineView(world, scene);

	const view = store(world, Timeline);
	const eid = scene.id();
	const dpr = window.devicePixelRatio;

	const transform = new DOMMatrix();
	transform.scaleSelf(dpr, dpr);
	transform.translateSelf(-(view.scrollX[eid]! * view.resolution[eid]!), -view.scrollY[eid]!);
	transform.translateSelf(0, RULER_HEIGHT);

	view.transform[eid] = transform;
}
