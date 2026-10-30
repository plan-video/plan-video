/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Immediate mode: render functions handle what the pointer did to a thing as they draw it
// (see `./surface`).

import { useCursor } from '@/hooks/use-cursor';
import { RULER_HEIGHT, SCROLLBAR_LANE } from './config';
import { renderLayers, renderMarquee, renderPlayhead, renderRuler, renderScrollbar, renderSnapLine, renderWorkarea, updateMarquee } from './render';
import { updateDragGestures } from './drag';
import { TimelineSurface } from './surface';
import { getTimelineScene, updateTimelineTransform } from './view';

import type { World } from 'koota';
import type { TimelinePointer } from './pointer';
import type { TimelineSurfaceState } from './surface';

const cursor = useCursor();

export function timelineSystem(world: World): void {
	const surface = world.get(TimelineSurface);
	const { canvas, ctx, pointer } = surface ?? {};
	if (!surface || !canvas || !ctx || !pointer) return;

	const scene = getTimelineScene(world);
	if (scene === null) {
		clearTimeline(surface, canvas, ctx, pointer);
		return;
	}

	// Every pass, not only on gestures: the view store can move under the draw loop, e.g. the
	// reconciler restoring `<scene timeline>`, or a resize while another scene was up.
	updateTimelineTransform(world, scene);

	try {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

		// Claimed during the pass by whatever the pointer is over.
		surface.cursor = 'default';
		surface.joins = [];
		surface.clips = [];

		// Before any drawing, rows or not: an ended gesture must close before its clips are laid
		// out again, and collapsing the timeline mid-drag must not strand one.
		updateDragGestures(world, surface);

		// Rows are clipped between the ruler, painted over them afterwards, and the scrollbar's lane.
		if (!surface.minimized) {
			updateMarquee(world, surface);

			ctx.save();
			ctx.beginPath();
			ctx.rect(0, RULER_HEIGHT, canvas.width, surface.layout.height - RULER_HEIGHT - SCROLLBAR_LANE);
			ctx.clip();
			renderLayers(world, scene, surface);
			renderMarquee(surface);
			ctx.restore();
		}

		renderRuler(world, scene, surface);
		renderWorkarea(world, scene, surface);
		renderPlayhead(world, scene, surface);

		if (!surface.minimized) {
			renderSnapLine(world, scene, surface);
			renderScrollbar(world, scene, surface);
		}

		cursor.set(canvas, surface.cursor);
	} catch (error) {
		console.error(error);
	} finally {
		// The regions drawn this frame are what the next frame tests against.
		pointer.reset();
	}
}

/**
 * A canvas keeps what was painted last, so wipe it when no scene is left, and drop the hit
 * regions so the next scene's first frame is not tested against rows that are gone.
 */
function clearTimeline(
	surface: TimelineSurfaceState,
	canvas: HTMLCanvasElement,
	ctx: CanvasRenderingContext2D,
	pointer: TimelinePointer,
): void {
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	surface.marquee = null;
	surface.snapX = null;
	surface.cursor = 'default';
	cursor.set(canvas, surface.cursor);

	pointer.reset();
}
