/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetId, Library } from '@plan.video/runtime';
import { AssetLibrary, MANIFEST_FILE, ASSETS_DIR } from '@plan.video/assets';
import { useTrait, useWorld } from '@plan.video/koota-solid';
import { authoredElement } from '@plan.video/reconciler';
import { isAssetRef, mapAssetInputs } from '@plan.video/jsx';
import type { Accessor } from 'solid-js';

import { createBrowserProjectFS } from '@/projects/browser';
import { getDocumentEditor } from './editor';

import type { Asset } from '@plan.video/assets';
import type { AssetInput } from '@plan.video/jsx';
import type { World } from 'koota';

export function attachLibrary(world: World, dir: string) {
	const library = new AssetLibrary(createBrowserProjectFS(dir), {
		onRename: (asset, from) => followRename(world, asset, from),
		onRelink: (asset, from) => followRelink(world, asset, from),
	});

	world.set(Library, library);

	return library;
}

export function isLibraryFile(path: string): boolean {
	return path === MANIFEST_FILE || path === ASSETS_DIR || path.startsWith(`${ASSETS_DIR}/`);
}

// Also follows inputs inside declarations: an element showing `transform.upscale("old.png")` must follow the rename.
function followRename(world: World, asset: Asset, from: string): void {
	const editor = getDocumentEditor(world);
	const renamed = (input: AssetInput): AssetInput =>
		isAssetRef(input) ? mapAssetInputs(input, renamed) : input === from ? asset.path : input;

	for (const entity of world.query(AssetId)) {
		const src = authoredElement(entity)?.props.src;
		if (typeof src !== 'string' && !isAssetRef(src)) continue;
		const next = renamed(src);
		if (next !== src) editor.editProperty(entity, 'src', next);
	}
}

function followRelink(world: World, asset: Asset, from: string): void {
	for (const entity of world.query(AssetId)) {
		if (entity.get(AssetId)?.value === from) entity.set(AssetId, { value: asset.id });
	}
}

export function useLibrary(): Accessor<AssetLibrary | undefined> {
	const world = useWorld();
	const attached = useTrait(world, Library);
	return () => attached() ?? undefined;
}
