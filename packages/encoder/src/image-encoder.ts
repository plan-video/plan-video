/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
	setActive, framesToSeconds, formatTimecode, assert, store,
	assetSystem, playbackSystem, motionSystem, transformSystem, renderSystem,
	Silent, Workarea, Playback, Computed,
	Time, FrameRate, RenderSurface, AudioEngine,
} from '@plan.video/runtime';

import { captureScene, normalizeSceneTransform, resolverSystem, warmupAssets } from './encoder';
import { scaleSize } from './utils';
import { encodePng } from './png';

import type { World } from 'koota';
import type { ImageEncoderConfig } from './interfaces';

export type CapturedImage = { png: Uint8Array; timecode: string };

export type ImageExportResult =
	| { type: 'success'; data: CapturedImage[] }
	| { type: 'canceled' }
	| { type: 'error'; error: Error };

/**
 * `world` is the caller's, arranged as for `createEncoder`, and stepped the way an export steps it.
 * Seeking runs the project's own code and DOM-backed nodes keep what a seek did, so frames render
 * in ascending order whatever order they were asked in, never pre-rolled ahead of the first.
 */
export async function createImageEncoder(world: World, config: ImageEncoderConfig) {
	assert(config.frames.length > 0, 'No frames requested');

	const scene = captureScene(world);
	const sceneId = scene.id();

	const canvas = world.get(RenderSurface)?.canvas;
	assert(canvas instanceof HTMLCanvasElement, 'The capture world has no canvas to draw into');

	// Never started — image capture is video-only; the context is only there
	// for the lazy audio-bus wiring to have something to bind to.
	world.set(AudioEngine, { context: new OfflineAudioContext(2, 1, 48000) });

	// Silence the world so the playback system never initializes audio decoders. Not `Muted` per
	// node: a `<captions>` transcribing its scene during warmup still needs the scene to hold audio.
	world.add(Silent);

	await warmupAssets(world);

	const computed = store(world, Computed);
	const playback = store(world, Playback);

	const frameRate = world.get(FrameRate)?.value ?? 30;
	const sceneWidth = computed.width[sceneId]!;
	const sceneHeight = computed.height[sceneId]!;
	const sceneEnd = computed.end[sceneId]!;

	// Frame 0 is the export's frame 0: the workarea's first frame.
	const workarea = scene.get(Workarea);
	const workareaStart = workarea ? Math.max(0, Math.min(sceneEnd, workarea.start)) : 0;
	const playheadStartSeconds = framesToSeconds(workareaStart, frameRate);

	setActive(world, scene);
	playback.playing[sceneId] = true;
	playback.loop[sceneId] = false;
	playback.speed[sceneId] = 1;

	// Ascending and deduplicated: the render loop only ever moves the world
	// forward, the way an export advances — never back.
	const order = [...new Set(config.frames)].sort((a, b) => a - b);

	/** Re-target the output height; callers that lay frames out do this once sized. */
	const resize = (height?: number) => {
		const scale = Math.round((height ?? sceneHeight) * 1e6 / sceneHeight) / 1e6;
		const output = scaleSize(sceneWidth, sceneHeight, scale);
		canvas.width = output.width;
		canvas.height = output.height;
		world.set(RenderSurface, { resolution: output.scale });
	};

	resize(config.resolution);

	let canceled = false;
	const cancel = () => (canceled = true);

	const render = async (): Promise<ImageExportResult> => {
		try {
			// Rendered in `order` and dealt back out in the requested order; a
			// frame asked for twice is drawn once.
			const images = new Map<number, CapturedImage>();

			const frameDuration = 1 / frameRate;

			for (const frame of order) {
				if (canceled) {
					return { type: 'canceled' };
				}

				const playheadSeconds = playheadStartSeconds + frame * frameDuration;

				// The export's tick, verbatim: the encoder owns the playhead and
				// writes both seconds + frames before each systems pass.
				computed.localTimeInSeconds[sceneId] = playheadSeconds;
				computed.localTime[sceneId] = Math.round(playheadSeconds * frameRate);
				const time = world.get(Time)!;
				world.set(Time, { delta: frameDuration * 1000, now: time.now + frameDuration * 1000 });

				assetSystem(world);
				playbackSystem(world);
				await resolverSystem(world);
				motionSystem(world);
				// May be changed by a system
				normalizeSceneTransform(world, sceneId);
				transformSystem(world);
				renderSystem(world);

				images.set(frame, {
					png: await encodePng(canvas),
					timecode: formatTimecode(playheadSeconds, frameRate),
				});
			}

			return { type: 'success', data: config.frames.map((frame) => images.get(frame)!) };
		} catch (e) {
			return {
				type: 'error',
				error: e instanceof Error ? e : new Error('Unknown error'),
			};
		}
		// The world, its canvas and its decoders are the caller's to release.
	};

	return {
		render,
		cancel,
		resize,
		bounds: { width: sceneWidth, height: sceneHeight },
	};
}

