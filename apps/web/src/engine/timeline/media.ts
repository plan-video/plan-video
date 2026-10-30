/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CanvasSink } from 'mediabunny';
import { getAssetFile, getVideoTrack, secondsToFrames } from '@plan.video/runtime';

import { MAX_CLIP_HEIGHT } from './config';

import type { InputVideoTrack } from 'mediabunny';
import type { Asset, VideoAsset } from '@plan.video/assets';

export type Frame = {
	timestamp: number;
	canvas: OffscreenCanvas | HTMLCanvasElement;
	/** Superseded: kept on screen only until what replaces it has decoded. */
	stale?: boolean;
};

export type Still = {
	canvas: OffscreenCanvas;
	width: number;
	height: number;
	hash: string;
};

export type FrameRequest = {
	clip: number;
	asset: VideoAsset;
	/** Source frames per tile; may be fractional. */
	interval: number;
	/** Tile size in CSS pixels. */
	width: number;
	height: number;
	/** In source frames. */
	firstFrame: number;
	lastFrame: number;
	fps: number;
};

type AssetFrames = {
	frames: Frame[];
	decoding: boolean;
	/** Set even when decoding failed. */
	decoded: boolean;
};

type ClipFrames = {
	assetId: string;
	frames: Frame[];
	/** In source frames. */
	start: number;
	end: number;
	request: FrameRequest | null;
	pending: FrameRequest | null;
	decoding: boolean;
};

const SPREAD_COUNT = 7;
const LONG_SPREAD_COUNT = 10;

const LONG_DURATION = 60 * 10;

const TILE_MARGIN = 1;

const stills = new Map<string, Still>();
const stillsDecoding = new Set<string>();
const stillsFailed = new Set<string>();
const assetFrames = new Map<string, AssetFrames>();
const clipFrames = new Map<number, ClipFrames>();

/** Tile sizes come in three steps (see `../render/thumbnails`), so a row-height drag costs at most two decodes. */
export function resolveStill(asset: Asset, width: number): Still | null {
	const hash = `${width}@${window.devicePixelRatio}`;
	const existing = stills.get(asset.id);
	if (existing?.hash === hash) return existing;

	if (!stillsFailed.has(asset.id)) void decodeStill(asset, width, hash);

	return existing ?? null;
}

async function decodeStill(asset: Asset, width: number, hash: string): Promise<void> {
	if (stillsDecoding.has(asset.id)) return;
	stillsDecoding.add(asset.id);

	try {
		const bitmap = await createImageBitmap(await getAssetFile(asset));

		try {
			const dpr = window.devicePixelRatio;
			const scale = Math.min(1, Math.max((width * dpr) / bitmap.width, (MAX_CLIP_HEIGHT * dpr) / bitmap.height));
			const canvasWidth = Math.max(1, Math.round(bitmap.width * scale));
			const canvasHeight = Math.max(1, Math.round(bitmap.height * scale));

			const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
			canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);

			stills.set(asset.id, { canvas, width: canvasWidth, height: canvasHeight, hash });
		} finally {
			bitmap.close();
		}
	} catch (error) {
		console.error('[timeline] could not decode still', error);
		stillsFailed.add(asset.id);
	} finally {
		stillsDecoding.delete(asset.id);
	}
}

export function requestFrames(request: FrameRequest): void {
	const record = assetFrames.get(request.asset.id);

	if (!record || (!record.decoding && !record.decoded)) {
		void decodeSpread(request);
	}

	if (record && record.frames.length > 0) {
		void updateClip(request);
	}
}

export function pickFrame(clip: number, assetId: string, timestamp: number, interval: number): Frame | null {
	const cached = clipFrames.get(clip);
	const covered = cached !== undefined
		&& timestamp >= cached.start - interval
		&& timestamp <= cached.end + interval;

	const frames = (covered ? cached.frames : assetFrames.get(assetId)?.frames) ?? [];
	const index = closestFrame(frames, timestamp);

	return index < 0 ? null : frames[index]!;
}

/** The canvases are shared with the original; only the records are copied. */
export function cloneFramesForSplit(clip: number, copy: number): void {
	const source = clipFrames.get(clip);
	if (!source) return;

	clipFrames.set(copy, {
		...source,
		frames: source.frames.map((frame) => ({ ...frame })),
		pending: null,
		decoding: false,
	});
}

export function clearClipFrames(clip?: number): void {
	if (clip === undefined) clipFrames.clear();
	else clipFrames.delete(clip);
}

export function clearMedia(): void {
	clipFrames.clear();
	assetFrames.clear();
	stills.clear();
	stillsFailed.clear();
}

export function forgetAssetMedia(assetId: string): void {
	stills.delete(assetId);
	stillsFailed.delete(assetId);
	assetFrames.delete(assetId);
	for (const [clip, frames] of clipFrames) {
		if (frames.assetId === assetId) clipFrames.delete(clip);
	}
}

async function decodeSpread(request: FrameRequest): Promise<void> {
	const { asset } = request;

	const record = assetFrames.get(asset.id) ?? { frames: [], decoding: false, decoded: false };
	assetFrames.set(asset.id, record);
	if (record.decoding) return;

	record.decoding = true;

	try {
		const track = await getVideoTrack(asset);
		if (!track) return;

		const first = await track.getFirstTimestamp();
		const last = await track.computeDuration();
		const count = asset.duration < LONG_DURATION ? SPREAD_COUNT : LONG_SPREAD_COUNT;
		const sink = createSink(track, request);

		for (let i = 0; i < count; i++) {
			try {
				const wrapped = await sink.getCanvas(first + (i * (last - first)) / count);
				if (!wrapped) continue;

				record.frames.push({
					timestamp: secondsToFrames(wrapped.timestamp, request.fps),
					canvas: wrapped.canvas,
				});
			} catch {
				// One bad frame should not lose the whole spread.
			}
		}
	} catch (error) {
		console.error('[timeline] could not decode thumbnails', error);
	} finally {
		record.decoding = false;
		record.decoded = true;
	}
}

/** One decode runs at a time per clip; a newer request replaces whatever was queued. */
async function updateClip(request: FrameRequest): Promise<void> {
	const cached = clipFrames.get(request.clip) ?? {
		assetId: request.asset.id,
		frames: [],
		start: -1,
		end: -1,
		request: null,
		pending: null,
		decoding: false,
	};
	clipFrames.set(request.clip, cached);

	if (cached.decoding) {
		cached.pending = request;
		return;
	}

	try {
		cached.decoding = true;

		if (rangeHash(cached.request) === rangeHash(request)) return;

		const wanted = tileRange(request);
		const resized = sizeHash(cached.request) !== sizeHash(request);
		const rescaled = cached.request?.interval !== request.interval;
		const overlaps = wanted.start < cached.end && cached.start < wanted.end;

		let from = 0;
		let to = 0;

		if (rescaled || resized || !overlaps) {
			from = wanted.firstIndex;
			to = wanted.lastIndex;
			for (const frame of cached.frames) frame.stale = true;
		} else if (wanted.start < cached.start) {
			from = wanted.firstIndex;
			to = Math.floor(cached.start / request.interval);
		} else if (wanted.end > cached.end) {
			from = Math.floor(cached.end / request.interval);
			to = wanted.lastIndex;
		}

		for (const frame of cached.frames) {
			if (frame.timestamp > wanted.end || frame.timestamp < wanted.start) frame.stale = true;
		}

		const count = to - from;

		if (count <= 0) {
			cached.frames = keep(cached.frames);
			cached.start = wanted.start;
			cached.end = wanted.end;
			cached.request = request;
			return;
		}

		const track = await getVideoTrack(request.asset);
		if (!track) return;

		const sink = createSink(track, request);

		for (let i = 0; i < count; i++) {
			try {
				const wrapped = await sink.getCanvas(((from + i) * request.interval) / request.fps);
				if (!wrapped) continue;

				// The decoder may snap to a keyframe, so file it under the timestamp it returned.
				const timestamp = secondsToFrames(wrapped.timestamp, request.fps);

				// Drop superseded frames only now so the strip is never blank.
				cached.frames = keep(cached.frames, timestamp);
				cached.frames.push({ timestamp, canvas: wrapped.canvas, stale: false });
			} catch {
				// One bad tile should not lose the whole strip.
			}
		}

		cached.frames = keep(cached.frames);
		cached.start = wanted.start;
		cached.end = wanted.end;
		cached.request = request;
	} catch (error) {
		console.error('[timeline] could not update thumbnails', error);
	} finally {
		cached.decoding = false;
	}

	const pending = cached.pending;
	if (pending) {
		cached.pending = null;
		void updateClip(pending);
	}
}

function tileRange(request: FrameRequest) {
	const { firstFrame, lastFrame, interval, asset } = request;

	const lastTile = Math.floor(secondsToFrames(asset.duration, request.fps) / interval);
	const firstIndex = Math.max(Math.floor(firstFrame / interval) - TILE_MARGIN, 0);
	const lastIndex = Math.min(Math.floor(lastFrame / interval) + TILE_MARGIN, lastTile);

	return { firstIndex, lastIndex, start: firstIndex * interval, end: lastIndex * interval };
}

function createSink(track: InputVideoTrack, request: FrameRequest): CanvasSink {
	const dpr = window.devicePixelRatio;
	return new CanvasSink(track, { width: request.width * dpr, height: request.height * dpr, fit: 'cover' });
}

function keep(frames: Frame[], upTo?: number): Frame[] {
	return frames
		.filter((frame) => !frame.stale || (upTo !== undefined && frame.timestamp > upTo))
		.sort((a, b) => a.timestamp - b.timestamp);
}

function rangeHash(request: FrameRequest | null): string {
	if (!request) return '';
	return `${sizeHash(request)}-${request.interval}-${request.firstFrame}-${request.lastFrame}`;
}

function sizeHash(request: FrameRequest | null): string {
	if (!request) return '';
	return `${request.width}x${request.height}@${window.devicePixelRatio}`;
}

function closestFrame(frames: Frame[], timestamp: number): number {
	if (frames.length === 0) return -1;

	let low = 0;
	let high = frames.length - 1;
	let closest = -1;
	let distance = Infinity;

	while (low <= high) {
		const mid = (low + (high - low + 1) / 2) | 0;
		const value = frames[mid]!.timestamp;
		const delta = Math.abs(value - timestamp);

		if (delta < distance) {
			distance = delta;
			closest = mid;
		}

		if (value < timestamp) low = mid + 1;
		else if (value > timestamp) high = mid - 1;
		else return mid;
	}

	return closest;
}
