/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { deriveWaveform, downsamplePeaks } from './waveform';

export const PEAK_BARS = 128;

/** Cut down from the full waveform: a file is decoded at one resolution and read at any. */
export async function derivePeaks(file: Blob, bars = PEAK_BARS): Promise<Uint8ClampedArray | null> {
	const waveform = await deriveWaveform(file);
	return waveform && downsamplePeaks(waveform, bars);
}
