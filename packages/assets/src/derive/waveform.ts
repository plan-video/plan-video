/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { WaveformRequest, WaveformResponse } from './waveform-worker';

/**
 * Peaks a second a derived waveform holds: finer than any zoom the timeline
 * reaches, and a byte each, so an hour of audio is a few megabytes of it.
 */
export const WAVEFORM_PEAKS_PER_SECOND = 800;

/** One byte a peak, the peak at a moment at that moment's index. Decoded in a worker of its own, gone when it answers. */
export function deriveWaveform(file: Blob, peaksPerSecond = WAVEFORM_PEAKS_PER_SECOND): Promise<Uint8ClampedArray | null> {
	const worker = new Worker(new URL('./waveform-worker.ts', import.meta.url), { type: 'module' });
	return new Promise<Uint8ClampedArray | null>((resolve, reject) => {
		worker.onmessage = ({ data }: MessageEvent<WaveformResponse>) => {
			if ('error' in data) reject(new Error(data.error));
			else resolve(data.peaks);
		};
		worker.onerror = (event) => reject(new Error(event.message || 'The waveform worker failed'));
		worker.postMessage({ file, peaksPerSecond } satisfies WaveformRequest);
	}).finally(() => worker.terminate());
}

/**
 * The loudest of each slice, never fewer than one position per sample. Zoomed in past the derived
 * resolution, slices narrower than a sample would read nothing and draw a regular pattern of gaps,
 * so each holds the sample it starts in.
 */
export function downsamplePeaks(data: Uint8ClampedArray, target: number): Uint8ClampedArray {
	const peaks = new Uint8ClampedArray(target);
	const ratio = data.length / target;

	for (let i = 0; i < target; i++) {
		const from = Math.floor(i * ratio);
		const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
		let max = 0;

		for (let index = from; index < to && index < data.length; index++) {
			max = Math.max(max, data[index]!);
		}

		peaks[i] = max;
	}

	return peaks;
}
