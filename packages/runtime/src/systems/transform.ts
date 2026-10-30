/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	ChildOf, Geometry, Group, Hidden, IsMask, Sequential, AdjustmentLayer,
	Culled, Flip, Anchor, Computed, Cache, LocalTransform, WorldTransform,
	WorldBounds, RenderSurface,
	Root,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getViewMatrix } from '../queries/camera';

import {
	multiply2D,
	aabbFromTransformedRect,
	aabbsIntersect,
	translate2D,
	rotate2D,
	skew2D,
	scale2D,
	type Mat2D,
} from '../math';

import type { Entity, World } from 'koota';

// Writes derived per-frame data straight into trait stores: no snapshots, no change events.

export function computeLocalMatrix(world: World, entity: Entity): void {
	const flip = store(world, Flip);
	const anchor = store(world, Anchor);
	const computed = store(world, Computed);
	const local = store(world, LocalTransform);
	const eid = entity.id();

	const positionX = computed.positionX[eid] + computed.offsetX[eid];
	const positionY = computed.positionY[eid] + computed.offsetY[eid];
	const pivotX = (anchor.x[eid] ?? 0.5) * computed.width[eid];
	const pivotY = (anchor.y[eid] ?? 0.5) * computed.height[eid];
	const scaleX = (flip.x[eid] ?? 1) * computed.scaleX[eid];
	const scaleY = (flip.y[eid] ?? 1) * computed.scaleY[eid];
	const rotation = computed.rotation[eid];
	const skewX = computed.skewX[eid];
	const skewY = computed.skewY[eid];

	let mat = translate2D(positionX, positionY);
	mat = multiply2D(mat, translate2D(pivotX, pivotY));
	mat = multiply2D(mat, rotate2D(rotation));
	mat = multiply2D(mat, skew2D(skewX, skewY));
	mat = multiply2D(mat, scale2D(scaleX, scaleY));
	mat = multiply2D(mat, translate2D(-pivotX, -pivotY));

	local.a[eid] = mat.a;
	local.b[eid] = mat.b;
	local.c[eid] = mat.c;
	local.d[eid] = mat.d;
	local.e[eid] = mat.e;
	local.f[eid] = mat.f;
}

/** For top-level entities the camera × DPR matrix stands in for the parent's. */
export function computeWorldTransform(world: World, entity: Entity, parentEntity: Entity | null): void {
	const worldStore = store(world, WorldTransform);
	const localStore = store(world, LocalTransform);
	const eid = entity.id();

	if (localStore.a[eid] === undefined) {
		localStore.a[eid] = 1;
		localStore.b[eid] = 0;
		localStore.c[eid] = 0;
		localStore.d[eid] = 1;
		localStore.e[eid] = 0;
		localStore.f[eid] = 0;
	}

	let parent: Mat2D;
	if (parentEntity !== null) {
		const pid = parentEntity.id();
		parent = {
			a: worldStore.a[pid], b: worldStore.b[pid],
			c: worldStore.c[pid], d: worldStore.d[pid],
			e: worldStore.e[pid], f: worldStore.f[pid],
		};
	} else {
		parent = getViewMatrix(world);
	}

	const local: Mat2D = {
		a: localStore.a[eid], b: localStore.b[eid],
		c: localStore.c[eid], d: localStore.d[eid],
		e: localStore.e[eid], f: localStore.f[eid],
	};

	const m = multiply2D(parent, local);

	worldStore.a[eid] = m.a;
	worldStore.b[eid] = m.b;
	worldStore.c[eid] = m.c;
	worldStore.d[eid] = m.d;
	worldStore.e[eid] = m.e;
	worldStore.f[eid] = m.f;
}

export function computeWorldBounds(world: World, entity: Entity): void {
	const boundsStore = store(world, WorldBounds);
	const worldStore = store(world, WorldTransform);
	const computed = store(world, Computed);
	const eid = entity.id();

	const worldMat: Mat2D = {
		a: worldStore.a[eid], b: worldStore.b[eid],
		c: worldStore.c[eid], d: worldStore.d[eid],
		e: worldStore.e[eid], f: worldStore.f[eid],
	};
	const mat = multiply2D(worldMat, translate2D(computed.originX[eid], computed.originY[eid]));
	const bounds = aabbFromTransformedRect(mat, computed.width[eid], computed.height[eid]);

	boundsStore.minX[eid] = bounds.minX;
	boundsStore.minY[eid] = bounds.minY;
	boundsStore.maxX[eid] = bounds.maxX;
	boundsStore.maxY[eid] = bounds.maxY;
}

function cullEntity(world: World, entity: Entity, parentEntity: Entity | null): void {
	// The renderer skips culled parents' whole subtrees, so propagating the tag lets descendants free
	// their decoders too. Pre-order DFS settles the parent's tag before the child.

	let intersect = true;

	if (parentEntity === null) {
		// Without a render surface (headless world) nothing is culled.
		const canvas = world.get(RenderSurface)?.canvas;
		if (canvas) {
			const boundsStore = store(world, WorldBounds);
			const eid = entity.id();
			intersect = aabbsIntersect({
				minX: boundsStore.minX[eid],
				minY: boundsStore.minY[eid],
				maxX: boundsStore.maxX[eid],
				maxY: boundsStore.maxY[eid],
			}, {
				minX: 0,
				minY: 0,
				maxX: canvas.width,
				maxY: canvas.height,
			});
		}
	} else {
		intersect = !parentEntity.has(Culled);
	}

	const wasCulled = entity.has(Culled);

	if (!intersect) {
		if (!wasCulled) {
			entity.add(Culled);
		}
	} else if (wasCulled) {
		entity.remove(Culled);
	}
}

/** Sequences aren't spatial: they mirror the parent's frame (already settled, the walk is parent-first). */
export function computeGroupBounds(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const localStore = store(world, LocalTransform);
	const eid = entity.id();

	if (entity.has(Sequential)) {
		const parent = getParentNode(entity);
		if (parent !== null) {
			const pid = parent.id();
			computed.width[eid] = computed.width[pid];
			computed.height[eid] = computed.height[pid];
			computed.originX[eid] = computed.originX[pid] ?? 0;
			computed.originY[eid] = computed.originY[pid] ?? 0;
			return;
		}
	}

	if (entity.has(Group)) {
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let any = false;

		for (const child of world.query(Or(Geometry, Group), ChildOf(entity), Not(Hidden), Not(IsMask))) {
			const cid = child.id();
			const mat: Mat2D = {
				a: localStore.a[cid] ?? 1, b: localStore.b[cid] ?? 0,
				c: localStore.c[cid] ?? 0, d: localStore.d[cid] ?? 1,
				e: localStore.e[cid] ?? 0, f: localStore.f[cid] ?? 0,
			};
			const bounds = aabbFromTransformedRect(mat, computed.width[cid], computed.height[cid]);
			if (bounds.minX < minX) minX = bounds.minX;
			if (bounds.minY < minY) minY = bounds.minY;
			if (bounds.maxX > maxX) maxX = bounds.maxX;
			if (bounds.maxY > maxY) maxY = bounds.maxY;
			any = true;
		}

		if (!any) {
			computed.width[eid] = 0;
			computed.height[eid] = 0;
			return;
		}

		computed.width[eid] = Math.max(0, maxX - minX);
		computed.height[eid] = Math.max(0, maxY - minY);
		computed.originX[eid] = minX;
		computed.originY[eid] = minY;
	}
}

const adjusting = new WeakMap<World, Map<number, Entity[]>>();

/** Bottom first, as the transform system last found them. */
export function adjustingLayers(world: World, entity: Entity): readonly Entity[] {
	return adjusting.get(world)?.get(entity.id()) ?? [];
}

function adjustLayers(world: World, adjust: Entity): void {
	const computed = store(world, Computed);
	const localStore = store(world, LocalTransform);
	const aid = adjust.id();

	if (computed.visibility[aid] === 0 || adjust.has(Hidden)) return;

	let slot = adjust;
	let parent = getParentNode(slot);
	while (parent !== null && parent.has(Sequential)) {
		slot = parent;
		parent = getParentNode(slot);
	}
	if (parent === null) return;

	const siblings = parent.get(Cache)?.children;
	if (!siblings) return;
	// Layers stack: one over another acts on the clip under them all, so a
	// zoom and a shake can each keep a row of their own.
	let idx = siblings.indexOf(slot) - 1;
	while (idx >= 0 && siblings[idx]!.has(AdjustmentLayer)) idx--;
	if (idx < 0) return;

	const target = siblings[idx];
	if (target === undefined) return;

	const layers = adjusting.get(world);
	const acting = layers?.get(target.id());
	if (acting) acting.push(adjust);
	else layers?.set(target.id(), [adjust]);

	// adjust's own local matrix must be current; it is not visited by the walk
	// (adjustment layers are neither Geometry nor Group) and reads only
	// motion-resolved Computed values.
	computeLocalMatrix(world, adjust);

	const tid = target.id();
	const adjustLocal: Mat2D = {
		a: localStore.a[aid], b: localStore.b[aid], c: localStore.c[aid],
		d: localStore.d[aid], e: localStore.e[aid], f: localStore.f[aid],
	};
	const clipLocal: Mat2D = {
		a: localStore.a[tid], b: localStore.b[tid], c: localStore.c[tid],
		d: localStore.d[tid], e: localStore.e[tid], f: localStore.f[tid],
	};

	const composed = multiply2D(adjustLocal, clipLocal);
	localStore.a[tid] = composed.a;
	localStore.b[tid] = composed.b;
	localStore.c[tid] = composed.c;
	localStore.d[tid] = composed.d;
	localStore.e[tid] = composed.e;
	localStore.f[tid] = composed.f;

	const reworld = (entity: Entity, parentEntity: Entity | null) => {
		computeWorldTransform(world, entity, parentEntity);
		computeWorldBounds(world, entity);
		cullEntity(world, entity, parentEntity);

		for (const child of world.query(Or(Geometry, Group), ChildOf(entity))) {
			reworld(child, entity);
		}
	};

	reworld(target, parent);
}

/** Call once per frame before the render system. */
export function transformSystem(world: World): void {
	const walk = (entity: Entity, parentEntity: Entity | null) => {
		computeGroupBounds(world, entity);
		computeLocalMatrix(world, entity);
		computeWorldTransform(world, entity, parentEntity);
		computeWorldBounds(world, entity);
		cullEntity(world, entity, parentEntity);

		for (const child of world.query(Or(Geometry, Group), ChildOf(entity))) {
			walk(child, entity);
		}
	};

	for (const entity of world.query(Or(Geometry, Group), ChildOf(world.get(Root)!))) {
		walk(entity, null);
	}

	adjusting.set(world, new Map());
	// Bottom first, so stacked layers compose and filter in the order they sit.
	const layers = [...world.query(AdjustmentLayer)].sort((a, b) => stackIndex(a) - stackIndex(b));
	for (const adjust of layers) {
		adjustLayers(world, adjust);
	}
}

function stackIndex(adjust: Entity): number {
	let slot = adjust;
	let parent = getParentNode(slot);
	while (parent !== null && parent.has(Sequential)) {
		slot = parent;
		parent = getParentNode(slot);
	}
	return parent?.get(Cache)?.children?.indexOf(slot) ?? 0;
}
