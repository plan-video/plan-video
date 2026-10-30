/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Scene as SceneElement, SolidPaint } from '@plan.video/reconciler';
import { focusRect, getCameraMatrix, getNextName, Root, Source } from '@plan.video/runtime';

import { t } from '@/lib/i18n';

import { getDocumentEditor } from './editor';
import { AUDIO_SIZE, insertAsset } from './insert-asset';

import type { Asset } from '@plan.video/assets';
import type { Rect } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

export interface Size {
	width: number;
	height: number;
}

export const DEFAULT_SCENE_FORMAT: Size = { width: 1920, height: 1080 };

export function sceneFrame(format: Size): Rect {
	return {
		x: Math.round(-format.width / 2),
		y: Math.round(-format.height / 2),
		width: format.width,
		height: format.height,
	};
}

export interface NewSceneOptions {
	name?: string;
	format?: Size;
	focus?: (rect: Rect) => void;
	/** Seconds; the playhead by default. */
	start?: number;
}

export function createScene(world: World, format: Size, options: NewSceneOptions = {}): Entity | null {
	const root = world.get(Root)!;
	if (!root.get(Source)?.value) return null;

	const editor = getDocumentEditor(world);
	const rect = sceneFrame(format);
	const name = options.name ?? getNextName(world, t('Scene'));

	// The camera moves first, so the scene is in view the moment it exists.
	(options.focus ?? ((target: Rect) => focusRect(world, target)))(rect);
	editor.reportEdit(root, 'camera', getCameraMatrix(world));

	const [scene] = editor.insertElement(root, () => (
		<SceneElement name={name} x={rect.x} y={rect.y} width={rect.width} height={rect.height}>
			<SolidPaint color="#000000" />
		</SceneElement>
	));
	if (!scene) return null;

	editor.activate(scene);
	return scene;
}

export function insertAssetsInNewScene(
	world: World,
	assets: ReadonlyArray<Asset>,
	options: NewSceneOptions = {},
): Entity | null {
	const sized = assets.findLast(hasSize);
	const format = sized ? sizeOf(sized) : options.format ?? DEFAULT_SCENE_FORMAT;

	const scene = createScene(world, format, options);
	if (!scene) return null;

	const inserted: Entity[] = [];
	for (const asset of assets) {
		const size = hasSize(asset) ? sizeOf(asset) : AUDIO_SIZE;
		const entity = insertAsset(world, asset, {
			parent: scene,
			// The scene is new, so its computed bounds are not there to center
			// against yet: the format is what it will measure.
			x: (format.width - size.width) / 2,
			y: (format.height - size.height) / 2,
			start: options.start,
		});
		if (entity) inserted.push(entity);
	}

	getDocumentEditor(world).select(inserted.length ? inserted : scene);
	return scene;
}

export const hasSize = (asset: Asset): asset is Extract<Asset, Size> => 'width' in asset && 'height' in asset;

export const sizeOf = (asset: Extract<Asset, Size>): Size => ({
	width: Math.round(asset.width),
	height: Math.round(asset.height),
});
