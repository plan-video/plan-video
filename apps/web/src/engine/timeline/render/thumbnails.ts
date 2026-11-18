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

import { pickFrame, requestFrames, resolveStill } from '../media';
import { framesToPixels, getFrameRate, getResolution, getViewport, pixelsToFrames } from '../view';
import { renderWaveform } from './waveform';

import type { Asset, VideoAsset } from '@plan.video/assets';
import type { Entity, World } from 'koota';
import type { RowBody } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/** Tiles come in a few fixed sizes, so dragging a row taller re-decodes its pictures twice at most and never slides them along. */
const TILE_STEPS = [
	{ upTo: 42, height: 36 },
	{ upTo: 66, height: 56 },
	{ upTo: Infinity, height: 84 },
] as const;

/** Never narrower than 4:3, or an upright video would need a decode every few pixels. */
const NARROWEST_TILE = 4 / 3;
const WIDEST_TILE = 16 / 9;

/** A video with sound shows it along its lower edge, on a band the pictures still show through. */
const MIN_HEIGHT_WITH_WAVEFORM = 30;
const WAVEFORM_SHARE = 1 / 3;
const MAX_WAVEFORM_HEIGHT = 30;
const WAVEFORM_BAND_ALPHA = 0.74;

/** Returns whether pictures were drawn, so the caller knows what its label sits on. */
export function renderStillThumbnails(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset,
	body: RowBody,
): boolean {
	const ctx = surface.ctx!;

	// createImageBitmap does not take SVGs on every browser, so they get no strip.
	if (asset.mimeType === 'image/svg+xml') return false;

	const tile = tileFor(body.height, 'width' in asset ? asset.width / asset.height : WIDEST_TILE);
	const still = resolveStill(asset, tile.width);
	if (!still) return false;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);
	const tiles = Math.ceil(clipWidth / tile.width);
	const first = Math.max(0, Math.floor((viewportLeft - clipLeft) / tile.width));
	const last = Math.min(tiles - 1, Math.floor((viewportRight - clipLeft) / tile.width));

	for (let i = first; i <= last; i++) {
		drawCover(ctx, still.canvas, clipLeft + i * tile.width, body.top, tile.width, body.height);
	}

	return true;
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
	body: RowBody,
	style: { background: string; waveform: string },
): void {
	const ctx = surface.ctx!;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	const tile = tileFor(body.height, asset.width / asset.height);

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	ctx.save();

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
	const interval = (tile.width / resolution) * averageRate;

	requestFrames({
		clip: eid,
		asset,
		fps,
		firstFrame,
		lastFrame,
		width: tile.width,
		height: tile.height,
		interval,
	});

	if (curve.keys.length > 0) {
		for (let i = Math.floor(firstFrame / interval); i <= Math.floor(lastFrame / interval); i++) {
			const sourceFrame = i * interval;
			const frame = pickFrame(eid, asset.id, sourceFrame, interval);
			if (!frame) continue;

			const x0 = framesToPixels(origin + timelineOffsetAtSource(curve, sourceFrame), resolution);
			const x1 = framesToPixels(origin + timelineOffsetAtSource(curve, sourceFrame + interval), resolution);
			drawCover(ctx, frame.canvas, x0, body.top, Math.max(1, x1 - x0), body.height);
		}
	} else {
		// Tile indices are in source time, matching the frames the decoder filed
		// under source timestamps.
		ctx.translate(framesToPixels(origin, resolution), 0);

		for (let i = Math.floor(firstFrame / interval); i <= Math.floor(lastFrame / interval); i++) {
			const frame = pickFrame(eid, asset.id, i * interval, interval);
			if (!frame) continue;

			drawCover(ctx, frame.canvas, i * tile.width, body.top, tile.width, body.height);
		}
	}

	ctx.restore();

	if (!asset.sampleRate || body.height < MIN_HEIGHT_WITH_WAVEFORM) return;

	const band = Math.round(Math.min(MAX_WAVEFORM_HEIGHT, body.height * WAVEFORM_SHARE));
	const top = body.top + body.height - band;

	ctx.save();
	ctx.globalAlpha *= WAVEFORM_BAND_ALPHA;
	ctx.fillStyle = style.background;
	ctx.fillRect(clipLeft, top, clipWidth, band);
	ctx.restore();

	renderWaveform(world, scene, surface, entity, { asset, color: style.waveform, top, height: band, centred: false });
}

function tileFor(stripHeight: number, aspect: number): { width: number; height: number } {
	const { height } = TILE_STEPS.find((step) => stripHeight <= step.upTo)!;
	const ratio = Math.min(WIDEST_TILE, Math.max(NARROWEST_TILE, aspect > 0 ? aspect : WIDEST_TILE));

	return { width: Math.round(height * ratio), height };
}

/** A picture decoded for one tile size still fills another: it is cropped around its middle, never stretched. */
function drawCover(
	ctx: CanvasRenderingContext2D,
	image: OffscreenCanvas | HTMLCanvasElement,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	const source = image.width / image.height;
	const target = width / height;

	if (source > target) {
		const cropped = image.height * target;
		ctx.drawImage(image, (image.width - cropped) / 2, 0, cropped, image.height, x, y, width, height);
	} else {
		const cropped = image.width / target;
		ctx.drawImage(image, 0, (image.height - cropped) / 2, image.width, cropped, x, y, width, height);
	}
}
