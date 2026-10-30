/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A clip dropped on an empty scene is the scene's main picture, so it is
// fitted to the scene rather than left at its own size wherever the pointer
// let go. While the drag is over such a scene the canvas lights it up and
// outlines where the clip will land (SceneDropOverlay); on the drop the clip
// is put straight there.

import { createSignal } from 'solid-js';
import { Computed, getEntityBounds, store } from '@plan.video/runtime';

import { isKillfeedPicture } from './killfeed-picture';


import type { Asset } from '@plan.video/assets';
import type { Rect } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

interface Size {
	width: number;
	height: number;
}

/** A visual asset: the kind a scene can be fitted around. */
export type FittableAsset = Extract<Asset, Size>;

export const isFittable = (asset: Asset | null | undefined): asset is FittableAsset =>
	!!asset && (asset.type === 'VIDEO' || asset.type === 'IMAGE' || asset.type === 'SEQUENCE') && 'width' in asset && asset.width > 0 && asset.height > 0
	// A killfeed entry goes over the footage, never in its place.
	&& !isKillfeedPicture(asset);

/**
 * How much bigger "cover" may be than "contain" and still fill the scene.
 * Below it the two shapes differ by a sliver (1920×1080 in 1920×1088): bars
 * that thin read as a mistake, while the few pixels cut off are never missed.
 */
const NEAR_SAME_SHAPE = 1.04;

/**
 * Where `asset` goes in a scene of `scene`, in the scene's own space: as big
 * as fits whole, centered. A clip of the scene's shape fills it; one of
 * another shape (landscape footage in a vertical scene) is shown whole with
 * the scene's background above and below rather than cropped, since what a
 * crop would cut is anyone's guess. A small picture (a logo, a sticker,
 * under half the scene each way) keeps its own size: blown up to fill the
 * frame it would only blur.
 */
export function fitInScene(scene: Size, asset: FittableAsset): Rect {
	const contain = Math.min(scene.width / asset.width, scene.height / asset.height);
	const cover = Math.max(scene.width / asset.width, scene.height / asset.height);
	let scale = cover / contain <= NEAR_SAME_SHAPE ? cover : contain;
	if (asset.type === 'IMAGE' && asset.width <= scene.width / 2 && asset.height <= scene.height / 2) scale = 1;

	const width = Math.round(asset.width * scale);
	const height = Math.round(asset.height * scale);
	return {
		x: Math.round((scene.width - width) / 2),
		y: Math.round((scene.height - height) / 2),
		width,
		height,
	};
}

/** A scene with nothing timed in it yet: the one a drop fits its clip to. */
export function isEmptyScene(world: World, scene: Entity): boolean {
	return !!store(world, Computed).empty[scene.id()];
}

export function sceneSize(world: World, scene: Entity): Size {
	const computed = store(world, Computed);
	return { width: computed.width[scene.id()] ?? 0, height: computed.height[scene.id()] ?? 0 };
}

/**
 * The library asset being dragged right now, if any. A drag says what it
 * carries only on the drop, so the panel tells the canvas at the start,
 * which is what lets the canvas outline the landing spot while hovering.
 */
export const [draggedAsset, setDraggedAsset] = createSignal<Asset | null>(null);

export interface SceneDropTarget {
	scene: Entity;
	/** The scene in document space, taken when the drag reached it. */
	bounds: Rect;
	/** The scene's own size, which `fit` is in. */
	size: Size;
	/** Where the clip will land in the scene, when the drag says what it is. */
	fit: Rect | null;
}

const [dropTarget, setDropTargetSignal] = createSignal<SceneDropTarget | null>(null);
export { dropTarget };

/**
 * Lights `scene` up for the drag over it, or puts the light out with null.
 */
export function setDropScene(world: World, scene: Entity | null, asset: Asset | null): void {
	if (!scene) {
		if (dropTarget()) setDropTargetSignal(null);
		return;
	}

	const current = dropTarget();
	const fittable = isFittable(asset) ? asset : null;
	if (current?.scene === scene && (current.fit !== null) === (fittable !== null)) return;

	const bounds = getEntityBounds(world, [scene]);
	if (!bounds) return;
	const size = sceneSize(world, scene);
	setDropTargetSignal({ scene, bounds, size, fit: fittable ? fitInScene(size, fittable) : null });
}
