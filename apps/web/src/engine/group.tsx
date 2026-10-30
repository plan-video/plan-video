/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Group as GroupElement, Scene as SceneElement, Sequence as SequenceElement } from '@plan.video/reconciler';
import {
	AdjustmentLayer,
	Computed,
	Flip,
	FrameRate,
	Geometry,
	Group,
	IsMask,
	Position,
	Scene,
	Selected,
	Sequential,
	aabbFromTransformedRect,
	computeLocalMatrix,
	decompose2D,
	entityAnchor,
	entityLocalMat,
	entityOffset,
	framesToSeconds,
	getEntityChildren,
	getNextName,
	getParentEntity,
	getTimelineOrigin,
	multiply2D,
	store,
	translate2D,
} from '@plan.video/runtime';
import { Not, Or } from 'koota';

import { t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';
import { editTransform } from './input/interactions';
import { syncKeyframe } from './keyframes';
import { resolveNewSequenceOverlaps } from './overlap';
import { authoredTime } from './timing';

import type { DocumentEditor } from './editor';
import type { TransformWrite } from './input/interactions';
import type { Mat2D } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

/** A mask belongs to its target, not the group. */
const NODES = Or(Geometry, Group, AdjustmentLayer);

const EPSILON = 1e-6;

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

function isIdentity(mat: Mat2D): boolean {
	return Math.abs(mat.a - 1) < EPSILON && Math.abs(mat.b) < EPSILON
		&& Math.abs(mat.c) < EPSILON && Math.abs(mat.d - 1) < EPSILON
		&& Math.abs(mat.e) < EPSILON && Math.abs(mat.f) < EPSILON;
}

/**
 * The group has no transform and its box comes from the members, so nothing
 * moves. Only members sharing the first one's parent go in.
 */
export function groupSelection(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES, Not(IsMask))];
	if (!selected.length) return;

	const group = editor.wrap(selected, () => <GroupElement name={getNextName(world, t({ message: 'Group', context: 'noun' }))} />);
	if (group) editor.select(group);
}

/**
 * A sequence has no space or time of its own, but its children cannot overlap
 * in time: the earlier clip keeps its span and the later one gives way.
 */
export function wrapSelectionInSequence(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES, Not(IsMask))];
	if (!selected.length) return;

	const sequence = editor.wrap(selected, () => <SequenceElement name={getNextName(world, t('Sequence'))} />);
	if (!sequence) return;

	resolveNewSequenceOverlaps(world, sequence);
	editor.select(sequence);
}

function nodeChildren(world: World, entity: Entity): Entity[] {
	return getEntityChildren(world, entity).filter(
		(child) => (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) && !child.has(IsMask),
	);
}

/** A sequence cannot author a position, so its node children are measured and shifted instead. */
function spatialLeaves(world: World, entity: Entity): Entity[] {
	if (!entity.has(Sequential)) return [entity];
	return nodeChildren(world, entity).flatMap((child) => spatialLeaves(world, child));
}

/**
 * The scene is authored around the members (edges rounded outward so its clip
 * crops nothing) and members shift by its corner, so nothing moves on the
 * canvas. Members that cannot hold a position ride along unshifted.
 */
export function wrapSelectionInScene(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = new Set(world.query(Selected, NODES, Not(IsMask)));
	const first = [...selected][0];
	if (!first) return;

	const parent = getParentEntity(first);
	if (!parent) return;

	const members = getEntityChildren(world, parent).filter((entity) => selected.has(entity));
	const measured = members.flatMap((member) => spatialLeaves(world, member));
	if (!measured.length) return;

	const computed = store(world, Computed);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const entity of measured) {
		const eid = entity.id();
		computeLocalMatrix(world, entity);
		// Origin folded into the matrix, as computeWorldBounds frames it.
		const bounds = aabbFromTransformedRect(
			multiply2D(entityLocalMat(world, entity), translate2D(computed.originX[eid] ?? 0, computed.originY[eid] ?? 0)),
			computed.width[eid] ?? 0,
			computed.height[eid] ?? 0,
		);
		if (bounds.minX < minX) minX = bounds.minX;
		if (bounds.minY < minY) minY = bounds.minY;
		if (bounds.maxX > maxX) maxX = bounds.maxX;
		if (bounds.maxY > maxY) maxY = bounds.maxY;
	}

	const x = Math.floor(minX);
	const y = Math.floor(minY);
	const width = Math.max(1, Math.ceil(maxX) - x);
	const height = Math.max(1, Math.ceil(maxY) - y);

	const scene = editor.wrap([...selected], () => (
		<SceneElement name={getNextName(world, t('Scene'))} x={x} y={y} width={width} height={height} />
	));
	if (!scene) return;

	if (x !== 0 || y !== 0) {
		for (const entity of measured) {
			if (!entity.has(Position)) continue;
			const eid = entity.id();

			const writes: TransformWrite[] = [];
			if (x !== 0) writes.push(['x', Math.round(computed.positionX[eid] ?? 0) - x]);
			if (y !== 0) writes.push(['y', Math.round(computed.positionY[eid] ?? 0) - y]);
			editTransform(world, editor, entity, writes);
		}
	}

	editor.select(scene);
}

/** Frames to add to a child's times so it plays at the same moment once the group is gone. */
function timelineShift(world: World, group: Entity): number {
	return (store(world, Computed).origin[group.id()] ?? 0) - getTimelineOrigin(group);
}

/**
 * One bake covers every container kind: a sequence's transform is the
 * identity and writes nothing, a scene's is a pure translation.
 */
export function ungroupSelection(world: World): void {
	dissolveContainers(world, [...world.query(Selected, Or(Group, Scene))]);
}

export function unwrapSequenceSelection(world: World): void {
	dissolveContainers(world, [...world.query(Selected, Sequential)]);
}

/**
 * The container's transform is baked into each child (a shear as skewX/skewY)
 * and its time offset into their times, so the picture stays the same.
 */
function dissolveContainers(world: World, containers: Entity[]): void {
	if (!containers.length) return;

	const editor = getDocumentEditor(world);
	const released: Entity[] = [];

	for (const group of containers) {
		if (!group.isAlive()) continue;
		const parent = getParentEntity(group);
		if (!parent) continue;

		// Rebuilt rather than read: an adjustment layer composes itself into the
		// stored matrix of the clip below it.
		computeLocalMatrix(world, group);
		const groupLocal = entityLocalMat(world, group);
		const bake = !isIdentity(groupLocal);
		const shift = timelineShift(world, group);

		for (const child of nodeChildren(world, group)) {
			if (!editor.reparent(child, parent, group)) continue;
			released.push(child);

			// A sequence cannot hold the position or start; its contents take the bake instead.
			for (const leaf of spatialLeaves(world, child)) {
				bakeContainerInto(world, editor, leaf, bake ? groupLocal : null, shift);
			}
		}

		editor.remove(group);
	}

	if (released.length) editor.select(released);
}

/** `containerLocal` is null for the identity. */
function bakeContainerInto(
	world: World,
	editor: DocumentEditor,
	child: Entity,
	containerLocal: Mat2D | null,
	shift: number,
): void {
	const computed = store(world, Computed);
	const flip = store(world, Flip);
	const cid = child.id();

	if (containerLocal) {
		computeLocalMatrix(world, child);
		const anchor = entityAnchor(world, child);
		const pivotX = anchor.x * (computed.width[cid] ?? 0);
		const pivotY = anchor.y * (computed.height[cid] ?? 0);

		// Pivot folded in before decomposing, as `resizeNode` does, to clear the
		// (I - L)·pivot term the local matrix wraps around it.
		const composed = multiply2D(
			multiply2D(containerLocal, entityLocalMat(world, child)),
			translate2D(pivotX, pivotY),
		);
		const decomposed = decompose2D(composed);
		const offset = entityOffset(world, child);

		const x = Math.round(decomposed.x - pivotX - offset.x);
		const y = Math.round(decomposed.y - pivotY - offset.y);
		const rotation = round2(decomposed.rotation);
		const writes: TransformWrite[] = [];
		if (x !== Math.round(computed.positionX[cid] ?? 0)) writes.push(['x', x]);
		if (y !== Math.round(computed.positionY[cid] ?? 0)) writes.push(['y', y]);
		if (rotation !== round2(computed.rotation[cid] ?? 0)) writes.push(['rotation', rotation]);
		if (writes.length) editTransform(world, editor, child, writes);

		// The decomposed scale carries the flip; divide it out since the trait keeps holding it.
		const scaleX = round4(decomposed.scaleX / (flip.x[cid] ?? 1));
		const scaleY = round4(decomposed.scaleY / (flip.y[cid] ?? 1));
		if (scaleX !== round4(computed.scaleX[cid] ?? 1) || scaleY !== round4(computed.scaleY[cid] ?? 1)) {
			if (Math.abs(scaleX - scaleY) < EPSILON) {
				editor.editProperty(child, 'scaleX', false);
				editor.editProperty(child, 'scaleY', false);
				editor.editProperty(child, 'scale', scaleX === 1 ? false : scaleX);
				syncKeyframe(world, editor, child, 'scale', scaleX);
			} else {
				editor.editProperty(child, 'scale', false);
				editor.editProperty(child, 'scaleX', scaleX);
				editor.editProperty(child, 'scaleY', scaleY);
				syncKeyframe(world, editor, child, 'scaleX', scaleX);
				syncKeyframe(world, editor, child, 'scaleY', scaleY);
			}
		}

		const skewX = round2(decomposed.skewX);
		const skewY = round2(decomposed.skewY);
		if (skewX !== round2(computed.skewX[cid] ?? 0)) editor.editProperty(child, 'skewX', skewX === 0 ? false : skewX);
		if (skewY !== round2(computed.skewY[cid] ?? 0)) editor.editProperty(child, 'skewY', skewY === 0 ? false : skewY);
	}

	if (shift !== 0) {
		const fps = world.get(FrameRate)?.value ?? 30;
		const start = (authoredTime(world, child, 'start') ?? 0) + shift;
		editor.editProperty(child, 'start', start === 0 ? false : framesToSeconds(start, fps));
		const end = authoredTime(world, child, 'end');
		if (end !== undefined) editor.editProperty(child, 'end', framesToSeconds(end + shift, fps));
	}
}
