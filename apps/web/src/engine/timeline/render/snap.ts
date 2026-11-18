/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { RULER_HEIGHT } from '../config';
import { framesToPixels, getResolution, getScrollX, pixelsToFrames } from '../view';

import type { Entity, World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

// Cleared as it is drawn: whatever is dragging says again next frame.
export function renderSnapLine(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, canvas, snapX } = surface;
	if (!ctx || !canvas || snapX === null) return;

	ctx.save();
	ctx.translate(-(getScrollX(world, scene) * getResolution(world, scene)), 0);

	ctx.beginPath();
	ctx.moveTo(snapX, RULER_HEIGHT);
	ctx.lineTo(snapX, canvas.height / window.devicePixelRatio);

	ctx.strokeStyle = surface.colors.border.scrubber;
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.restore();

	surface.snapX = null;
}

/** A drag that ends anywhere else never says so here, so an aim nobody has renewed stops being drawn. */
const DROP_AIM_LIFETIME = 700;

/** On the frame a drop would land on, not under the pointer, so what is shown is what is dropped. */
export function renderDropAim(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, canvas, dropAim } = surface;
	if (!ctx || !canvas || !dropAim) return;

	if (performance.now() - dropAim.at > DROP_AIM_LIFETIME) {
		surface.dropAim = null;
		return;
	}

	const resolution = getResolution(world, scene);
	const scroll = getScrollX(world, scene) * resolution;
	const x = framesToPixels(Math.max(0, pixelsToFrames(dropAim.x + scroll, resolution)), resolution) - scroll;

	ctx.save();
	ctx.fillStyle = surface.colors.border.ring;
	ctx.fillRect(x - 1, RULER_HEIGHT, 2, canvas.height / window.devicePixelRatio - RULER_HEIGHT);
	ctx.beginPath();
	ctx.arc(x, RULER_HEIGHT, 4, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}
