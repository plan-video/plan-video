/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Cache,
	Computed,
	Hovering,
	Keyframe,
	KeyframeDragOrigin,
	Selected,
	findClosestParentGeometry,
	framesToSeconds,
	readSpeedCurve,
	sourceFrameAtOffset,
	store,
	timelineFrameAtSource,
	timelineOffsetAtSource,
} from '@plan.video/runtime';

import { getDocumentEditor } from '../../editor';
import { KEYFRAME_TRACK_HEIGHT } from '../config';
import { getRowTransform } from '../layout';
import { framesToPixels, getFrameRate, getResolution, getViewport, pixelsToFrames } from '../view';

import type { Entity, World } from 'koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

const SIZE = 8;
const HALF = SIZE / 2;
// A diamond is a small target, so the grab area is larger than what is drawn.
const HITBOX = SIZE + 4;
const HITBOX_HALF = HITBOX / 2;

// Times are the clip's own, so keyframes travel with it and run at its speed;
// the clip's origin puts them on the scene's timeline.
export function renderKeyframeTrack(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	track: Entity,
	row: RowCursor,
): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const keyframes = track.get(Cache)?.keyframes ?? [];
	if (keyframes.length === 0) return;

	const clip = findClosestParentGeometry(track);
	const computed = clip?.get(Computed);
	if (!computed) return;

	const transform = getRowTransform(world, scene, row.top);
	if (!transform) return;

	const resolution = getResolution(world, scene);
	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const rate = computed.playbackRate || 1;
	const curve = clip ? readSpeedCurve(clip) : { base: rate, keys: [] };
	const centerY = KEYFRAME_TRACK_HEIGHT / 2;

	const times = store(world, Keyframe).time;
	const first = times[keyframes[0]!.id()] ?? 0;
	const last = times[keyframes[keyframes.length - 1]!.id()] ?? 0;

	ctx.save();
	ctx.setTransform(transform);
	ctx.lineWidth = 1;

	if (track.has(Hovering)) {
		ctx.fillStyle = surface.colors.background.muted;
		ctx.globalAlpha = 0.6;
		ctx.fillRect(viewportLeft, 0, viewportRight - viewportLeft, KEYFRAME_TRACK_HEIGHT);
		ctx.globalAlpha = 1;
	}

	pointer.scope(String(track.id()));

	for (const keyframe of keyframes) {
		const time = times[keyframe.id()] ?? 0;
		const x = framesToPixels(
			curve.keys.length > 0 ? timelineFrameAtSource(clip!, time) : computed.origin + time / rate,
			resolution,
		);

		if (x + HITBOX_HALF < viewportLeft || x - HITBOX_HALF > viewportRight) continue;

		handleKeyframe(world, surface, keyframe, time, x, centerY, rate, curve, resolution);

		const selected = keyframe.has(Selected);
		ctx.strokeStyle = selected ? surface.colors.border.ring : surface.colors.keyframe;
		ctx.fillStyle = selected ? surface.colors.border.ring : surface.colors.keyframe;

		diamond(ctx, x, centerY);
		ctx.stroke();

		const isFirst = time === first;
		const isLast = time === last;

		if (isFirst === isLast) {
			ctx.fill();
		} else {
			ctx.beginPath();
			ctx.moveTo(x, centerY - HALF);
			ctx.lineTo(x + (isFirst ? HALF : -HALF), centerY);
			ctx.lineTo(x, centerY + HALF);
			ctx.closePath();
			ctx.fill();
		}
	}

	ctx.restore();
}

function handleKeyframe(
	world: World,
	surface: TimelineSurfaceState,
	keyframe: Entity,
	time: number,
	x: number,
	centerY: number,
	rate: number,
	curve: ReturnType<typeof readSpeedCurve>,
	resolution: number,
): void {
	const pointer = surface.pointer!;
	const editor = getDocumentEditor(world);

	const { clicked, dragging, intersectsMarquee } = pointer.region(
		x - HITBOX_HALF,
		centerY - HITBOX_HALF,
		HITBOX,
		HITBOX,
		String(keyframe.id()),
	);

	const selected = keyframe.has(Selected);

	if (surface.marquee) {
		if (intersectsMarquee && !selected) editor.select(keyframe, { extend: true });
		if (!intersectsMarquee && selected) editor.deselect(keyframe);
	} else if (clicked) {
		editor.select(keyframe, { extend: pointer.shiftPressed });
	}

	if (dragging && !keyframe.has(KeyframeDragOrigin)) {
		keyframe.add(KeyframeDragOrigin);
		keyframe.set(KeyframeDragOrigin, { time });
	}

	const origin = keyframe.get(KeyframeDragOrigin);
	const position = pointer.position;
	if (!origin || !position || position.state === 'idle') return;

	// The pointer moves in scene frames; the keyframe lives in the clip's source
	// time, which runs `rate` times as fast (or along the speed curve).
	const moved = pixelsToFrames(position.deltaX, resolution);
	const next = curve.keys.length > 0
		? sourceFrameAtOffset(curve, timelineOffsetAtSource(curve, origin.time) + moved)
		: origin.time + moved * rate;
	editor.editProperty(keyframe, 'time', framesToSeconds(Math.max(0, next), getFrameRate(world)));
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number): void {
	ctx.beginPath();
	ctx.moveTo(x, y - HALF);
	ctx.lineTo(x + HALF, y);
	ctx.lineTo(x, y + HALF);
	ctx.lineTo(x - HALF, y);
	ctx.closePath();
}
