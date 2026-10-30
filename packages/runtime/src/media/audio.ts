/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Input, ALL_FORMATS, BlobSource, AudioBufferSink, type WrappedAudioBuffer, type InputAudioTrack } from 'mediabunny';

import { AssetId, AudioDecoderHandle } from '../traits';
import { AsyncMutex } from '../utils/async';
import { assert } from '../utils/assert';
import { getAsset, getAssetFile } from '../actions/assets';
import { TimeStretcher } from './time-stretcher';

import type { Entity, World } from 'koota';
import type { AudioAsset, VideoAsset } from '@plan.video/assets';
import type { AudioBus } from './audio-bus';

const audioTrackCache = new Map<string, Promise<InputAudioTrack | null>>();

export function clearAudioTrackCache() {
	audioTrackCache.clear();
}

/**
 * Keyed by asset ID so multiple decoders for the same source
 * audio reuse a single Input + InputAudioTrack.
 */
export function getAudioTrack(source: AudioAsset | VideoAsset) {
	let promise = audioTrackCache.get(source.id);
	if (promise) return promise;

	promise = (async () => {
		try {
			const blob = await getAssetFile(source);
			const input = new Input({
				formats: ALL_FORMATS,
				source: new BlobSource(blob),
			});
			return await input.getPrimaryAudioTrack();
		} catch {
			audioTrackCache.delete(source.id);
			return null;
		}
	})();

	audioTrackCache.set(source.id, promise);
	return promise;
}

type PlayOptions = {
	relativeFrom: number;
	relativeTo: number;
	trimStart: number;
	trimEnd: number;
	playbackRate: number;
	currentTime: number;
	relativeDelay: number;
}

export class AudioDecoder {
	readonly assetId: string;

	private readonly asset: AudioAsset | VideoAsset;
	private readonly mutex = new AsyncMutex();
	private readonly audioNodes = new Set<AudioBufferSourceNode>();

	private iterator: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
	private firstBuffer: WrappedAudioBuffer | null = null;
	private lastBuffer: WrappedAudioBuffer | null = null;
	private stretcher: TimeStretcher | null = null;
	private stretchRate = 1;
	private nextTimestamp = 0;
	private audioTrack: InputAudioTrack | null = null;
	private sink!: AudioBufferSink;

	public ready = false;

	public constructor(asset: AudioAsset | VideoAsset) {
		this.asset = asset;
		this.assetId = asset.id;
	}

	public async init() {
		this.audioTrack = await getAudioTrack(this.asset);
		assert(this.audioTrack, 'Audio track not found');
		this.sink = new AudioBufferSink(this.audioTrack);
		this.ready = true;
	}

	private renderData(bus: AudioBus, options: PlayOptions, data: Float32Array[] | null, sampleRate: number) {
		if (!data) {
			return;
		}

		const { relativeDelay, playbackRate } = options;

		const trimStart = options.trimStart / playbackRate;
		const trimEnd = options.trimEnd / playbackRate;
		const context = bus.context;
		const input = bus.input;

		const newBuffer = new AudioBuffer({
			length: data[0]!.length,
			sampleRate,
			numberOfChannels: data.length,
		});
		for (let c = 0; c < data.length; c++) {
			newBuffer.copyToChannel(data[c] as Float32Array<ArrayBuffer>, c);
		}

		const newBufferTimestamp = this.nextTimestamp;
		this.nextTimestamp += newBuffer.duration;

		let start = relativeDelay + newBufferTimestamp;
		let offset = 0;
		let duration = newBuffer.duration;

		if (newBufferTimestamp + duration > trimEnd) {
			duration = trimEnd - newBufferTimestamp;
		}

		if (newBufferTimestamp < trimStart) {
			start += trimStart - newBufferTimestamp;
			offset += trimStart - newBufferTimestamp;
		}

		// Starting before the context's current time is illegal.
		if (start < context.currentTime) {
			offset += context.currentTime - start;
			start = context.currentTime;
		}

		// Web Audio quirk: a click can be heard on the boundary between two clips; shifting every buffer by
		// half a sample typically avoids it.
		start += 0.5 / context.sampleRate;

		duration -= offset;
		duration = Math.max(0, duration);

		const bufferSource = context.createBufferSource();
		bufferSource.buffer = newBuffer;
		bufferSource.connect(input);
		bufferSource.start(start, offset, duration);

		this.audioNodes.add(bufferSource);
		bufferSource.onended = () => this.audioNodes.delete(bufferSource);
	}

	public async playTo(bus: AudioBus | null, options: PlayOptions) {
		if (!this.asset.channels || !this.asset.sampleRate || !bus) {
			return;
		}

		const { relativeFrom, relativeTo } = options;

		const release = await this.mutex.acquire();

		const firstTs = this.firstBuffer?.timestamp ?? Number.POSITIVE_INFINITY;
		const lastTs = this.lastBuffer?.timestamp ?? Number.NEGATIVE_INFINITY;
		const isBufferOutOfRange = relativeFrom < firstTs || lastTs < relativeFrom - 1;

		try {
			if (this.iterator == null || this.stretcher == null || isBufferOutOfRange) {
				// Close the previous iterator so its pre-decoded AudioSamples get released.
				await this.iterator?.return();
				this.iterator = this.sink.buffers(relativeFrom);
				this.firstBuffer = null;
				this.lastBuffer = null;
				this.stretcher = null;
			}

			while (true) {
				const nextBuffer = (await this.iterator.next()).value;
				const sampleRate = nextBuffer?.buffer.sampleRate ?? this.asset.sampleRate;
				const numberOfChannels = nextBuffer?.buffer.numberOfChannels ?? this.asset.channels;
				const stretch = 1 / (options.playbackRate || 1);
				// A ramp moves the rate every frame. Rebuilding the stretcher on a
				// small change clicks; a jump past a couple of percent is a new
				// stretch, so the old one is dropped and the iterator kept.
				if (this.stretcher && Math.abs(stretch - this.stretchRate) > 0.02 * this.stretchRate) {
					this.stretcher = null;
				}
				this.stretchRate = stretch;
				this.stretcher ??= new TimeStretcher(numberOfChannels, sampleRate, stretch);

				if (!nextBuffer) {
					this.renderData(bus, options, this.stretcher.finalize(), sampleRate);
					break;
				}

				if (!this.firstBuffer) {
					this.nextTimestamp = nextBuffer.timestamp / options.playbackRate;
				}

				if (this.lastBuffer) {
					const sampleGap = Math.round(
						nextBuffer.timestamp - (this.lastBuffer.timestamp + this.lastBuffer.duration)
					);

					if (sampleGap > 0) {
						this.renderData(
							bus,
							options,
							Array(numberOfChannels).fill(new Float32Array(sampleGap)),
							sampleRate
						);
					}
				}

				this.firstBuffer ??= nextBuffer;
				this.lastBuffer = nextBuffer;

				const buffers: Float32Array[] = [];
				for (let c = 0; c < nextBuffer.buffer.numberOfChannels; c++) {
					const channelData = nextBuffer.buffer.getChannelData(c);
					buffers.push(channelData);
				}

				// TODO: Handle gap in timestamps case

				this.renderData(bus, options, this.stretcher.append(buffers), sampleRate);

				if (nextBuffer.timestamp >= relativeTo) {
					break;
				}
			}
		} finally {
			release();
		}
	}

	public reset() {
		if (!this.iterator) return;

		this.iterator?.return();
		this.iterator = null;
		this.firstBuffer = null;
		this.lastBuffer = null;
		this.stretcher = null;
		this.stretchRate = 1;

		for (const node of this.audioNodes) {
			node.stop();
		}
		this.audioNodes.clear();
	}
}


type ResolvedAudioDecoder = {
	decoder: AudioDecoder;
	initPromise: Promise<void> | null;
};

export function resolveAudioDecoder(world: World, entity: Entity): ResolvedAudioDecoder | null {
	const assetId = entity.get(AssetId)?.value;
	if (!assetId) return null;

	const existing = entity.get(AudioDecoderHandle);
	if (existing && existing.assetId === assetId) {
		return {
			decoder: existing,
			initPromise: null,
		};
	}

	if (existing) existing.reset();

	const asset = getAsset(world, assetId);
	if (!asset || (asset.type !== 'AUDIO' && asset.type !== 'VIDEO')) return null;
	if (asset.type === 'VIDEO' && !asset.channels) return null;

	const decoder = new AudioDecoder(asset);
	entity.add(AudioDecoderHandle);
	entity.set(AudioDecoderHandle, decoder);
	return {
		decoder,
		initPromise: decoder.init(),
	};
}
