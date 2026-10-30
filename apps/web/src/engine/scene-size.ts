/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Constraint,
	KeepAspectRatio,
	Position,
	Size,
	Rotation,
	findGeometryAsset,
	getEntityChildren,
	getParentEntity,
	isCaption,
	isRect,
	isScene,
	isSequence,
	resizeEntity,
} from '@plan.video/runtime';

import { syncKeyframe } from './keyframes';
import { getDocumentEditor } from './editor';

import type { DocumentEditor } from './editor';
import type { Entity, World } from 'koota';

type Box = { x: number; y: number; width: number; height: number };
type Frame = { width: number; height: number };

/** A part of the scene as it sat before the resize. */
type Placed = { entity: Entity; box: Box; media: boolean; stretches: boolean };

/**
 * Sets a scene's size to `width`×`height`. The aspect lock is cleared first:
 * with it on, writing one side rewrites the other from the old ratio, so a
 * 16:9 scene never becomes 9:16. A keyframe track is updated too, or the
 * next frame puts the old size back. What the scene holds is reframed to the
 * new size (see `reframe`).
 */
export function resizeScene(world: World, scene: Entity, width: number, height: number): void {
	const editor = getDocumentEditor(world);
	const nextWidth = Math.round(width);
	const nextHeight = Math.round(height);
	const before = scene.get(Size);
	const frame = before ? { width: before.width, height: before.height } : null;
	const placed = frame ? placedIn(world, scene) : [];

	editor.editProperty(scene, 'keepAspectRatio', false);
	scene.remove(KeepAspectRatio);
	editor.editProperty(scene, 'width', nextWidth);
	editor.editProperty(scene, 'height', nextHeight);
	syncKeyframe(world, editor, scene, 'width', nextWidth);
	syncKeyframe(world, editor, scene, 'height', nextHeight);
	scene.remove(KeepAspectRatio);
	resizeEntity(world, scene, { width: nextWidth, height: nextHeight });

	if (!frame || frame.width <= 0 || frame.height <= 0) return;
	if (frame.width === nextWidth && frame.height === nextHeight) return;
	const next = { width: nextWidth, height: nextHeight };
	for (const item of placed) place(world, editor, item.entity, reframe(item, frame, next));
}

/** A scene and the size it would take to match a clip in it. */
export type SceneFit = { scene: Entity; width: number; height: number };

/**
 * The size `clip`'s scene would take to match the clip's footage, or null
 * when it already does or the clip is not footage laid out in a scene's own
 * frame (sequences looked through, as `placedIn` does). A turned clip is
 * left out: filling the frame with it would leave corners empty.
 */
export function sceneFitFor(world: World, clip: Entity): SceneFit | null {
	const asset = findGeometryAsset(world, clip);
	if (!asset || (asset.type !== 'VIDEO' && asset.type !== 'SEQUENCE')) return null;
	if (clip.has(Constraint) || (clip.get(Rotation)?.value ?? 0) % 360 !== 0) return null;

	let scene = getParentEntity(clip);
	while (scene && isSequence(scene)) scene = getParentEntity(scene);
	if (!scene || !isScene(scene)) return null;

	const width = Math.round(asset.width);
	const height = Math.round(asset.height);
	const size = scene.get(Size);
	if (width <= 0 || height <= 0 || (size?.width === width && size?.height === height)) return null;
	return { scene, width, height };
}

/**
 * Resizes `clip`'s scene to the clip's footage and has the clip fill it at
 * its own size. Everything else in the scene is reframed as for any resize.
 * The scene grows or shrinks about its centre, so it stays where it was being
 * looked at, and an undo puts it back where it was seen. Returns the scene's
 * new box on the stage, or null when there was nothing to do.
 */
export function fitSceneToClip(world: World, clip: Entity): (SceneFit & Box) | null {
	const fit = sceneFitFor(world, clip);
	if (!fit) return null;
	const editor = getDocumentEditor(world);
	const at = fit.scene.get(Position) ?? { x: 0, y: 0 };
	const before = fit.scene.get(Size) ?? { width: fit.width, height: fit.height };
	const x = Math.round(at.x + (before.width - fit.width) / 2);
	const y = Math.round(at.y + (before.height - fit.height) / 2);

	resizeScene(world, fit.scene, fit.width, fit.height);
	if (x !== at.x) editor.editProperty(fit.scene, 'x', x);
	if (y !== at.y) editor.editProperty(fit.scene, 'y', y);
	syncKeyframe(world, editor, fit.scene, 'x', x);
	syncKeyframe(world, editor, fit.scene, 'y', y);
	place(world, editor, clip, { x: 0, y: 0, width: fit.width, height: fit.height });
	return { ...fit, x, y };
}

/**
 * The scene's parts that sit in its frame, sequences looked through: a
 * sequence takes its scene's frame. Parts with constraints are left to them,
 * and captions place themselves.
 */
function placedIn(world: World, parent: Entity): Placed[] {
	const placed: Placed[] = [];
	for (const child of getEntityChildren(world, parent)) {
		if (isSequence(child)) {
			placed.push(...placedIn(world, child));
			continue;
		}
		if (child.has(Constraint) || isCaption(child)) continue;
		const position = child.get(Position);
		const size = child.get(Size);
		if (!position || !size || size.width <= 0 || size.height <= 0) continue;
		const type = findGeometryAsset(world, child)?.type;
		const media = type === 'VIDEO' || type === 'IMAGE' || type === 'SEQUENCE';
		placed.push({
			entity: child,
			box: { x: position.x, y: position.y, width: size.width, height: size.height },
			media,
			stretches: !media && isRect(child),
		});
	}
	return placed;
}

/**
 * Where a part goes when its scene goes from `from` to `to`. Footage that
 * filled the frame fills the new one, cropped at the centre. Other footage
 * keeps its size against the frame: one that fitted the frame fits the new
 * one, and a picture-in-picture at a third of it stays a third. A shape
 * across the frame stretches across the new one. Each keeps its place
 * relative to the frame, and stays inside it.
 */
export function reframe(item: Omit<Placed, 'entity'>, from: Frame, to: Frame): Box {
	const { box } = item;
	// A pixel of slack: sizes are rounded.
	const acrossX = box.x <= 1 && box.x + box.width >= from.width - 1;
	const acrossY = box.y <= 1 && box.y + box.height >= from.height - 1;

	if (item.media && acrossX && acrossY) {
		const scale = Math.max(to.width / box.width, to.height / box.height);
		return centred(box.width * scale, box.height * scale, to);
	}

	// How much bigger the footage is shown when fitted to each frame.
	const fit = (frame: Frame) => Math.min(frame.width / box.width, frame.height / box.height);
	const scale = item.media ? fit(to) / fit(from) : 1;
	const width = item.stretches && acrossX ? to.width : box.width * scale;
	const height = item.stretches && acrossY ? to.height : box.height * scale;
	const centreX = ((box.x + box.width / 2) / from.width) * to.width;
	const centreY = ((box.y + box.height / 2) / from.height) * to.height;
	return {
		x: Math.round(inside(centreX - width / 2, width, to.width)),
		y: Math.round(inside(centreY - height / 2, height, to.height)),
		width: Math.round(width),
		height: Math.round(height),
	};
}

function centred(width: number, height: number, frame: Frame): Box {
	return {
		x: Math.round((frame.width - width) / 2),
		y: Math.round((frame.height - height) / 2),
		width: Math.round(width),
		height: Math.round(height),
	};
}

/** `start` moved so `length` stays within `room`; centred when it can't fit. */
function inside(start: number, length: number, room: number): number {
	if (length >= room) return (room - length) / 2;
	return Math.min(Math.max(start, 0), room - length);
}

function place(world: World, editor: DocumentEditor, entity: Entity, box: Box): void {
	const position = entity.get(Position);
	const size = entity.get(Size);
	if (position?.x !== box.x) editor.editProperty(entity, 'x', box.x);
	if (position?.y !== box.y) editor.editProperty(entity, 'y', box.y);
	if (size?.width !== box.width) editor.editProperty(entity, 'width', box.width);
	if (size?.height !== box.height) editor.editProperty(entity, 'height', box.height);
	syncKeyframe(world, editor, entity, 'x', box.x);
	syncKeyframe(world, editor, entity, 'y', box.y);
	syncKeyframe(world, editor, entity, 'width', box.width);
	syncKeyframe(world, editor, entity, 'height', box.height);
}
