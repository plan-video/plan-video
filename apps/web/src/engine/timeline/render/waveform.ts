/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	Computed,
	Muted,
	getParentEntity,
	getSourceWindow,
	readSpeedCurve,
	sourceFrameAtOffset,
	store,
	timelineOffsetAtSource,
} from '@plan.video/runtime';

import { SAMPLE_WIDTH, getClipSamples, requestPeaks } from '../peaks';
import { framesToPixels, getFrameRate, getResolution, getViewport, pixelsToFrames } from '../view';

import type { AudioAsset, VideoAsset } from '@plan.video/assets';
import type { Entity, World } from 'koota';
import type { TimelineSurfaceState } from '../surface';

const VIEWPORT_MARGIN = 5;
const PADDING = 2;
const MUTED_ALPHA = 0.3;

export type WaveformOptions = {
	asset: AudioAsset | VideoAsset;
	color: string;
	/** The band it fills, from the row's top. */
	top: number;
	height: number;
	/** Grown from the middle; otherwise it stands on the band's bottom edge. */
	centred: boolean;
};

// Peaks are asked for at one per pixel and only for the on-screen stretch, then
// read back by time rather than index, so a column not derived yet is left out
// and filled in on a later frame.
export function renderWaveform(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	options: WaveformOptions,
): void {
	const ctx = surface.ctx!;

	if (!options.asset.sampleRate || options.height <= PADDING) return;

	const eid = entity.id();
	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);
	const fps = getFrameRate(world);

	const clipLeft = framesToPixels(computed.start[eid] ?? 0, resolution);
	const clipWidth = framesToPixels(computed.end[eid] ?? 0, resolution) - clipLeft;

	const [viewportLeft, viewportRight] = getViewport(world, scene, surface.layout.width);

	ctx.save();

	ctx.beginPath();
	ctx.rect(clipLeft, options.top, clipWidth, options.height);
	ctx.clip();

	const room = options.height - (options.centred ? PADDING * 2 : PADDING);

	const playbackRate = computed.playbackRate[eid] || 1;
	const curve = readSpeedCurve(entity);
	const pixelsToSeconds = (pixels: number): number => pixels / (fps * resolution);

	// The source window is in source frames; the clip occupies window / playbackRate
	// timeline frames from its own origin. A speed curve integrates 1/rate instead.
	const source = getSourceWindow(entity);
	const origin = computed.origin[eid] ?? 0;
	const inOffset = curve.keys.length > 0 ? timelineOffsetAtSource(curve, source.in) : source.in / playbackRate;
	const outOffset = curve.keys.length > 0 ? timelineOffsetAtSource(curve, source.out) : source.out / playbackRate;
	const inPx = framesToPixels(inOffset, resolution);
	const outPx = framesToPixels(outOffset, resolution);
	const originPx = framesToPixels(origin, resolution);

	// Sped up, each pixel covers playbackRate× more source, so fewer peaks per
	// source second are needed. A curve uses its average rate. Never none: zoomed
	// far out a pixel is worth less than a second of source.
	const averageRate = curve.keys.length > 0
		? Math.max(source.out - source.in, 1) / Math.max(outOffset - inOffset, 1)
		: playbackRate;
	const peaksPerSecond = Math.max(1, Math.floor(fps * resolution)) / SAMPLE_WIDTH / averageRate;

	const firstSample = Math.max(inPx, viewportLeft - VIEWPORT_MARGIN - originPx);
	const lastSample = Math.min(outPx, viewportRight + VIEWPORT_MARGIN - originPx);

	const sourceSecondsAt = (pixels: number): number => curve.keys.length > 0
		? sourceFrameAtOffset(curve, pixelsToFrames(pixels, resolution)) / fps
		: pixelsToSeconds(pixels) * playbackRate;

	requestPeaks(world, {
		clip: eid,
		asset: options.asset,
		start: sourceSecondsAt(firstSample),
		end: sourceSecondsAt(lastSample),
		peaksPerSecond,
	});

	ctx.fillStyle = options.color;
	// Silenced sound stays on show, faded: the shape is still what people cut by.
	if (entity.has(Muted) || getParentEntity(entity)?.has(Muted)) ctx.globalAlpha *= MUTED_ALPHA;
	ctx.translate(originPx, options.top);

	const samples = getClipSamples(eid);

	// One path, one fill: a clip the width of the screen is a few thousand bars.
	ctx.beginPath();

	for (let x = firstSample; samples && x < lastSample; x += SAMPLE_WIDTH) {
		const time = sourceSecondsAt(x);
		if (time < samples.start || time > samples.end) continue;

		const peak = samples.data[Math.floor((time - samples.start) * samples.peaksPerSecond)];
		if (peak === undefined) continue;

		// A centred waveform keeps a hairline through silence, so a quiet stretch still reads as sound.
		const height = Math.max((peak / 255) * room, options.centred ? 1 : 0);
		ctx.rect(x, options.centred ? (options.height - height) / 2 : options.height - height, SAMPLE_WIDTH, height);
	}

	ctx.fill();
	ctx.restore();
}
