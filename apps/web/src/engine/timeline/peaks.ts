/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Library } from '@plan.video/runtime';
import { WAVEFORM_PEAKS_PER_SECOND, downsamplePeaks } from '@plan.video/assets';

import type { World } from 'koota';
import type { AssetCache, AudioAsset, VideoAsset } from '@plan.video/assets';

export const SAMPLE_WIDTH = 1;

// Cut this fraction of the visible stretch either side, so a scroll inside it reuses the last cut.
const WINDOW_MARGIN = 0.5;

export type ClipSamples = {
	start: number;
	end: number;
	peaksPerSecond: number;
	data: Uint8ClampedArray;
};

type AssetPeaks = {
	file: File | null;
	length: number;
	loading: boolean;
	loaded: boolean;
};

type Window = {
	from: number;
	to: number;
	visibleFrom: number;
	visibleTo: number;
	peaksPerSecond: number;
};

type ClipPeaks = {
	assetId: string;
	samples: ClipSamples | null;
	cut: Window | null;
	updating: boolean;
	pending: PeakRequest | null;
};

export type PeakRequest = {
	clip: number;
	asset: AudioAsset | VideoAsset;
	peaksPerSecond: number;
	start: number;
	end: number;
};

const assetPeaks = new Map<string, AssetPeaks>();
const clipPeaks = new Map<number, ClipPeaks>();

export function getClipSamples(clip: number): ClipSamples | null {
	return clipPeaks.get(clip)?.samples ?? null;
}

export function requestPeaks(world: World, request: PeakRequest): void {
	const cache = world.get(Library)?.cache;
	if (!cache) return;

	const record = assetPeaks.get(request.asset.id);

	if (!record || (!record.loading && !record.loaded)) {
		void loadAsset(cache, request);
	}

	if (record && record.length > 0) {
		void updateClip(request, record);
	}
}

// The peak buffer is shared between both halves; only the record of what is drawn is copied.
export function clonePeaksForSplit(clip: number, copy: number): void {
	const source = clipPeaks.get(clip);
	if (!source) return;

	clipPeaks.set(copy, {
		assetId: source.assetId,
		samples: source.samples && { ...source.samples },
		cut: source.cut && { ...source.cut },
		updating: false,
		pending: null,
	});
}

export function clearClipPeaks(clip?: number): void {
	if (clip === undefined) clipPeaks.clear();
	else clipPeaks.delete(clip);
}

export function clearPeaks(): void {
	clipPeaks.clear();
	assetPeaks.clear();
}

export function forgetAssetPeaks(assetId: string): void {
	assetPeaks.delete(assetId);
	for (const [clip, peaks] of clipPeaks) {
		if (peaks.assetId === assetId) clipPeaks.delete(clip);
	}
}

// Marked loaded either way: a file with no audio, or one that won't decode, isn't worth asking about every frame.
async function loadAsset(cache: AssetCache, request: PeakRequest): Promise<void> {
	const { asset } = request;

	const record = assetPeaks.get(asset.id) ?? { file: null, length: 0, loading: false, loaded: false };
	assetPeaks.set(asset.id, record);
	if (record.loading) return;

	record.loading = true;

	try {
		const file = await cache.waveform(asset);
		if (!file) return;

		record.file = file;
		record.length = file.size;
	} catch (error) {
		console.error('[timeline] could not load peaks', error);
	} finally {
		record.loading = false;
		record.loaded = true;
	}
}

// One read at a time per clip; a newer request replaces the queued one, so the work that runs is for where the timeline ended up.
async function updateClip(request: PeakRequest, record: AssetPeaks): Promise<void> {
	const peaks = clipPeaks.get(request.clip)
		?? { assetId: request.asset.id, samples: null, cut: null, updating: false, pending: null };
	clipPeaks.set(request.clip, peaks);

	if (peaks.updating) {
		peaks.pending = request;
		return;
	}

	try {
		const wanted = coveringWindow(request, record);
		if (!wanted || !needsCut(peaks.cut, wanted)) return;

		peaks.updating = true;
		peaks.cut = wanted;

		const data = await readPeaks(request.asset.id, record, wanted.from, wanted.to);
		if (!data) {
			peaks.cut = null;
			return;
		}

		const seconds = data.length / WAVEFORM_PEAKS_PER_SECOND;

		peaks.samples = {
			start: wanted.from / WAVEFORM_PEAKS_PER_SECOND,
			end: (wanted.from + data.length) / WAVEFORM_PEAKS_PER_SECOND,
			peaksPerSecond: request.peaksPerSecond,
			data: downsamplePeaks(data, Math.max(1, Math.round(seconds * request.peaksPerSecond))),
		};
	} catch (error) {
		console.error('[timeline] could not cut peaks', error);
		peaks.cut = null;
	} finally {
		peaks.updating = false;
	}

	const pending = peaks.pending;
	if (pending) {
		peaks.pending = null;
		void updateClip(pending, record);
	}
}

function coveringWindow(request: PeakRequest, record: AssetPeaks): Window | null {
	const peaksOf = (seconds: number): number => seconds * WAVEFORM_PEAKS_PER_SECOND;
	const clamp = (peak: number): number => Math.min(record.length, Math.max(0, peak));

	const visibleFrom = clamp(Math.floor(peaksOf(request.start)));
	const visibleTo = clamp(Math.ceil(peaksOf(request.end)));

	const margin = peaksOf(Math.max(0, request.end - request.start)) * WINDOW_MARGIN;
	const from = clamp(Math.floor(peaksOf(request.start) - margin));
	const to = clamp(Math.ceil(peaksOf(request.end) + margin));
	if (to <= from) return null;

	return { from, to, visibleFrom, visibleTo, peaksPerSecond: request.peaksPerSecond };
}

function needsCut(cut: Window | null, wanted: Window): boolean {
	if (!cut) return true;
	if (cut.peaksPerSecond !== wanted.peaksPerSecond) return true;

	return wanted.visibleFrom < cut.from || wanted.visibleTo > cut.to;
}

async function readPeaks(assetId: string, record: AssetPeaks, from: number, to: number): Promise<Uint8ClampedArray | null> {
	if (!record.file) return null;

	try {
		return new Uint8ClampedArray(await record.file.slice(from, to).arrayBuffer());
	} catch (error) {
		// The file went out from under us: forget it so the next frame finds it again or derives it afresh.
		console.warn('[timeline] could not read stored peaks', error);
		assetPeaks.delete(assetId);
		return null;
	}
}
