/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Everything that changes the asset set goes through the AssetLibrary (@plan.video/assets).

import { Ai, AssetId, Library, Paint, SourceFrameRate } from '../traits';
import { PaintType } from '../constants';

import type { Entity, World } from 'koota';
import type { Asset, AssetLibrary, SequenceAsset } from '@plan.video/assets';
import type { GenAi } from '../ai';

/** The world's asset library; throws when the host attached none. */
export function getLibrary(world: World): AssetLibrary {
	const library = world.get(Library);
	if (!library) throw new Error('This world has no asset library');
	return library;
}

/** The world's generation service; throws when the host attached none. */
export function getAi(world: World): GenAi {
	const ai = world.get(Ai);
	if (!ai) throw new Error('This world cannot generate assets (no Ai attached)');
	return ai;
}

/** A frames directory paints as a video; re-decided on every bind so a different kind of source still shows. Non-media paints (gradient, shader) are left alone. */
export function bindAsset(entity: Entity, asset: Asset): void {
	entity.add(AssetId);
	entity.set(AssetId, { value: asset.id });

	const paint = entity.get(Paint)?.value;
	if (paint !== PaintType.IMAGE && paint !== PaintType.VIDEO) return;

	const wanted = asset.type === 'IMAGE' ? PaintType.IMAGE
		: asset.type === 'VIDEO' || asset.type === 'SEQUENCE' ? PaintType.VIDEO
		// Audio and transcripts have nothing to draw; leave the paint as authored.
		: paint;

	if (wanted !== paint) entity.set(Paint, { value: wanted });
}

/** `ignoreAuthored` reads the element's own rate as absent, for a handler of its removal. */
export function getSequenceFrameRate(entity: Entity, asset: SequenceAsset, ignoreAuthored = false): number {
	const authored = ignoreAuthored ? 0 : entity.get(SourceFrameRate)?.value ?? 0;
	return authored > 0 ? authored : asset.frameRate;
}

/** Null when the asset has no duration; only a sequence's depends on the entity, whose rate is the element's to set. */
export function getSourceDuration(entity: Entity, asset: Asset, ignoreAuthoredRate = false): number | null {
	if (asset.type === 'SEQUENCE') {
		const frames = asset.duration * asset.frameRate;
		return frames / getSequenceFrameRate(entity, asset, ignoreAuthoredRate);
	}

	if (asset.type === 'AUDIO' || asset.type === 'VIDEO') return asset.duration;
	return null;
}

export function getAsset(world: World, idOrPath: string): Asset | undefined {
	return world.get(Library)?.get(idOrPath);
}

const assetFileCache = new WeakMap<Asset['handle'], Promise<File>>();

/** Reuses an in-flight or already-resolved read for the same handle. */
export function getAssetFile(asset: Pick<Asset, 'handle'>): Promise<File> {
	const { handle } = asset;
	const cached = assetFileCache.get(handle);
	if (cached) return cached;

	const promise = handle.getFile();
	assetFileCache.set(handle, promise);
	promise.catch(() => {
		if (assetFileCache.get(handle) === promise) {
			assetFileCache.delete(handle);
		}
	});
	return promise;
}

/**
 * Drops the cached read of an asset's file. Call it after writing over the
 * file: the cached File is a snapshot, and reading one whose file changed
 * underneath it fails.
 */
export function forgetAssetFile(asset: Pick<Asset, 'handle'>): void {
	assetFileCache.delete(asset.handle);
}

export async function getAssetBlob(world: World, id: string): Promise<Blob | null> {
	const asset = getAsset(world, id);
	if (!asset) return null;

	return await getAssetFile(asset);
}
