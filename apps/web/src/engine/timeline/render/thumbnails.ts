/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed,
	getSourceWindow,
	readSpeedCurve,
	sourceFrameAtOffset,
	store,
	timelineOffsetAtSource,
} from '@plan.video/runtime';

import { CLIP_BREAKPOINTS, CLIP_LABEL_HEIGHT } from '../config';
import { pickFrame, requestFrames, resolveStill } from '../media';
import { framesToPixels, getFrameRate, getResolution, getViewport, pixelsToFrames } from '../view';
import { renderWaveform } from './waveform';

import type { Asset, VideoAsset } from '@plan.video/assets';
import type { Entity, World } from 'koota';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/** Fixed sizes rather than derived from the height, so resizing a row does not slide every tile along. */
const STILL_WIDTHS = [80, 100, 120] as const;

const STILL_TOP = 18;
const STILL_MASK_TOP = 20;

const MIN_STRIP_HEIGHT = 42;

const SMALL_TILE = { width: 56, height: 46 } as const;
const LARGE_TILE = { width: 84, height: 52 } as const;
const LARGE_TILE_STRIP_HEIGHT = 44;

export function renderStillThumbnails(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset,
	row: RowCursor,
): void {
	const ctx = surface.ctx!;

	// createImageBitmap does not take SVGs on every browser, so they get no strip.
	if (asset.mimeType === 'image/svg+xml') return;

	if (row.height <= CLIP_BREAKPOINTS.sm) return;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	const tileWidth = stillWidth(row.height);
	const still = resolveStill(asset, tileWidth);
	if (!still) return;

	const maskHeight = row.height - CLIP_LABEL_HEIGHT;

	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const tiles = Math.ceil(clipWidth / tileWidth);
	const first = Math.max(0, Math.floor((viewportLeft - clipLeft) / tileWidth));
	const last = Math.min(tiles - 1, Math.floor((viewportRight - clipLeft) / tileWidth));

	const crop = coverCrop(still.width, still.height, tileWidth, maskHeight);

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(clipLeft + 2, STILL_MASK_TOP, clipWidth - 4, maskHeight - 2, 2);
	ctx.clip();

	for (let i = first; i <= last; i++) {
		ctx.drawImage(
			still.canvas,
			crop.x, crop.y, crop.width, crop.height,
			clipLeft + i * tileWidth, STILL_TOP, tileWidth, maskHeight,
		);
	}

	ctx.restore();
}

/**
 * Tiles are placed in source time from the clip's origin, so trimming an end
 * slides the footage under the clip instead of re-cutting the tiles.
 */
export function renderVideoThumbnails(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: VideoAsset,
	row: RowCursor,
	color: string,
): void {
	const ctx = surface.ctx!;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	const layout = videoLayout(row.height);

	renderWaveform(world, scene, surface, entity, row, {
		asset,
		color,
		offsetY: layout.waveformOffsetY,
		padding: 0,
	});

	if (layout.stripHeight === 0) return;

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	ctx.save();

	ctx.beginPath();
	ctx.roundRect(clipLeft + 2, CLIP_LABEL_HEIGHT, clipWidth - 4, layout.stripHeight, 2);
	ctx.clip();

	const playbackRate = computed.playbackRate[eid] || 1;
	const origin = computed.origin[eid] ?? 0;
	const curve = readSpeedCurve(entity);

	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);

	// Intersect in frames, not pixels: `framesToPixels` floors and
	// `pixelsToFrames` rounds, which can shave a frame off the last tile.
	const source = getSourceWindow(entity);
	const viewIn = pixelsToFrames(viewportLeft, resolution) - origin;
	const viewOut = pixelsToFrames(viewportRight, resolution) - origin;
	const firstFrame = Math.max(
		source.in,
		curve.keys.length > 0 ? sourceFrameAtOffset(curve, viewIn) : viewIn * playbackRate,
	);
	const lastFrame = Math.min(
		source.out,
		curve.keys.length > 0 ? sourceFrameAtOffset(curve, viewOut) : viewOut * playbackRate,
	);

	// Kept as a float: at high zoom this is sub-frame, and rounding it to 0
	// collapses the decode range.
	const timelineSpan = curve.keys.length > 0
		? Math.max(1, timelineOffsetAtSource(curve, lastFrame) - timelineOffsetAtSource(curve, firstFrame))
		: 0;
	const averageRate = curve.keys.length > 0
		? Math.max(lastFrame - firstFrame, 1) / timelineSpan
		: playbackRate;
	const interval = (layout.tile.width / resolution) * averageRate;

	requestFrames({
		clip: eid,
		asset,
		fps,
		firstFrame,
		lastFrame,
		width: layout.tile.width,
		height: layout.tile.height,
		interval,
	});

	if (curve.keys.length > 0) {
		for (let i = Math.floor(firstFrame / interval); i <= Math.floor(lastFrame / interval); i++) {
			const sourceFrame = i * interval;
			const frame = pickFrame(eid, asset.id, sourceFrame, interval);
			if (!frame) continue;

			const x0 = framesToPixels(origin + timelineOffsetAtSource(curve, sourceFrame), resolution);
			const x1 = framesToPixels(origin + timelineOffsetAtSource(curve, sourceFrame + interval), resolution);
			ctx.drawImage(frame.canvas, x0, layout.tileTop, Math.max(1, x1 - x0), layout.tile.height);
		}
	} else {
		// Tile indices are in source time, matching the frames the decoder filed
		// under source timestamps.
		ctx.translate(framesToPixels(origin, resolution), 0);

		for (let i = Math.floor(firstFrame / interval); i <= Math.floor(lastFrame / interval); i++) {
			const frame = pickFrame(eid, asset.id, i * interval, interval);
			if (!frame) continue;

			ctx.drawImage(frame.canvas, i * layout.tile.width, layout.tileTop, layout.tile.width, layout.tile.height);
		}
	}

	ctx.restore();
}

function videoLayout(rowHeight: number) {
	const body = rowHeight - CLIP_LABEL_HEIGHT;
	const stripHeight = body > MIN_STRIP_HEIGHT ? body * 0.5 : 0;
	const tile = stripHeight > LARGE_TILE_STRIP_HEIGHT ? LARGE_TILE : SMALL_TILE;

	return {
		stripHeight,
		tile,
		tileTop: CLIP_LABEL_HEIGHT + (stripHeight - tile.height),
		waveformOffsetY: rowHeight > CLIP_BREAKPOINTS.sm ? stripHeight + CLIP_LABEL_HEIGHT : 2,
	};
}

function stillWidth(rowHeight: number): number {
	if (rowHeight >= 100) return STILL_WIDTHS[2];
	if (rowHeight >= 70) return STILL_WIDTHS[1];
	return STILL_WIDTHS[0];
}

function coverCrop(sourceWidth: number, sourceHeight: number, width: number, height: number) {
	const source = sourceWidth / sourceHeight;
	const target = width / height;

	if (source > target) {
		const cropped = sourceHeight * target;
		return { x: (sourceWidth - cropped) / 2, y: 0, width: cropped, height: sourceHeight };
	}

	const cropped = sourceWidth / target;
	return { x: 0, y: (sourceHeight - cropped) / 2, width: sourceWidth, height: cropped };
}
