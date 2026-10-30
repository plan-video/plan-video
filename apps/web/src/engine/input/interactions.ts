/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Every change goes through `DocumentEditor`: the document is the source, so a
// gesture writes back to the element it came from, as an inspector edit would.

import {
	ChildOf, Computed, Culled, Geometry, Group, Hidden, Hovering,
	Interactive, IsMask, KeepAspectRatio, RenderSurface, Root, Scene,
	Selected, Skew, Time,
	computeGroupBounds, computeLocalMatrix, decompose2D, entityAnchor,
	entityOffset, entityQuad, entityWorldMat, enterEntity, selectionSubject,
	findKeyframeTrackEntity, getParentEntity, getParentNode, getSceneAncestor,
	getSelection, getSelectionMask, identity2D, invert2D, isPointerInEntity,
	multiply2D, pointInQuad, quadCenter, rectToQuad,
	rotate2D, scale2D,
	sortByItemIndex, store, syncInteractiveState, togglePlayback, transformPoint, translate2D,
} from '@plan.video/runtime';
import { Not, Or } from 'koota';

import { getDocumentEditor } from '../editor';
import { syncKeyframe } from '../keyframes';
import { beginCaptionWordMove, dragCaptionWords, endCaptionWordMove, isCaptionWordMove } from '@/lib/caption-word-move';
import { Hud, Keys, Pointer, SnapLines } from '../traits';
import { getToolCursor, updateCursor, type CursorType } from './cursor';
import { mountNameInput } from '../hud/name-input';
import { isEditableText, mountTextInput } from '../hud/text-input';
import { quadsOverlap } from '../quads';
import {
	buildSnapCandidatesFromCorners, buildSnapCandidatesFromQuad, findSnapTarget,
	getMarqueeQuad, getSelectionMaskSnapshot, getSnapCandidatesSnapshot,
	getTransformSnapshot, snapshotSelectionMask, snapshotSelectionTransforms,
	snapshotSnapCandidates,
} from './snapping';

import type { DocumentEditor } from '../editor';
import type { Entity, World } from 'koota';
import type { DispatchedPointerEvent, Mat2D, Point, Quad } from '@plan.video/runtime';

/** In CSS pixels. */
const SNAP_DISTANCE = 6;

const CLICK_DISTANCE = 4;

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'r' | 'b' | 'l';

/** Per handle: -1 pulls the near edge, 1 pushes the far one, 0 leaves the axis alone. */
const HANDLE_FACTOR: Record<Handle, Point> = {
	tl: { x: -1, y: -1 }, tr: { x: 1, y: -1 },
	bl: { x: -1, y: 1 }, br: { x: 1, y: 1 },
	t: { x: 0, y: -1 }, r: { x: 1, y: 0 },
	b: { x: 0, y: 1 }, l: { x: -1, y: 0 },
};

const HANDLE_CURSOR: Record<Handle, CursorType> = {
	tl: 'nwse-resize', tr: 'nesw-resize',
	bl: 'nesw-resize', br: 'nwse-resize',
	t: 'ns-resize', b: 'ns-resize',
	l: 'ew-resize', r: 'ew-resize',
};

const isHandle = (id: string): id is Handle => id in HANDLE_FACTOR;

type TransformProp = 'x' | 'y' | 'rotation' | 'width' | 'height';

/** The animated value when keyframed, the authored one otherwise, rounded as a gesture writes it. */
function shownTransform(world: World, entity: Entity, name: TransformProp): number {
	const computed = store(world, Computed);
	const eid = entity.id();

	switch (name) {
		case 'x': return Math.round(computed.positionX[eid] ?? 0);
		case 'y': return Math.round(computed.positionY[eid] ?? 0);
		case 'rotation': return Math.round((computed.rotation[eid] ?? 0) * 100) / 100;
		case 'width': return Math.round(computed.width[eid] ?? 0);
		case 'height': return Math.round(computed.height[eid] ?? 0);
	}
}

export type TransformWrite = [name: TransformProp, value: number];

/**
 * Keyframed props also get their keyframe at the playhead, or the motion system
 * overwrites them next tick; only props that changed reach a track. Read what is shown
 * before writing (writing `x` mirrors the authored `y`), and write keyframes before
 * props, or `resizeEntity` mints a keyframe the document never made.
 */
export function editTransform(
	world: World,
	editor: DocumentEditor,
	entity: Entity,
	writes: readonly TransformWrite[],
): void {
	const changed = writes.filter(([name, value]) => value !== shownTransform(world, entity, name));

	for (const [name, value] of changed) syncKeyframe(world, editor, entity, name, value);
	for (const [name, value] of writes) editor.editProperty(entity, name, value);
}

const keys = (world: World): Set<string> => world.get(Keys)?.held ?? new Set<string>();

const resolution = (world: World): number => world.get(RenderSurface)?.resolution ?? 1;

function pointerPoint(world: World, mat: Mat2D): Point {
	const pointer = world.get(Pointer)!;
	return transformPoint(invert2D(mat), pointer.clientX, pointer.clientY);
}

function pointerOrigin(world: World, mat: Mat2D): Point {
	const pointer = world.get(Pointer)!;
	return transformPoint(invert2D(mat), pointer.dragStartX, pointer.dragStartY);
}

/** Back to front, in paint order. */
function paintedTopLevel(world: World): Entity[] {
	const computed = store(world, Computed);
	return [...world.query(Or(Geometry, Group), ChildOf(world.get(Root)!), Not(Culled), Not(Hidden), Not(IsMask))]
		.filter((entity) => computed.visibility[entity.id()] !== 0)
		.sort(sortByItemIndex);
}

/** The frontmost hit; `topLevel` is back to front. */
function topLevelAt(world: World, topLevel: Entity[], x: number, y: number): Entity | undefined {
	return [...topLevel].reverse().find((entity) => pointInQuad(x, y, entityQuad(world, entity)));
}

function activateSceneOf(editor: DocumentEditor, entity: Entity): void {
	let root = entity;
	for (let parent = getParentNode(root); parent !== null; parent = getParentNode(parent)) root = parent;
	if (root.has(Scene)) editor.activate(root);
}

function doubleClick(world: World, editor: DocumentEditor, entity: Entity, point: Point): void {
	if (isEditableText(entity)) {
		editor.select(entity);
		mountTextInput(world, entity, point);
		return;
	}

	const child = enterEntity(world, entity, point);
	if (child !== null) editor.select(child);
}

function clearHovering(world: World): void {
	for (const entity of world.query(Hovering)) {
		entity.remove(Hovering);
	}
}

export function handleGeometryInteraction(world: World, event: DispatchedPointerEvent): void {
	const editor = getDocumentEditor(world);

	if (event.type === 'dragstart' && event.target.kind === 'entity') {
		if (beginCaptionWordMove(world, event.target.id, event.clientX, event.clientY)) {
			world.set(Hud, { mode: 'moving' });
			updateCursor(world, 'move');
			return;
		}
		editor.select(event.target.id, { extend: keys(world).has('shift') });
		handleMaskInteraction(world, event);
	}

	if (event.type === 'drag' && isCaptionWordMove()) {
		const pointer = world.get(Pointer)!;
		dragCaptionWords(world, event.clientX, event.clientY, pointer.dragStartX, pointer.dragStartY);
		updateCursor(world, 'move');
		return;
	}

	if (event.type === 'dragend' && isCaptionWordMove()) {
		endCaptionWordMove(world);
		world.set(Hud, { mode: 'idle' });
		updateCursor(world, getToolCursor(world));
		return;
	}

	if (event.type === 'drag' || event.type === 'dragend') {
		handleMaskInteraction(world, event);
	}

	if (event.type === 'click' && event.target.kind === 'entity' && event.target.id.isAlive()) {
		activateSceneOf(editor, event.target.id);
	}

	if (event.type === 'dblclick' && event.target.kind === 'entity') {
		doubleClick(world, editor, event.target.id, { x: event.clientX, y: event.clientY });
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateCursor(world, getToolCursor(world));
	}
}

export function handleCanvasInteraction(world: World, event: DispatchedPointerEvent): void {
	const editor = getDocumentEditor(world);

	if (event.type === 'dragstart') {
		world.set(Hud, { mode: 'marquee' });
	}

	if (event.type === 'drag' && world.get(Hud)?.mode === 'marquee') {
		const marquee = getMarqueeQuad(world);

		if (marquee) {
			const computed = store(world, Computed);
			const pointer = world.get(Pointer)!;
			const visible = (entity: Entity) => computed.visibility[entity.id()] !== 0;
			const topLevel = paintedTopLevel(world);
			const under = topLevelAt(world, topLevel, pointer.dragStartX, pointer.dragStartY);
			const scene = under?.has(Scene) ? under : null;

			if (scene) {
				const inScene = (entity: Entity): boolean => {
					for (let parent = getParentEntity(entity); parent !== null; parent = getParentEntity(parent)) {
						if (parent === scene) return true;
					}
					return false;
				};
				editor.select(world.query(Interactive, Or(Geometry, Group), Not(Culled)).filter((entity) => (
					visible(entity) && inScene(entity) && quadsOverlap(marquee, entityQuad(world, entity))
				)));
			} else {
				editor.select(topLevel.filter((entity) => quadsOverlap(marquee, entityQuad(world, entity))));
			}
		}

		updateCursor(world, getToolCursor(world));
	}

	if (event.type === 'dragend') {
		world.set(Hud, { mode: 'idle' });
	}

	if (event.type === 'pointerup') {
		const pointer = world.get(Pointer)!;
		const dx = event.clientX - pointer.dragStartX;
		const dy = event.clientY - pointer.dragStartY;

		if (Math.hypot(dx, dy) < CLICK_DISTANCE * resolution(world)) {
			editor.clearSelection();
			syncInteractiveState(world);
			clearHovering(world);

			const under = topLevelAt(world, paintedTopLevel(world), event.clientX, event.clientY);
			if (under) activateSceneOf(editor, under);
		}
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateCursor(world, getToolCursor(world));
	}
}

export function handlePlayInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.type !== 'click' || event.target.kind !== 'hud') return;

	// The region is a frame old, so what it points at may be gone.
	const entity = event.target.entity;
	if (!entity?.isAlive()) return;

	togglePlayback(world, entity);
}

export function handleLabelInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.target.kind !== 'hud') return;

	const entity = event.target.entity;
	if (!entity?.isAlive()) return;
	const editor = getDocumentEditor(world);

	if (event.type === 'pointerenter') {
		clearHovering(world);
		entity.add(Hovering);
	}

	if (event.type === 'pointerleave') {
		clearHovering(world);
	}

	if (event.type === 'dragstart') {
		editor.select(entity, { extend: keys(world).has('shift') });
	}

	if (event.type === 'dblclick') {
		mountNameInput(world, entity);
	}

	if (event.type === 'click' && entity.has(Scene)) {
		editor.activate(entity);
	}

	handleMaskInteraction(world, event);
}

export function handleResizeInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.target.kind !== 'hud' || !isHandle(event.target.id)) return;

	const handle = event.target.id;
	const factor = HANDLE_FACTOR[handle];

	if (event.type === 'dragstart') {
		snapshotSelectionMask(world);
		snapshotSelectionTransforms(world);
		snapshotSnapCandidates(world);
		world.get(SnapLines)!.list.length = 0;
	}

	const snapshot = getSelectionMaskSnapshot();

	if (event.type === 'drag' && snapshot) {
		const oldTr = snapshot.mat;
		const selection = getSelection(world);
		const snapLines = world.get(SnapLines)!.list;
		snapLines.length = 0;

		const current = pointerPoint(world, oldTr);
		const origin = pointerOrigin(world, oldTr);

		const deltaX = current.x - origin.x;
		const deltaY = current.y - origin.y;
		let deltaWidth = deltaX * factor.x;
		let deltaHeight = deltaY * factor.y;

		// The Size observer also enforces a stored ratio; when it matches the mask's, that is a no-op.
		const lockAspect = keys(world).has('shift')
			|| (selection.length > 0 && selection.every((entity) => entity.has(KeepAspectRatio)));

		if (lockAspect && snapshot.width > 0 && snapshot.height > 0) {
			const w0 = snapshot.width;
			const h0 = snapshot.height;

			if (factor.x !== 0 && factor.y !== 0) {
				// Project onto the pivot-to-corner diagonal so the corner stays under the cursor without leaping past.
				const t = (deltaX * factor.x * w0 + deltaY * factor.y * h0) / (w0 * w0 + h0 * h0);
				deltaWidth = w0 * t;
				deltaHeight = h0 * t;
			} else if (factor.y === 0) {
				deltaHeight = h0 * ((w0 + deltaWidth) / w0 - 1);
			} else {
				deltaWidth = w0 * ((h0 + deltaHeight) / h0 - 1);
			}
		}

		// Pivot from factor: -1 -> 1 (far edge), 0 -> 0.5 (center), 1 -> 0 (near edge).
		let pivotX = snapshot.width * (1 - factor.x) / 2;
		let pivotY = snapshot.height * (1 - factor.y) / 2;

		const fromCenter = keys(world).has('alt');
		if (fromCenter) {
			pivotX = snapshot.width * 0.5;
			pivotY = snapshot.height * 0.5;
			deltaWidth *= 2;
			deltaHeight *= 2;
		}

		let newWidth = snapshot.width + deltaWidth;
		let newHeight = snapshot.height + deltaHeight;

		{
			const scaled = scaleAbout(pivotX, pivotY, newWidth / snapshot.width, newHeight / snapshot.height);
			const proposed = rectToQuad(multiply2D(oldTr, scaled), snapshot.width, snapshot.height);
			const candidates = getSnapCandidatesSnapshot();
			const dragged = buildSnapCandidatesFromCorners(handleVertices(handle, proposed));
			const threshold = SNAP_DISTANCE * resolution(world);

			if (lockAspect) {
				// Each snap line crosses the pivot-to-corner ray at one scale, (span + offset) / span;
				// take the one closest to 1 and apply it to both axes to keep the ratio.
				const base = transformPoint(oldTr, pivotX, pivotY);
				const ratioOf = (snap: { sourcePoint: Point; offset: number } | null, axis: 'x' | 'y'): number | null => {
					if (!snap) return null;
					const span = snap.sourcePoint[axis] - base[axis];
					return Math.abs(span) < 1e-9 ? null : (span + snap.offset) / span;
				};

				const xSnap = findSnapTarget(dragged.x, candidates.x, threshold, 'x');
				const ySnap = findSnapTarget(dragged.y, candidates.y, threshold, 'y');
				const ratioX = ratioOf(xSnap, 'x');
				const ratioY = ratioOf(ySnap, 'y');
				const takeX = ratioX !== null && (ratioY === null || Math.abs(ratioX - 1) <= Math.abs(ratioY - 1));
				const snap = takeX ? xSnap : (ratioY !== null ? ySnap : null);
				const ratio = takeX ? ratioX : ratioY;

				if (snap && ratio !== null) {
					newWidth *= ratio;
					newHeight *= ratio;
					snapLines.push({
						from: {
							x: base.x + (snap.sourcePoint.x - base.x) * ratio,
							y: base.y + (snap.sourcePoint.y - base.y) * ratio,
						},
						to: snap.targetPoint,
					});
				}
			} else {
				const xSnap = factor.x !== 0 ? findSnapTarget(dragged.x, candidates.x, threshold, 'x') : null;
				const ySnap = factor.y !== 0 ? findSnapTarget(dragged.y, candidates.y, threshold, 'y') : null;

				if (xSnap) snapLines.push({
					from: { x: xSnap.sourcePoint.x + xSnap.offset, y: xSnap.sourcePoint.y + (ySnap?.offset ?? 0) },
					to: xSnap.targetPoint,
				});

				if (ySnap) snapLines.push({
					from: { x: ySnap.sourcePoint.x + (xSnap?.offset ?? 0), y: ySnap.sourcePoint.y + ySnap.offset },
					to: ySnap.targetPoint,
				});

				if (xSnap || ySnap) {
					// The snap offset is in device pixels; map it back as a direction only, hence no translation.
					const inverse = invert2D(oldTr);
					inverse.e = 0;
					inverse.f = 0;
					const correction = transformPoint(inverse, xSnap?.offset ?? 0, ySnap?.offset ?? 0);
					const both = fromCenter ? 2 : 1;

					if (factor.x !== 0) deltaWidth += correction.x * factor.x * both;
					if (factor.y !== 0) deltaHeight += correction.y * factor.y * both;

					newWidth = snapshot.width + deltaWidth;
					newHeight = snapshot.height + deltaHeight;
				}
			}
		}

		const localScale = scaleAbout(pivotX, pivotY, newWidth / snapshot.width, newHeight / snapshot.height);

		// Groups have no Size: resize their direct children; the transform system rebuilds the group's box.
		const hasGroup = selection.some((entity) => entity.has(Group));
		// No wobble guard for a group's children: scaled in the group's space, their rotation and skew really change.
		const writeAngles = selection.length > 1 || hasGroup;

		for (const selected of selection) {
			// A cropped clip's box is its mask: scale both, or the window slides over the frame and the box snaps back.
			const subject = selected.has(Group) ? selected : selectionSubject(world, selected);
			if (
				subject !== selected
				&& snapshot.width > 0
				&& snapshot.height > 0
				&& scaleCroppedClip(
					world,
					selected,
					subject,
					pivotX / snapshot.width,
					pivotY / snapshot.height,
					newWidth / snapshot.width,
					newHeight / snapshot.height,
				)
			) {
				continue;
			}

			const targets = selected.has(Group)
				? [...world.query(Or(Geometry, Group), ChildOf(selected))]
				: [subject];

			for (const entity of targets) {
				resizeNode(world, entity, oldTr, localScale, writeAngles);

				// The walk is parent-first: refresh this group's box now, or a rotated group lags a frame and drifts.
				if (hasGroup) computeLocalMatrix(world, entity);
			}

			if (selected.has(Group)) {
				keepGroupPlaced(world, selected);
			}
		}

		updateResizeCursor(world, handle);
	}

	if (event.type === 'dragend') {
		world.get(SnapLines)!.list.length = 0;
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateResizeCursor(world, handle);
	}
}

/** False when the clip is rotated or skewed: the mask alone is resized then. Pivot fractions are of the mask. */
function scaleCroppedClip(
	world: World,
	clip: Entity,
	mask: Entity,
	pivotFracX: number,
	pivotFracY: number,
	sx: number,
	sy: number,
): boolean {
	if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0) return false;

	const clipSnap = getTransformSnapshot(clip);
	const maskSnap = getTransformSnapshot(mask);
	if (!clipSnap || !maskSnap) return false;

	const straight = (mat: Mat2D): boolean => Math.abs(mat.a - 1) < 1e-4
		&& Math.abs(mat.d - 1) < 1e-4
		&& Math.abs(mat.b) < 1e-4
		&& Math.abs(mat.c) < 1e-4;
	if (!straight(clipSnap.localTransform) || !straight(maskSnap.localTransform)) return false;

	const mx = maskSnap.localTransform.e;
	const my = maskSnap.localTransform.f;
	const pivotLocalX = mx + pivotFracX * maskSnap.width;
	const pivotLocalY = my + pivotFracY * maskSnap.height;
	const clipOffset = entityOffset(world, clip);
	const maskOffset = entityOffset(world, mask);
	const editor = getDocumentEditor(world);

	editTransform(world, editor, clip, [
		['x', Math.round(clipSnap.localTransform.e + pivotLocalX * (1 - sx) - clipOffset.x)],
		['y', Math.round(clipSnap.localTransform.f + pivotLocalY * (1 - sy) - clipOffset.y)],
		['width', Math.round(clipSnap.width * sx)],
		['height', Math.round(clipSnap.height * sy)],
	]);
	editTransform(world, editor, mask, [
		['x', Math.round(mx * sx - maskOffset.x)],
		['y', Math.round(my * sy - maskOffset.y)],
		['width', Math.round(maskSnap.width * sx)],
		['height', Math.round(maskSnap.height * sy)],
	]);
	return true;
}

function resizeNode(world: World, entity: Entity, oldTr: Mat2D, localScale: Mat2D, writeAngles: boolean): void {
	const snapshot = getTransformSnapshot(entity);
	if (!snapshot) return;

	const editor = getDocumentEditor(world);
	const anchor = entityAnchor(world, entity);

	// The decomposition puts the pivot back from the new size, so take it out first.
	const oldLocal = multiply2D(
		snapshot.localTransform,
		translate2D(snapshot.width * anchor.x, snapshot.height * anchor.y),
	);

	const decomposed = decompose2D(inParentSpace(oldTr, localScale, snapshot.parentTransform, oldLocal));

	// Scaling by the node's own scale change accounts for it sitting at an angle to the mask.
	const width = snapshot.width * (decomposed.scaleX / snapshot.scaleX);
	const height = snapshot.height * (decomposed.scaleY / snapshot.scaleY);
	const offset = entityOffset(world, entity);

	const writes: TransformWrite[] = [
		['width', Math.round(width)],
		['height', Math.round(height)],
		['x', Math.round(decomposed.x - width * anchor.x - offset.x)],
		['y', Math.round(decomposed.y - height * anchor.y - offset.y)],
	];
	if (writeAngles) writes.push(['rotation', Math.round(decomposed.rotation * 100) / 100]);
	editTransform(world, editor, entity, writes);

	if (writeAngles) {
		const skew = entity.get(Skew);
		const skewX = Math.round(decomposed.skewX * 100) / 100;
		const skewY = Math.round(decomposed.skewY * 100) / 100;
		if (skewX !== (skew?.x ?? 0)) editor.editProperty(entity, 'skewX', skewX === 0 ? false : skewX);
		if (skewY !== (skew?.y ?? 0)) editor.editProperty(entity, 'skewY', skewY === 0 ? false : skewY);
	}
}

/**
 * Resizing the children moves the group's pivot, which with a rotation drags the group
 * off the pointer; the children were computed against its dragstart transform, so restore it.
 */
function keepGroupPlaced(world: World, group: Entity): void {
	const snapshot = getTransformSnapshot(group);
	if (!snapshot) return;

	// Rebuild the box first, so the new pivot is the one the group is drawn with.
	computeGroupBounds(world, group);

	const computed = store(world, Computed);
	const gid = group.id();
	const anchor = entityAnchor(world, group);
	const pivotX = anchor.x * (computed.width[gid] ?? 0);
	const pivotY = anchor.y * (computed.height[gid] ?? 0);

	// computeLocalMatrix builds L = T(position) · K, K = T(pivot)·linear·T(-pivot).
	// The resize leaves `linear` alone, so solve T(position) = L · K⁻¹ for the
	// new pivot and the rebuilt matrix comes out equal to the snapshot again.
	const desired = snapshot.localTransform;
	const linear: Mat2D = { a: desired.a, b: desired.b, c: desired.c, d: desired.d, e: 0, f: 0 };
	const position = multiply2D(desired, invert2D(scaleFree(pivotX, pivotY, linear)));
	const offset = entityOffset(world, group);
	const editor = getDocumentEditor(world);

	editTransform(world, editor, group, [
		['x', Math.round(position.e - offset.x)],
		['y', Math.round(position.f - offset.y)],
	]);
	computeLocalMatrix(world, group);
}

export function handleRotateInteraction(world: World, event: DispatchedPointerEvent): void {
	if (event.type === 'dragstart') {
		snapshotSelectionTransforms(world);
		snapshotSelectionMask(world);
	}

	const snapshot = getSelectionMaskSnapshot();

	if (event.type === 'drag' && snapshot) {
		const oldTr = snapshot.mat;
		const editor = getDocumentEditor(world);
		const selection = getSelection(world);

		const single = selection.length === 1 ? entityAnchor(world, selection[0]!) : null;
		const pivotX = snapshot.width * (single?.x ?? 0.5);
		const pivotY = snapshot.height * (single?.y ?? 0.5);

		const current = pointerPoint(world, oldTr);
		const origin = pointerOrigin(world, oldTr);
		const delta = Math.atan2(current.y - pivotY, current.x - pivotX)
			- Math.atan2(origin.y - pivotY, origin.x - pivotX);

		const localRotate = rotateAbout(pivotX, pivotY, delta * 180 / Math.PI);

		for (const entity of selection) {
			const state = getTransformSnapshot(entity);
			if (!state) continue;

			const anchor = entityAnchor(world, entity);
			const anchorX = state.width * anchor.x;
			const anchorY = state.height * anchor.y;
			const oldLocal = multiply2D(state.localTransform, translate2D(anchorX, anchorY));

			let newLocal = inParentSpace(oldTr, localRotate, state.parentTransform, oldLocal);
			let decomposed = decompose2D(newLocal);

			// Shift snaps to 15 degree steps. Snap about the gesture's pivot and re-derive the position:
			// a group's matrix pivots about its box center, not the mask's, so reusing it makes the mask jump.
			if (keys(world).has('shift')) {
				const snapped = Math.round(decomposed.rotation / 15) * 15;

				if (snapped !== decomposed.rotation) {
					const pivot = transformPoint(oldTr, pivotX, pivotY);
					const correction = rotateAbout(pivot.x, pivot.y, snapped - decomposed.rotation);
					newLocal = multiply2D(inParent(state.parentTransform, correction), newLocal);
					decomposed = decompose2D(newLocal);
				}
			}

			const offset = entityOffset(world, entity);
			editTransform(world, editor, entity, [
				['x', Math.round(decomposed.x - anchorX - offset.x)],
				['y', Math.round(decomposed.y - anchorY - offset.y)],
				['rotation', Math.round(decomposed.rotation * 100) / 100],
			]);
		}

		updateRotationCursor(world);
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateRotationCursor(world);
	}
}

export function handleMaskInteraction(world: World, event: DispatchedPointerEvent): void {
	const editor = getDocumentEditor(world);

	// The mask covers the node, so a double-click on a selected node lands here.
	if (event.type === 'dblclick') {
		const selection = getSelection(world);
		if (selection.length !== 1) return;
		doubleClick(world, editor, selection[0]!, { x: event.clientX, y: event.clientY });
		return;
	}

	if (event.type === 'dragstart') {
		snapshotSelectionMask(world);
		snapshotSelectionTransforms(world);
		snapshotSnapCandidates(world);
		world.get(SnapLines)!.list.length = 0;
		reparentCorrections.clear();
		resetDwell(world, { x: event.clientX, y: event.clientY });
		world.set(Hud, { mode: 'moving' });
	}

	const snapshot = getSelectionMaskSnapshot();

	if (event.type === 'drag' && snapshot) {
		const oldTr = snapshot.mat;
		const snapLines = world.get(SnapLines)!.list;
		snapLines.length = 0;

		const current = pointerPoint(world, oldTr);
		const origin = pointerOrigin(world, oldTr);
		let deltaX = current.x - origin.x;
		let deltaY = current.y - origin.y;

		if (!keys(world).has('mod')) {
			const proposed = rectToQuad(multiply2D(oldTr, translate2D(deltaX, deltaY)), snapshot.width, snapshot.height);
			const candidates = getSnapCandidatesSnapshot();
			const moved = buildSnapCandidatesFromQuad(proposed);
			const threshold = SNAP_DISTANCE * resolution(world);
			const xSnap = findSnapTarget(moved.x, candidates.x, threshold, 'x');
			const ySnap = findSnapTarget(moved.y, candidates.y, threshold, 'y');

			if (xSnap) snapLines.push({
				from: { x: xSnap.sourcePoint.x + xSnap.offset, y: xSnap.sourcePoint.y + (ySnap?.offset ?? 0) },
				to: xSnap.targetPoint,
			});

			if (ySnap) snapLines.push({
				from: { x: ySnap.sourcePoint.x + (xSnap?.offset ?? 0), y: ySnap.sourcePoint.y + ySnap.offset },
				to: ySnap.targetPoint,
			});

			if (xSnap || ySnap) {
				const inverse = invert2D(oldTr);
				inverse.e = 0;
				inverse.f = 0;
				const correction = transformPoint(inverse, xSnap?.offset ?? 0, ySnap?.offset ?? 0);
				deltaX += correction.x;
				deltaY += correction.y;
			}
		}

		const localOffset = translate2D(deltaX, deltaY);
		const drop = settledDropTarget(world, { x: event.clientX, y: event.clientY });

		for (const entity of getSelection(world)) {
			const state = getTransformSnapshot(entity);
			if (!state) continue;

			if (drop !== undefined) reparentTo(world, entity, drop);

			const anchor = entityAnchor(world, entity);
			const anchorX = state.width * anchor.x;
			const anchorY = state.height * anchor.y;
			const oldLocal = multiply2D(state.localTransform, translate2D(anchorX, anchorY));
			// Snapshots are against the drag's starting parent, so a reparented node carries the correction.
			const correction = reparentCorrections.get(entity) ?? identity2D();
			const moved = multiply2D(correction, inParentSpace(oldTr, localOffset, state.parentTransform, oldLocal));
			const decomposed = decompose2D(moved);
			const offset = entityOffset(world, entity);

			editTransform(world, editor, entity, [
				['x', Math.round(decomposed.x - anchorX - offset.x)],
				['y', Math.round(decomposed.y - anchorY - offset.y)],
			]);
		}
	}

	if (event.type === 'dragend') {
		world.get(SnapLines)!.list.length = 0;
		world.set(Hud, { mode: 'idle' });
	}

	if (world.get(Pointer)!.phase === 'lifted') {
		updateCursor(world, getToolCursor(world));
	}
}

/** Per node: new parent⁻¹ · old parent, accumulated over every parent change this drag. */
const reparentCorrections = new Map<Entity, Mat2D>();

function sceneDepth(entity: Entity): number {
	let depth = 0;
	for (let scene = getSceneAncestor(entity); scene !== null; scene = getSceneAncestor(scene)) depth++;
	return depth;
}

/** The innermost scene under the point, excluding dragged nodes and their subtrees, so a node can't drop into itself. */
function findSceneAtPointer(world: World, point: Point): Entity | null {
	let target: Entity | null = null;
	let deepest = -1;

	for (const scene of world.query(Scene, Not(Selected), Not(Culled))) {
		if (isDragged(scene) || !isPointerInEntity(world, scene, point)) continue;

		const depth = sceneDepth(scene);
		if (depth > deepest) {
			deepest = depth;
			target = scene;
		}
	}

	return target;
}

function isDragged(entity: Entity): boolean {
	for (let node: Entity | null = entity; node !== null; node = getParentNode(node)) {
		if (node.has(Selected)) return true;
	}

	return false;
}

function hasPositionKeyframes(world: World, entity: Entity): boolean {
	return findKeyframeTrackEntity(world, entity, 'position.x') !== null
		|| findKeyframeTrackEntity(world, entity, 'position.y') !== null;
}

/** Without a dwell, passing over a scene would re-home the node twice, writing both to the file. */
const DROP_DWELL_MS = 250;

const dwell = { target: null as Entity | null, since: 0 };

/** The wait starts on what the pointer is already over, so it begins when the node leaves, not when grabbed. */
function resetDwell(world: World, point: Point): void {
	dwell.target = findSceneAtPointer(world, point);
	dwell.since = world.get(Time)?.now ?? 0;
}

/** null is the stage; undefined until the pointer has stayed long enough. */
function settledDropTarget(world: World, point: Point): Entity | null | undefined {
	const target = findSceneAtPointer(world, point);
	const now = world.get(Time)?.now ?? 0;

	if (target !== dwell.target) {
		dwell.target = target;
		dwell.since = now;
	}

	return now - dwell.since >= DROP_DWELL_MS ? dwell.target : undefined;
}

/**
 * One level at a time: only top-level nodes are taken in, only direct children handed back.
 * Top-level means `getParentNode`, not a missing parent: a root's parent is the stage.
 */
function reparentTo(world: World, entity: Entity, target: Entity | null): void {
	const editor = getDocumentEditor(world);
	const parent = getParentNode(entity);
	const before = entityWorldMat(world, getParentEntity(entity));
	let moved = false;

	if (target !== null && target !== entity && parent === null) {
		moved = editor.reparent(entity, target);
		// Only a root can hold the active tag, so a nested drop leaves it where it was.
		if (moved && getParentNode(target) === null) editor.activate(target);
	}

	if (target === null && parent !== null && getSceneAncestor(entity) !== null && !hasPositionKeyframes(world, entity)) {
		moved = editor.reparent(entity, world.get(Root)!);
	}

	if (!moved) return;

	const after = entityWorldMat(world, getParentEntity(entity));
	const correction = multiply2D(invert2D(after), before);
	reparentCorrections.set(entity, multiply2D(reparentCorrections.get(entity) ?? identity2D(), correction));
}

export function updateResizeCursor(world: World, handle: Handle): void {
	const mask = getSelectionMask(world);
	if (mask === null) return;

	updateCursor(world, HANDLE_CURSOR[handle], Math.atan2(mask.mat.b, mask.mat.a));
}

export function updateRotationCursor(world: World): void {
	const mask = getSelectionMask(world);
	if (mask === null) return;

	const quad = rectToQuad(mask.mat, mask.width, mask.height);
	const center = quadCenter(quad);
	const pointer = world.get(Pointer)!;
	const angle = Math.atan2(center.y - pointer.clientY, center.x - pointer.clientX);

	updateCursor(world, 'nwse-rotate', angle - Math.PI / 4);
}

function scaleAbout(x: number, y: number, scaleX: number, scaleY: number): Mat2D {
	let mat = translate2D(x, y);
	mat = multiply2D(mat, scale2D(scaleX, scaleY));
	return multiply2D(mat, translate2D(-x, -y));
}

function rotateAbout(x: number, y: number, degrees: number): Mat2D {
	let mat = translate2D(x, y);
	mat = multiply2D(mat, rotate2D(degrees));
	return multiply2D(mat, translate2D(-x, -y));
}

/** The pivot part of `computeLocalMatrix`: T(pivot) · linear · T(-pivot). */
function scaleFree(pivotX: number, pivotY: number, linear: Mat2D): Mat2D {
	return multiply2D(multiply2D(translate2D(pivotX, pivotY), linear), translate2D(-pivotX, -pivotY));
}

/** A mask-space delta as the parent sees it: parent⁻¹ · mask · delta · mask⁻¹ · parent. */
function inParent(parentTransform: Mat2D, deltaWorld: Mat2D): Mat2D {
	return multiply2D(multiply2D(invert2D(parentTransform), deltaWorld), parentTransform);
}

function inParentSpace(maskTr: Mat2D, localDelta: Mat2D, parentTransform: Mat2D, oldLocal: Mat2D): Mat2D {
	const deltaWorld = multiply2D(multiply2D(maskTr, localDelta), invert2D(maskTr));
	return multiply2D(inParent(parentTransform, deltaWorld), oldLocal);
}

function handleVertices(handle: Handle, quad: Quad): Point[] {
	switch (handle) {
		case 'tl': return [quad[0]];
		case 'tr': return [quad[1]];
		case 'br': return [quad[2]];
		case 'bl': return [quad[3]];
		case 't': return [quad[0], quad[1]];
		case 'r': return [quad[1], quad[2]];
		case 'b': return [quad[2], quad[3]];
		case 'l': return [quad[3], quad[0]];
	}
}
