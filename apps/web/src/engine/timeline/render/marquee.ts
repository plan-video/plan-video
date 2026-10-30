/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Selected } from '@plan.video/runtime';

import { getDocumentEditor } from '../../editor';

import type { World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

/**
 * The empty space behind the rows, and what a gesture on it means: a click
 * clears the selection, a drag pulls a marquee out (Shift or Cmd held: one
 * that adds to the selection). The marquee itself is
 * only recorded here — which clips fall inside it is each clip's own
 * business, decided as it draws (see `renderClip`).
 *
 * Runs before the rows so its region sits beneath theirs: the pointer takes
 * the last region drawn over it, so a clip drawn afterwards wins.
 */
export function updateMarquee(world: World, surface: TimelineSurfaceState): void {
	const { canvas, pointer } = surface;
	if (!canvas || !pointer) return;

	const { clicked, dragging } = pointer
		.scope('canvas')
		.region(0, 0, canvas.width, canvas.height);

	// A click with Shift or Cmd held may have just missed a clip; it keeps
	// the selection rather than throwing it away.
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

	// Opening the marquee clears what was selected, so the drag starts from
	// nothing and each clip decides for itself from there — unless Shift or
	// Cmd is held, when it adds to what is already selected.
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

/** The marquee rectangle itself, over the rows it is selecting. */
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
