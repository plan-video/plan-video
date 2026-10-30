/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Nothing here talks to the user: a failure is thrown or returned for the host to report.

import { assetName } from './types';

import type { AssetLibrary, ImportResult } from './library';
import type { Asset } from './types';

/** Opens the file picker; resolves to what was picked ([] on cancel). */
export function pickFiles(options: { multiple?: boolean; accept?: string } = {}): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = options.multiple ?? true;
		input.accept = options.accept ?? 'image/*,video/*,audio/*,text/*,application/json';
		input.onchange = () => resolve(Array.from(input.files ?? []));
		input.oncancel = () => resolve([]);
		input.click();
	});
}

export function droppedFiles(event: DragEvent): File[] {
	return Array.from(event.dataTransfer?.items ?? [])
		.filter((item) => item.kind === 'file')
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}

export interface ImportReport extends ImportResult {
	unnamed: File[];
}

/** A file the host can place on disk is linked; a browser upload has no path, so its bytes are copied into the project. */
export async function importFiles(library: AssetLibrary, files: ReadonlyArray<File>, folder: string): Promise<ImportReport> {
	const unnamed: File[] = [];
	const paths: string[] = [];
	const stored: ImportResult['assets'] = [];
	const failed: ImportResult['failed'] = [];

	for (const file of files) {
		const path = library.fs.pathOf?.(file) ?? null;
		if (path) {
			paths.push(path);
			continue;
		}
		// A browser file picker hands over bytes, not a location on disk.
		if (!file.name) {
			unnamed.push(file);
			continue;
		}
		try {
			stored.push(await library.store(file, { folder, name: file.name }));
		} catch (error) {
			failed.push({ source: file.name, error: error instanceof Error ? error : new Error(String(error)) });
		}
	}

	const linked = await library.import(paths, { folder });
	return {
		assets: [...linked.assets, ...stored],
		failed: [...linked.failed, ...failed],
		unnamed,
	};
}

/**
 * Asks where to save a copy of an asset's file and writes it there. Resolves
 * to false when the dialog was cancelled; throws when the write failed.
 */
export async function saveAssetAs(asset: Pick<Asset, 'handle' | 'mimeType' | 'path'>): Promise<boolean> {
	const suggestedName = assetName(asset);
	const extension = suggestedName.match(/\.[^.]+$/)?.[0];

	let target: FileSystemFileHandle;
	try {
		target = await window.showSaveFilePicker({
			suggestedName,
			...(extension && asset.mimeType.includes('/')
				? { types: [{ description: asset.mimeType, accept: { [asset.mimeType]: [extension] } as Record<`${string}/${string}`, `.${string}`[]> }] }
				: {}),
		});
	} catch (error) {
		if ((error as Error).name === 'AbortError') return false;
		throw error;
	}

	const file = await asset.handle.getFile();
	const writable = await target.createWritable();
	try {
		await file.stream().pipeTo(writable);
	} catch (error) {
		await writable.abort().catch(() => {});
		throw error;
	}
	return true;
}
