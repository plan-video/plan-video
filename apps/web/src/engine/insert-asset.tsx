/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { Audio, Captions, ImagePaint, Rect, VideoPaint } from '@plan.video/reconciler';
import { Computed, FrameRate, getActiveEntity, getNextName, isScene, Root, Source, store } from '@plan.video/runtime';
import { assetName } from '@plan.video/assets';

import { getDocumentEditor } from './editor';
import { isKillfeedPicture, killfeedPictureSize } from './killfeed-picture';

import type { Asset } from '@plan.video/assets';
import type { Entity, World } from 'koota';

export interface InsertAssetOptions {
	/** The scene (or group) to insert into; the active scene by default. */
	parent?: Entity;
	/** Top-left corner in the parent's space; centered by default. */
	x?: number;
	y?: number;
	/** The element's size; the asset's own by default. */
	width?: number;
	height?: number;
	/** Where on the timeline the clip starts, in seconds; the playhead by default. */
	start?: number;
}

/** The box an audio clip gets on the canvas: it has no size of its own. */
export const AUDIO_SIZE = { width: 500, height: 150 } as const;

/**
 * Inserts `asset` into the project as the element of its type and returns
 * the entity, or null when there is nothing to insert into (no project is
 * mounted, or the target has no source to be written under).
 */
export function insertAsset(world: World, asset: Asset, options: InsertAssetOptions = {}): Entity | null {
	const parent = options.parent ?? getActiveEntity(world) ?? world.get(Root)!;
	if (!parent.get(Source)?.value) return null;

	const editor = getDocumentEditor(world);
	const src = asset.path;
	const name = getNextName(world, assetName(asset).replace(/\.[^.]+$/, ''));
	const start = options.start ?? (store(world, Computed).localTimeInSeconds[parent.id()] ?? 0);

	const own = assetSize(world, parent, asset);
	const size = own && options.width !== undefined && options.height !== undefined
		? { width: Math.round(options.width), height: Math.round(options.height) }
		: own;
	const position = size ? placement(world, parent, size, options) : {};
	// A picture has no length of its own, so it is given one; footage and sound play out.
	const timing = asset.type === 'IMAGE' ? stillTiming(world, parent, start) : start > 0 ? { start } : {};

	const [entity] = editor.insertElement(parent, () => {
		switch (asset.type) {
			case 'VIDEO':
			case 'SEQUENCE':
				return (
					<Rect name={name} keepAspectRatio {...position} {...size} {...timing}>
						<VideoPaint src={src} />
					</Rect>
				);
			case 'IMAGE':
				return (
					<Rect name={name} keepAspectRatio {...position} {...size} {...timing}>
						<ImagePaint src={src} />
					</Rect>
				);
			case 'AUDIO':
				return <Audio name={name} src={src} {...position} {...size} {...timing} />;
			case 'TRANSCRIPT':
				return <Captions src={src} look="commentary" {...timing} />;
			default:
				return null;
		}
	});

	if (entity) editor.select(entity);
	return entity ?? null;
}

/** How long a still lasts when nothing in its scene plays on past where it starts. */
export const STILL_SECONDS = 5;

/**
 * When a still (text, a shape, a picture) added to `parent` shows: from
 * `start`, the playhead by default, to the end of what the scene already
 * plays, so adding one never makes the video longer. With less than a second
 * of the scene left, or nothing in it yet, it lasts STILL_SECONDS. Outside a
 * scene there is no timeline, and only the start is given.
 */
export function stillTiming(world: World, parent: Entity, start?: number): { start?: number; end?: number } {
	const computed = store(world, Computed);
	const from = Math.max(0, start ?? computed.localTimeInSeconds[parent.id()] ?? 0);
	const begin = from > 0 ? { start: seconds(from) } : {};
	if (!isScene(parent)) return begin;
	const fps = world.get(FrameRate)?.value ?? 30;
	const length = computed.empty[parent.id()] ? 0 : (computed.duration[parent.id()] ?? 0) / fps;
	return { ...begin, end: seconds(length - from >= 1 ? length : from + STILL_SECONDS) };
}

const seconds = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The size `asset` goes into `parent` at when none is asked for: its own,
 * except a killfeed picture, drawn bigger than it is shown so it stays sharp,
 * which comes in at the size its panel puts it.
 */
export function assetSize(world: World, parent: Entity, asset: Asset): { width: number; height: number } | undefined {
	if (asset.type === 'IMAGE' && isKillfeedPicture(asset)) {
		const computed = store(world, Computed);
		return killfeedPictureSize(asset, computed.width[parent.id()] ?? 1080, computed.height[parent.id()] ?? 1920);
	}
	switch (asset.type) {
		case 'VIDEO':
		case 'IMAGE':
		case 'SEQUENCE':
			return { width: Math.round(asset.width), height: Math.round(asset.height) };
		case 'AUDIO':
			return { ...AUDIO_SIZE };
		default:
			return undefined;
	}
}

/** Where a new element of `size` goes: as asked, or centered in its parent. */
function placement(
	world: World,
	parent: Entity,
	size: { width: number; height: number },
	options: InsertAssetOptions,
): { x?: number; y?: number } {
	if (options.x !== undefined && options.y !== undefined) {
		return { x: Math.round(options.x), y: Math.round(options.y) };
	}
	const bounds = store(world, Computed);
	const width = bounds.width[parent.id()] ?? size.width;
	const height = bounds.height[parent.id()] ?? size.height;
	return { x: Math.round((width - size.width) / 2), y: Math.round((height - size.height) / 2) };
}
