/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { deriveThumbnail } from '@plan.video/assets';

import { rememberProjectCover } from '@/lib/db';

import { browserKeepCover, isBrowserProjectDir } from './browser';
import { markProjectsChanged } from './host';

/** Wide enough for a project card on a retina screen, and no wider. */
const COVER_WIDTH = 640;

/** A cover already stored at card size. Anything larger is a full canvas shot. */
const isCardCover = (blob: Blob): boolean => blob.type === 'image/webp' && blob.size < 200_000;

const ready = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

const coverId = (dir: string, blob: Blob): string => `${dir}:${blob.size}:${blob.type}`;

/** The card-sized cover, when it has already been prepared this session. */
export function cachedProjectCover(dir: string, blob: Blob): string | null {
	return ready.get(coverId(dir, blob)) ?? null;
}

/**
 * A card-sized object URL for `blob`. A full-size cover is scaled down off
 * the main thread and the small copy replaces it on the record, so the next
 * visit does not decode the canvas shot again. The list is not told: the
 * card already on screen keeps showing this URL.
 */
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

/** Prepares the covers that will be on screen, a few at a time. */
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

/**
 * Takes the cover of the project in `dir` from `snapshot` and puts it on the
 * project's record (see `ProjectRecord.cover`), where the dashboard reads it
 * from with the rest of the record — never from the folder, which it must
 * not touch at launch. Call it as the project closes, with the snapshot
 * already under way; the list is told once the cover has landed, so a card
 * for a project still closing picks it up.
 */
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
