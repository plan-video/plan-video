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
const BAR_INSET = (SCROLLBAR_LANE - BAR_HEIGHT) / 2;
const MIN_THUMB_WIDTH = 32;
const END_ROOM = 0.15;

// A drag is measured from the grab, so the thumb stays under the pointer as the span grows.
let dragOrigin: [scrollX: number, span: number] = [0, 0];

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

	// The lane is hit even without a bar: rows are cut off above it, so a click must not reach a hidden row.
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
