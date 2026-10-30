/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Workarea } from '@plan.video/runtime';

import { assert } from '@/utils';
import { editWorkarea } from '../../timing';
import { IN_POINT_PATH, OUT_POINT_PATH } from '../paths';
import { RULER_HEIGHT } from '../config';
import { framesToPixels, getResolution, getScrollX, pixelsToFrames } from '../view';

import type { Entity, World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

const HANDLE_WIDTH = 5;
const BAR_HEIGHT = 10;

// Every frame of the drag is measured from here, so slow and fast drags land in the same place.
let dragOrigin: [start: number, end: number] = [0, 0];

export function renderWorkarea(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;
	if (!scene.has(Workarea)) return;

	const workarea = scene.get(Workarea)!;
	const scrollX = getScrollX(world, scene);
	const resolution = getResolution(world, scene);

	const inPx = framesToPixels(workarea.start, resolution);
	const outPx = framesToPixels(workarea.end, resolution);
	const y = RULER_HEIGHT - BAR_HEIGHT;

	const draggedFrames = (): number => {
		assert(pointer.position, 'Pointer position must be set');
		assert(pointer.position.state !== 'idle', 'Pointer must be pressing');
		return pixelsToFrames(pointer.position.deltaX, resolution);
	};

	ctx.save();
	ctx.translate(-(scrollX * resolution), 0);

	{
		const { dragging, pressed, doubleClicked } = pointer
			.scope('workarea')
			.region(inPx, y, outPx - inPx, BAR_HEIGHT);

		if (pressed) dragOrigin = [workarea.start, workarea.end];

		if (dragging) {
			const delta = draggedFrames();
			editWorkarea(world, scene, [dragOrigin[0] + delta, dragOrigin[1] + delta]);
		}

		if (doubleClicked) {
			editWorkarea(world, scene, null);
			ctx.restore();
			return;
		}

		// Difference rather than a fill, so the bar reads over the ticks and the playhead alike.
		ctx.globalCompositeOperation = 'difference';
		ctx.fillStyle = 'rgba(100, 100, 100, 1)';
		ctx.fillRect(inPx, y, outPx - inPx, BAR_HEIGHT);
		ctx.globalCompositeOperation = 'source-over';
	}

	ctx.lineWidth = 1;
	ctx.fillStyle = surface.colors.border.ring;
	ctx.strokeStyle = surface.colors.border.darker;

	// Drawn from its own origin so the path needs no offset.
	{
		ctx.translate(inPx - HANDLE_WIDTH, y);
		ctx.stroke(IN_POINT_PATH);
		ctx.fill(IN_POINT_PATH);

		const { dragging, pressed } = pointer.region(0, 0, HANDLE_WIDTH, BAR_HEIGHT);

		if (pressed) dragOrigin = [workarea.start, workarea.end];
		if (dragging) editWorkarea(world, scene, [dragOrigin[0] + draggedFrames(), dragOrigin[1]]);
	}

	// Relative to the in handle the context is now at.
	{
		ctx.translate(outPx - inPx + HANDLE_WIDTH, 0);
		ctx.stroke(OUT_POINT_PATH);
		ctx.fill(OUT_POINT_PATH);

		const { dragging, pressed } = pointer.region(0, 0, HANDLE_WIDTH, BAR_HEIGHT);

		if (pressed) dragOrigin = [workarea.start, workarea.end];
		if (dragging) editWorkarea(world, scene, [dragOrigin[0], dragOrigin[1] + draggedFrames()]);
	}

	ctx.restore();
}
