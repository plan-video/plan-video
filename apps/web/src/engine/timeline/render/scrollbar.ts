/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Computed, getTimelineView, store } from '@plan.video/runtime';

import { getDocumentEditor } from '../../editor';
import { SCROLLBAR_LANE, TIMELINE_PADDING_LEFT } from '../config';
import { getResolution, getScrollX, setScrollX, updateTimelineTransform } from '../view';

import type { Entity, World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

const BAR_HEIGHT = 6;
// Centred in its lane, and as far in from the sides.
const BAR_INSET = (SCROLLBAR_LANE - BAR_HEIGHT) / 2;
const MIN_THUMB_WIDTH = 32;
// Room past the scene's end, as a share of the view, so its last frame does
// not sit against the edge when scrolled all the way.
const END_ROOM = 0.15;

// The scroll and the span the bar stood for when the thumb was grabbed: a
// drag is measured from there, so the thumb stays under the pointer even as
// the span grows behind it.
let dragOrigin: [scrollX: number, span: number] = [0, 0];

/**
 * The sideways scrollbar, in its own lane along the bottom: the thumb is the
 * stretch on screen, the track the whole scene and a little past it. Drag
 * the thumb to scroll, click the track to jump there. Not drawn while the
 * whole scene fits, though its lane stays.
 */
export function renderScrollbar(world: World, scene: Entity, surface: TimelineSurfaceState): void {
	const { ctx, pointer, layout } = surface;
	if (!ctx || !pointer) return;

	const width = layout.width;
	const resolution = getResolution(world, scene);
	const scrollX = getScrollX(world, scene);
	const view = width / resolution;

	const min = -TIMELINE_PADDING_LEFT / resolution;
	const duration = store(world, Computed).duration[scene.id()] ?? 0;
	const max = Math.max(duration + view * END_ROOM, scrollX + view);
	const span = max - min;
	const shown = span > view + 1;

	const track = width - BAR_INSET * 2;
	const thumbWidth = Math.max(MIN_THUMB_WIDTH, (view / span) * track);
	const thumbX = BAR_INSET + ((scrollX - min) / (span - view)) * (track - thumbWidth);
	const y = layout.height - BAR_HEIGHT - BAR_INSET;
	const laneY = layout.height - SCROLLBAR_LANE;

	// Reported like a wheel scroll, so the file remembers where it was left.
	const scroll = (frames: number): void => {
		setScrollX(world, scene, frames);
		updateTimelineTransform(world, scene);
		const next = getTimelineView(world, scene);
		if (next) getDocumentEditor(world).reportEdit(scene, 'timeline', next);
	};

	ctx.save();
	ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

	// The lane is the bar's even when there is no bar, as the ruler is the
	// ruler's: the rows are cut off above it, so a click in it must not land
	// on the hidden part of one. With a bar, a click centres the thumb on it.
	{
		const { clicked } = pointer.scope('scrollbar').region(0, laneY, width, SCROLLBAR_LANE, 'lane');
		const position = pointer.position;
		if (shown && clicked && position) {
			const center = (position.currentX - BAR_INSET - thumbWidth / 2) / (track - thumbWidth);
			scroll(min + Math.max(0, Math.min(1, center)) * (span - view));
		}
	}

	if (!shown) {
		ctx.restore();
		return;
	}

	// The thumb takes the lane's whole height, so it is easy to grab.
	const { hovering, pressed, dragging } = pointer.region(thumbX, laneY, thumbWidth, SCROLLBAR_LANE, 'thumb');
	if (pressed) dragOrigin = [scrollX, span];

	const position = pointer.position;
	if (dragging && position && position.state !== 'idle') {
		const [originX, originSpan] = dragOrigin;
		scroll(originX + (position.deltaX / (track - thumbWidth)) * (originSpan - view));
	}

	if (hovering || dragging) surface.cursor = 'default';

	ctx.globalAlpha = hovering || dragging ? 1 : 0.6;
	ctx.fillStyle = surface.colors.ruler.text;
	ctx.beginPath();
	ctx.roundRect(thumbX, y, thumbWidth, BAR_HEIGHT, BAR_HEIGHT / 2);
	ctx.fill();

	ctx.restore();
}
