/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { deriveThumbnail } from '@plan.video/assets';

import { rememberProjectCover } from '@/lib/db';

import { browserKeepCover, isBrowserProjectDir } from './browser';
import { markProjectsChanged } from './host';

const COVER_WIDTH = 640;

/** Anything larger is a full canvas shot. */
const isCardCover = (blob: Blob): boolean => blob.type === 'image/webp' && blob.size < 200_000;

const ready = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

const coverId = (dir: string, blob: Blob): string => `${dir}:${blob.size}:${blob.type}`;

export function cachedProjectCover(dir: string, blob: Blob): string | null {
	return ready.get(coverId(dir, blob)) ?? null;
}

/** The small copy replaces the full one on the record so the next visit skips decoding it; the list isn't told. */
export function loadProjectCover(dir: string, blob: Blob): Promise<string | null> {
	const id = coverId(dir, blob);
	const done = ready.get(id);
	if (done) return Promise.resolve(done);

	const inflight = pending.get(id);
	if (inflight) return inflight;

	const job = (async () => {
		try {
			let source = blob;
			if (!isCardCover(blob)) {
				source = await deriveThumbnail(blob, blob.type || 'image/png', COVER_WIDTH) ?? blob;
				if (source !== blob) await rememberProjectCover(dir, source);
			}
			const url = URL.createObjectURL(source);
			ready.set(id, url);
			return url;
		} catch (error) {
			console.warn('[projects] could not prepare the project cover', error);
			const url = URL.createObjectURL(blob);
			ready.set(id, url);
			return url;
		} finally {
			pending.delete(id);
		}
	})();

	pending.set(id, job);
	return job;
}

export async function warmProjectCovers(projects: { dir: string; cover: Blob | null }[]): Promise<void> {
	const queue = projects.filter((project): project is { dir: string; cover: Blob } => project.cover != null);
	let index = 0;

	const worker = async (): Promise<void> => {
		while (index < queue.length) {
			const project = queue[index++]!;
			await loadProjectCover(project.dir, project.cover);
		}
	};

	await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
}

/** Stored on the record, never read from the folder, which the dashboard must not touch at launch. */
export async function captureProjectCover(dir: string, snapshot: Promise<Blob | null>): Promise<void> {
	if (!dir) return;

	try {
		const blob = await snapshot;
		if (!blob) return;
		const thumb = isCardCover(blob) ? blob : await deriveThumbnail(blob, blob.type || 'image/png', COVER_WIDTH);
		await rememberProjectCover(dir, thumb ?? blob);
		markProjectsChanged();
		if (isBrowserProjectDir(dir)) await browserKeepCover(dir, thumb ?? blob);
	} catch (error) {
		console.warn('[projects] could not record the project cover', error);
	}
}
