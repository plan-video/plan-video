/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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

export type FittableAsset = Extract<Asset, Size>;

export const isFittable = (asset: Asset | null | undefined): asset is FittableAsset =>
	!!asset && (asset.type === 'VIDEO' || asset.type === 'IMAGE' || asset.type === 'SEQUENCE') && 'width' in asset && asset.width > 0 && asset.height > 0
	// A killfeed entry goes over the footage, never in its place.
	&& !isKillfeedPicture(asset);

/** Below this, cover beats contain: bars a sliver thin (1920×1080 in 1920×1088) read as a mistake. */
const NEAR_SAME_SHAPE = 1.04;

/**
 * Another shape is shown whole rather than cropped, since what a crop would
 * cut is anyone's guess. A small picture (under half the scene each way)
 * keeps its own size: blown up it would only blur.
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

export function isEmptyScene(world: World, scene: Entity): boolean {
	return !!store(world, Computed).empty[scene.id()];
}

export function sceneSize(world: World, scene: Entity): Size {
	const computed = store(world, Computed);
	return { width: computed.width[scene.id()] ?? 0, height: computed.height[scene.id()] ?? 0 };
}

/** A drag says what it carries only on the drop, so the panel sets this at the start for the canvas to outline the landing spot. */
export const [draggedAsset, setDraggedAsset] = createSignal<Asset | null>(null);

export interface SceneDropTarget {
	scene: Entity;
	bounds: Rect;
	/** The space `fit` is in. */
	size: Size;
	fit: Rect | null;
}

const [dropTarget, setDropTargetSignal] = createSignal<SceneDropTarget | null>(null);
export { dropTarget };

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
