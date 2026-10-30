/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { generate, transform } from '@plan.video/jsx';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type {
	AssetInput,
	AssetRef,
	GenerateAudioOptions,
	GenerateImageOptions,
	GenerateVideoOptions,
	GenerateVoiceOptions,
} from '@plan.video/jsx';

/** Where a generation stands is the library's, as partial documents: a key standing in error resolves to that error rather than another run. Nothing here writes to the source. */
export abstract class GenAi {
	/** Content-addressed: the resolved spec's hash is `generation.key`, so the same spec is the same asset across sessions and concurrent declarations share one run. Rejects with the recorded reason when the key stands in error. */
	public abstract resolve(ref: AssetRef): Promise<Asset>;

	/** Cached by scene id + seed across sessions; a new seed transcribes again. Identical concurrent requests share one run. */
	public abstract transcribe(world: World, scene: Entity, seed: number): Promise<Asset>;

	/** Declares and resolves in one call, returning the finished asset. */
	public readonly generate = {
		image: (options: GenerateImageOptions): Promise<Asset> => this.resolve(generate.image(options)),
		video: (options: GenerateVideoOptions): Promise<Asset> => this.resolve(generate.video(options)),
		voice: (options: GenerateVoiceOptions): Promise<Asset> => this.resolve(generate.voice(options)),
		audio: (options: GenerateAudioOptions): Promise<Asset> => this.resolve(generate.audio(options)),
	};

	public readonly transform = {
		upscale: (input: AssetInput): Promise<Asset> => this.resolve(transform.upscale(input)),
		removeBackground: (input: AssetInput): Promise<Asset> => this.resolve(transform.removeBackground(input)),
		addAudio: (input: AssetInput): Promise<Asset> => this.resolve(transform.addAudio(input)),
	};
}
