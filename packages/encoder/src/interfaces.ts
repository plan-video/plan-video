/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { VideoCodec, AudioCodec } from 'mediabunny';
import type { ContainerFormat, EncoderProgress, WritableFileTarget } from './types';

export interface AudioConfig {
	/** @default true */
	enabled?: boolean;

	/** Samples per second. @default 48000 */
	sampleRate?: number;

	/** @default 2 */
	numberOfChannels?: number;

	/** @default 128e3 */
	bitrate?: number;

	/** @default 'aac' */
	codec?: AudioCodec;
}

export interface VideoConfig {
	/** @default 'avc' */
	codec?: VideoCodec;

	/** As specified in the WebCodecs API Codec Registry. */
	fullCodecString?: string;

	/** @default true */
	enabled?: boolean;

	/** @default 10e6 */
	bitrate?: number;

	/** Read by whoever builds the capture world, not the encoder, which takes the world's own frame rate. @default the source world's */
	fps?: number;

	/**
	 * The output's shorter side in px (the "p" number; a vertical video's width). Scaled uniformly:
	 * at 2160 a 1920×1080 scene encodes as 3840×2160. Rounding in `computeOutputSize`.
	 * @default 1080
	 */
	resolution?: number;
}

export interface EncoderConfig {
	video?: VideoConfig;

	audio?: AudioConfig;

	/** @default 'mp4' */
	format?: ContainerFormat;

	/** A file handle streams the output to the file; when omitted it is buffered and returned as a Blob in the ExportResult. */
	target?: FileSystemFileHandle | WritableFileTarget;

	onProgress?: (progress: EncoderProgress) => void;

	/**
	 * Metadata comment tag written into the container (e.g. an app version).
	 */
	comment?: string;
}

export interface ImageEncoderConfig {
	/** Frames to capture, relative to the node's first visible frame. */
	frames: number[];

	/** Target output height in px (default: the node's native size). */
	resolution?: number;
}
