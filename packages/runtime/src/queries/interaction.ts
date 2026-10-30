/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Interaction reads: the device-pixel geometry an editor points at (was
// utils/interaction.ts + parts of utils/coordinates.ts). Everything here is in
// canvas device pixels, the space the transform system leaves WorldTransform
// and WorldBounds in, so a pointer position can be compared against it without
// converting anything. Derived transforms are read from the SoA stores by
// entity id: the transform system writes them there without ever adding the
// traits.

import { Not, Or } from 'koota';

import {
	Anchor, Cache, Computed, Geometry, Group, Hidden, LocalTransform, Offset, Selected,
	Sequential, WorldBounds, WorldTransform,
} from '../traits';
import { store } from '../world/store';
import { isStage } from './predicates';
import { getViewMatrix } from './camera';
import {
	decompose2D, identity2D, invert2D, multiply2D, rectToQuad, rotate2D,
	scale2D, skew2D, transformPoint, translate2D,
} from '../math';

import type { Entity, World } from 'koota';
import type { Mat2D, Point, Quad } from '../math';

/**
 * World matrix of `entity`, or the view matrix for the stage (and for null,
 * which is what `getParentNode` answers for a top-level node). Parent-space
 * math over a root therefore works without a special case at the call site.
 */
export function entityWorldMat(world: World, entity: Entity | null): Mat2D {
	if (entity === null || isStage(entity)) return getViewMatrix(world);

	const transform = store(world, WorldTransform);
	const eid = entity.id();

	return {
		a: transform.a[eid] ?? 1, b: transform.b[eid] ?? 0,
		c: transform.c[eid] ?? 0, d: transform.d[eid] ?? 1,
		e: transform.e[eid] ?? 0, f: transform.f[eid] ?? 0,
	};
}

export function entityLocalMat(world: World, entity: Entity): Mat2D {
	const local = store(world, LocalTransform);
	const eid = entity.id();

	return {
		a: local.a[eid] ?? 1, b: local.b[eid] ?? 0,
		c: local.c[eid] ?? 0, d: local.d[eid] ?? 1,
		e: local.e[eid] ?? 0, f: local.f[eid] ?? 0,
	};
}

export function entityOffset(world: World, entity: Entity): Point {
	const offset = store(world, Offset);
	const eid = entity.id();

	return { x: offset.x[eid] ?? 0, y: offset.y[eid] ?? 0 };
}

export function entityAnchor(world: World, entity: Entity): Point {
	const anchor = store(world, Anchor);
	const eid = entity.id();

	return { x: anchor.x[eid] ?? 0.5, y: anchor.y[eid] ?? 0.5 };
}

/**
 * The node the selection box is drawn around. A clip whose mask keeps only
 * part of it — a facecam cut from a larger frame — is edited through that
 * mask, so the outline, the handles, and a click all land on the part that
 * shows. A mask that covers the whole clip leaves the clip as the box.
 */
export function selectionSubject(world: World, entity: Entity): Entity {
	if (entity.has(Group)) return entity;

	const masks = croppingMasks(world, entity);
	if (masks.length !== 1) return entity;

	const mask = masks[0]!;
	const computed = store(world, Computed);
	const mid = mask.id();
	if ((computed.rotation[mid] ?? 0) !== 0) return entity;
	if ((computed.skewX[mid] ?? 0) !== 0 || (computed.skewY[mid] ?? 0) !== 0) return entity;
	if ((computed.scaleX[mid] ?? 1) !== 1 || (computed.scaleY[mid] ?? 1) !== 1) return entity;

	const eid = entity.id();
	const ownX = computed.originX[eid] ?? 0;
	const ownY = computed.originY[eid] ?? 0;
	const ownW = computed.width[eid] ?? 0;
	const ownH = computed.height[eid] ?? 0;
	const x = (computed.positionX[mid] ?? 0) + (computed.offsetX[mid] ?? 0) + (computed.originX[mid] ?? 0);
	const y = (computed.positionY[mid] ?? 0) + (computed.offsetY[mid] ?? 0) + (computed.originY[mid] ?? 0);
	const w = computed.width[mid] ?? 0;
	const h = computed.height[mid] ?? 0;

	const slop = 0.5;
	const covers = x <= ownX + slop && y <= ownY + slop
		&& x + w >= ownX + ownW - slop && y + h >= ownY + ownH - slop;
	return covers ? entity : mask;
}

/** Masks that are actually clipping the clip this frame. */
function croppingMasks(world: World, entity: Entity): Entity[] {
	const computed = store(world, Computed);
	return (store(world, Cache).masks[entity.id()] ?? []).filter((mask) => {
		if (!mask.isAlive() || mask.has(Hidden)) return false;
		if (computed.visibility[mask.id()] === 0) return false;
		const w = computed.width[mask.id()] ?? 0;
		const h = computed.height[mask.id()] ?? 0;
		return w >= 1 && h >= 1;
	});
}

/** The entity's box in device pixels, as [TL, TR, BR, BL]. */
export function entityQuad(world: World, entity: Entity): Quad {
	return frameQuad(world, selectionSubject(world, entity));
}

function frameQuad(world: World, entity: Entity): Quad {
	const computed = store(world, Computed);
	const eid = entity.id();
	const mat = multiply2D(
		entityWorldMat(world, entity),
		translate2D(computed.originX[eid] ?? 0, computed.originY[eid] ?? 0),
	);

	return rectToQuad(mat, computed.width[eid] ?? 0, computed.height[eid] ?? 0);
}

/** Whether a device-pixel point is inside the entity's box. */
export function isPointerInEntity(world: World, entity: Entity, point: Point): boolean {
	const subject = selectionSubject(world, entity);
	const bounds = store(world, WorldBounds);
	const eid = subject.id();

	if (
		point.x < bounds.minX[eid] || point.x > bounds.maxX[eid] ||
		point.y < bounds.minY[eid] || point.y > bounds.maxY[eid]
	) {
		return false;
	}

	// Precise test: map the pointer into entity-local space so rotation/skew
	// don't produce false positives along the AABB's outer slack.
	const local = transformPoint(invert2D(entityWorldMat(world, subject)), point.x, point.y);
	const computed = store(world, Computed);
	const originX = computed.originX[eid] ?? 0;
	const originY = computed.originY[eid] ?? 0;

	return local.x >= originX && local.x <= originX + (computed.width[eid] ?? 0)
		&& local.y >= originY && local.y <= originY + (computed.height[eid] ?? 0);
}

/** The entities a selection mask spans: sequences are not spatial, so they never do. */
export function getMaskSelection(world: World): Entity[] {
	return [...world.query(Selected, Or(Geometry, Group), Not(Sequential))];
}

/** Every selected node, sequences included (what a transform gesture moves). */
export function getSelection(world: World): Entity[] {
	return [...world.query(Selected, Or(Geometry, Group))];
}

/**
 * The box the selection is manipulated through, in device pixels: for one
 * node its own rotated/skewed frame (the visible mask, when one crops it),
 * for several the upright AABB of them all. Null when nothing selectable
 * is selected.
 */
export type SelectionMask = {
	width: number;
	height: number;
	mat: Mat2D;
};

export function getSelectionMask(world: World): SelectionMask | null {
	const selection = getMaskSelection(world);
	if (selection.length === 0) return null;

	const computed = store(world, Computed);

	if (selection.length === 1) {
		const entity = selectionSubject(world, selection[0]!);
		const eid = entity.id();
		const worldMat = multiply2D(
			entityWorldMat(world, entity),
			translate2D(computed.originX[eid] ?? 0, computed.originY[eid] ?? 0),
		);
		const decomposed = decompose2D(worldMat);

		let mat = identity2D();
		mat = multiply2D(mat, translate2D(decomposed.x, decomposed.y));
		mat = multiply2D(mat, rotate2D(decomposed.rotation));
		mat = multiply2D(mat, scale2D(Math.sign(decomposed.scaleX) || 1, Math.sign(decomposed.scaleY) || 1));
		mat = multiply2D(mat, skew2D(decomposed.skewX, decomposed.skewY));

		return {
			width: (computed.width[eid] ?? 0) * Math.abs(decomposed.scaleX),
			height: (computed.height[eid] ?? 0) * Math.abs(decomposed.scaleY),
			mat,
		};
	}

	let minX = Infinity, minY = Infinity;
	let maxX = -Infinity, maxY = -Infinity;

	for (const entity of selection) {
		for (const point of entityQuad(world, entity)) {
			if (point.x < minX) minX = point.x;
			if (point.y < minY) minY = point.y;
			if (point.x > maxX) maxX = point.x;
			if (point.y > maxY) maxY = point.y;
		}
	}

	return { width: maxX - minX, height: maxY - minY, mat: translate2D(minX, minY) };
}
