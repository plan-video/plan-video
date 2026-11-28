/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { AssetCache, THUMBNAIL, WAVEFORM } from './cache';

import type { ProjectFS } from './fs';

function project() {
	const files = new Map<string, Blob>();
	const fs = {
		list: async () => [],
		stat: async (path: string) => (files.has(path) ? { size: files.get(path)!.size, mtime: 0 } : null),
		file: async (path: string) => new File([files.get(path)!], path),
		write: async (path: string, data: Blob) => void files.set(path, data),
		remove: async (path: string) => void files.delete(path),
	} as unknown as ProjectFS;
	return { cache: new AssetCache(fs), files };
}

const thumbnail = async () => new Blob(['picture']);

describe('the asset cache', () => {
	it("writes a library asset's entries into the project", async () => {
		const { cache, files } = project();
		await cache.get(THUMBNAIL, { id: 'owned' }, thumbnail);
		expect([...files.keys()]).toEqual(['cache/thumbnails/owned.webp']);
	});

	it("keeps a transient asset's entries out of the project", async () => {
		const { cache, files } = project();
		const asset = { id: 'linked', transient: true };
		await expect(cache.get(THUMBNAIL, asset, thumbnail)).resolves.toBeInstanceOf(Blob);
		const waveform = await cache.ensure(WAVEFORM, asset, async () => new Uint8ClampedArray([1, 2, 3]));
		expect(waveform?.size).toBe(3);
		expect(files.size).toBe(0);
	});

	it("derives a transient asset's entry once", async () => {
		const { cache } = project();
		let derived = 0;
		const asset = { id: 'linked', transient: true };
		const produce = async () => {
			derived++;
			return new Blob(['picture']);
		};
		await Promise.all([cache.get(THUMBNAIL, asset, produce), cache.get(THUMBNAIL, asset, produce)]);
		await cache.get(THUMBNAIL, asset, produce);
		expect(derived).toBe(1);
	});
});
