/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import { speechEnvelope, type SpeechEnvelope } from "./speech-timing";

/** How much audio before the trim to include, so the first word is not cut in half. */
const PREROLL_SECONDS = 0.25;

/** A gap larger than this is silence in the file, not a decoder overlap. */
const GAP_SECONDS = 0.05;

export interface SpeechWav {
  wav: Blob;
  /** Media time, in seconds, of the first sample in `wav`. */
  mediaStart: number;
  sampleRate: number;
  /** Loudness of `wav`, on the same clock as the words heard in it. */
  envelope: SpeechEnvelope;
}

/**
 * Sample 0 is `mediaStart` on the file's presentation clock, the clock the picture
 * seeks on. Null when the file has no audible audio track.
 */
export async function extractSpeechWav(file: Blob, trimStart: number, trimEnd: number): Promise<SpeechWav | null> {
  const windowStart = Math.max(0, trimStart - PREROLL_SECONDS);
  const windowEnd = Math.max(windowStart + GAP_SECONDS, trimEnd);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return null;

    const sink = new AudioBufferSink(track);
    const chunks: Float32Array[] = [];
    let sampleRate = 0;
    let mediaStart = windowStart;
    let cursor = 0;

    for await (const { buffer, timestamp } of sink.buffers(windowStart, windowEnd)) {
      const mono = downmix(buffer);
      if (mono.length === 0) continue;

      if (!sampleRate) {
        sampleRate = buffer.sampleRate;
        mediaStart = Math.max(0, timestamp);
      }

      const gap = timestamp - (mediaStart + cursor / sampleRate);
      // A jump this large is a bad timestamp, not a pause: give up so the scene mix is used.
      if (gap > 30) return null;
      if (gap > GAP_SECONDS) {
        const missing = Math.round(gap * sampleRate);
        chunks.push(new Float32Array(missing));
        cursor += missing;
      }

      chunks.push(mono);
      cursor += mono.length;
    }

    if (!sampleRate || cursor === 0) return null;

    const heardSeconds = cursor / sampleRate;
    const askedSeconds = windowEnd - windowStart;
    if (askedSeconds >= 2 && heardSeconds < askedSeconds * 0.5) return null;

    const mixed = new Float32Array(cursor);
    let offset = 0;
    for (const chunk of chunks) {
      mixed.set(chunk, offset);
      offset += chunk.length;
    }
    if (peak(mixed) < 1e-4) return null;

    return { wav: encodeWavMono(mixed, sampleRate), mediaStart, sampleRate, envelope: speechEnvelope(mixed, sampleRate) };
  } finally {
    input.dispose();
  }
}

function downmix(buffer: AudioBuffer): Float32Array {
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(frames);
  if (frames === 0 || channels === 0) return mono;

  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) mono[frame] += data[frame] ?? 0;
  }

  const scale = 1 / channels;
  for (let frame = 0; frame < frames; frame++) mono[frame] *= scale;
  return mono;
}

function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i] ?? 0);
    if (value > max) max = value;
  }
  return max;
}

function wavHeader(dataSize: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  return buffer;
}

function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  const data = new DataView(new ArrayBuffer(samples.length * 2));
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    data.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([wavHeader(data.byteLength, sampleRate), data.buffer], { type: "audio/wav" });
}
