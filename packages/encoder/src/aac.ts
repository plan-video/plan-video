/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { canEncodeAudio } from 'mediabunny';

let ready: Promise<void> | null = null;

/** Firefox's WebCodecs can't encode AAC, the audio every network takes: there a WASM encoder fills in, loaded only then. */
export function ensureAacEncoder(): Promise<void> {
	ready ??= (async () => {
		if (await canEncodeAudio('aac')) return;
		const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
		registerAacEncoder();
	})().catch(error => {
		ready = null;
		throw error;
	});
	return ready;
}
