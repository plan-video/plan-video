/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Selected } from '@plan.video/runtime';

import { getDocumentEditor } from '../../editor';

import type { World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

/**
 * Runs before the rows so its region sits beneath theirs: the pointer takes the last region
 * drawn over it. Each clip decides whether it is inside the marquee as it draws (see `renderClip`).
 */
export function updateMarquee(world: World, surface: TimelineSurfaceState): void {
	const { canvas, pointer } = surface;
	if (!canvas || !pointer) return;

	const { clicked, dragging } = pointer
		.scope('canvas')
		.region(0, 0, canvas.width, canvas.height);

	// A Shift/Cmd click may have just missed a clip, so it keeps the selection.
	if (clicked && !pointer.extending) {
		getDocumentEditor(world).clearSelection();
	}

	if (!dragging) {
		surface.marquee = null;
		surface.marqueeBase = null;
		return;
	}

	const position = pointer.position;
	if (!position || position.state === 'idle') return;

	if (!surface.marquee) {
		if (pointer.extending) {
			surface.marqueeBase = new Set(world.query(Selected));
		} else {
			surface.marqueeBase = null;
			getDocumentEditor(world).clearSelection();
		}
	}

	surface.marquee = {
		x: Math.min(position.currentX, position.initialX),
		y: Math.min(position.currentY, position.initialY),
		width: Math.abs(position.currentX - position.initialX),
		height: Math.abs(position.currentY - position.initialY),
	};
}

export function renderMarquee(surface: TimelineSurfaceState): void {
	const { ctx, marquee } = surface;
	if (!ctx || !marquee) return;

	ctx.save();

	ctx.fillStyle = surface.colors.border.ring;
	ctx.strokeStyle = surface.colors.border.ring;
	ctx.lineWidth = 1;

	ctx.globalAlpha = 0.2;
	ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height);

	ctx.globalAlpha = 1;
	ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height);

	ctx.restore();
}
