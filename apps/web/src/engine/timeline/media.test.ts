/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VideoAsset } from '@plan.video/assets';
import type { FrameRequest } from './media';

type Decode = { seconds: number; finish: () => void };

// Every decode is held until the test lets it finish, so a second request can arrive while the first is mid-batch.
const decoder = vi.hoisted(() => {
	const asked: Decode[] = [];
	let waiter: ((decode: Decode) => void) | null = null;

	return {
		asked: 0,
		ask(decode: Decode) {
			this.asked++;
			if (waiter) {
				const hand = waiter;
				waiter = null;
				hand(decode);
			} else {
				asked.push(decode);
			}
		},
		next(): Promise<Decode> {
			const ready = asked.shift();
			return ready ? Promise.resolve(ready) : new Promise((resolve) => { waiter = resolve; });
		},
		reset() {
			asked.length = 0;
			waiter = null;
			this.asked = 0;
		},
	};
});

/** The footage has a key frame this often, in seconds. */
const KEY_FRAME_EVERY = 5;

vi.mock('mediabunny', () => ({
	CanvasSink: class {
		getCanvas(seconds: number) {
			return new Promise((resolve) => {
				decoder.ask({ seconds, finish: () => resolve({ timestamp: seconds, canvas: {} }) });
			});
		}
	},
	EncodedPacketSink: class {
		async getKeyPacket(seconds: number) {
			return { timestamp: Math.floor(seconds / KEY_FRAME_EVERY) * KEY_FRAME_EVERY };
		}
	},
}));

vi.mock('@plan.video/runtime', () => ({
	getAssetFile: async () => new Blob(),
	getVideoTrack: async () => ({ getFirstTimestamp: async () => 0, computeDuration: async () => 10 }),
	secondsToFrames: (seconds: number, fps: number) => Math.round(seconds * fps),
}));

vi.stubGlobal('window', { devicePixelRatio: 1 });

const { clearMedia, pickFrame, requestFrames } = await import('./media');

const FPS = 30;
const CLIP = 7;
const asset = { id: 'clip.mp4', type: 'VIDEO', duration: 10 } as VideoAsset;

/** The whole ten seconds on screen, a tile every `interval` frames. */
const strip = (interval: number): FrameRequest => ({
	clip: CLIP,
	asset,
	fps: FPS,
	interval,
	width: 64,
	height: 36,
	firstFrame: 0,
	lastFrame: 300,
});

/** Lets what a finished decode set in motion run, without waiting on a clock. */
async function until(done: () => boolean): Promise<void> {
	for (let turn = 0; turn < 200 && !done(); turn++) await Promise.resolve();
	expect(done()).toBe(true);
}

async function finishDecodes(count: number): Promise<number[]> {
	const seconds: number[] = [];
	for (let i = 0; i < count; i++) {
		const decode = await decoder.next();
		seconds.push(decode.seconds);
		decode.finish();
	}
	return seconds;
}

/** The first request for an asset only decodes a few frames spread across it; the strip follows on the next. */
async function showSpread(): Promise<void> {
	requestFrames(strip(30));
	await finishDecodes(7);
	await until(() => pickFrame(CLIP, asset.id, 0, 30) !== null);
}

describe('timeline thumbnails', () => {
	beforeEach(() => {
		clearMedia();
		decoder.reset();
	});

	it('drops the rest of a batch once a zoom asks for another spacing', async () => {
		await showSpread();

		requestFrames(strip(30));
		const first = await decoder.next();
		expect(first.seconds).toBe(0);

		requestFrames(strip(15));
		first.finish();

		// The old batch would have gone on to 1s; the new spacing starts over from 0 and comes every half second.
		expect(await finishDecodes(3)).toEqual([0, 0.5, 1]);
	});

	it('fills the strip again after zooming away and straight back', async () => {
		await showSpread();

		requestFrames(strip(30));
		await finishDecodes(10);
		await until(() => pickFrame(CLIP, asset.id, 270, 30)?.timestamp === 270);

		requestFrames(strip(15));
		const away = await decoder.next();
		requestFrames(strip(30));
		const before = decoder.asked;
		away.finish();

		await until(() => decoder.asked > before);
		expect(await finishDecodes(10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		await until(() => pickFrame(CLIP, asset.id, 270, 30)?.timestamp === 270);
	});

	it('decodes only key frames, once each, when tiles are far apart in the footage', async () => {
		await showSpread();
		const before = decoder.asked;

		// A tile every three seconds: 0s and 3s sit after the same key frame, 6s after the next.
		requestFrames(strip(90));
		expect(await finishDecodes(2)).toEqual([0, 5]);

		await until(() => pickFrame(CLIP, asset.id, 180, 90)?.timestamp === 150);
		expect(decoder.asked).toBe(before + 2);
	});
});
