/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Transcript } from "@plan.video/assets";

/** How loud the audio is in short frames: where speech starts and stops. */
export interface SpeechEnvelope {
  /** Seconds per frame. */
  step: number;
  /** Level of each frame, in dB below full scale. */
  levels: Float32Array;
}

const FRAME_SECONDS = 0.01;
/** Digital silence reads as this, not as minus infinity. */
const FLOOR_DB = -100;

/** Shorter quiet stretches are stops inside a word, like the closure before a "p". */
const MIN_SILENCE_SECONDS = 0.1;
/**
 * Speech this close to its noise floor is under music or noise. Its quiet
 * stretches are not pauses, so the reported times are left as they are.
 */
const MIN_CONTRAST_DB = 20;
/** Below this contrast, soft consonants sink into the noise and only longer pauses count. */
const NOISY_CONTRAST_DB = 30;
const NOISY_MIN_SILENCE_SECONDS = 0.15;
/** How far a word edge may move to reach the silence next to it. */
const SNAP_SECONDS = 0.3;
/** Reported ends run late into a pause by more than starts run early. */
const SNAP_END_SECONDS = 0.45;
/** A word shows this much before its voice starts, so it is never late. */
const LEAD_SECONDS = 0.03;
const MIN_WORD_SECONDS = 0.06;
/** How long a word may be held past its reported end. */
const MAX_HOLD_SECONDS = 1.5;
/** A held vowel stays within this much of the word's own level. */
const HOLD_DROP_DB = 10;
/** Dips shorter than this are the voice wavering, not stopping. */
const HOLD_DIP_SECONDS = 0.05;
/** A shorter overhang is the recognizer's grid, not a held word. */
const MIN_HOLD_SECONDS = 0.1;
/** A pause this long inside a word is the gap before the next phrase, not the word. */
const INTERIOR_PAUSE_SECONDS = 0.35;

export function speechEnvelope(samples: Float32Array, sampleRate: number): SpeechEnvelope {
  const size = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const count = Math.floor(samples.length / size);
  const levels = new Float32Array(count);

  for (let frame = 0; frame < count; frame++) {
    let sum = 0;
    const offset = frame * size;
    for (let i = 0; i < size; i++) {
      const sample = samples[offset + i] ?? 0;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / size);
    levels[frame] = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB;
  }

  return { step: size / sampleRate, levels };
}

interface Silence {
  start: number;
  end: number;
}

/** The pauses in the audio, or null when speech does not stand clear of the background. */
export function findSilences(envelope: SpeechEnvelope): Silence[] | null {
  const { levels, step } = envelope;
  if (levels.length === 0) return null;

  const sorted = Float32Array.from(levels).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const loud = sorted[Math.floor(sorted.length * 0.95)]!;
  if (loud - floor < MIN_CONTRAST_DB) return null;

  const threshold = Math.max(floor + 10, loud - 30);
  const minSeconds = loud - floor < NOISY_CONTRAST_DB ? NOISY_MIN_SILENCE_SECONDS : MIN_SILENCE_SECONDS;
  const minFrames = Math.ceil(minSeconds / step);
  const silences: Silence[] = [];
  let from = -1;

  for (let frame = 0; frame <= levels.length; frame++) {
    const quiet = frame < levels.length && levels[frame]! < threshold;
    if (quiet && from === -1) from = frame;
    if (!quiet && from !== -1) {
      if (frame - from >= minFrames) silences.push({ start: from * step, end: frame * step });
      from = -1;
    }
  }

  return silences;
}

/**
 * Moves word edges onto the pauses in the audio. Recognizers place words on
 * a coarse grid and close every gap, so a word shows before it is said after
 * a breath and stays after the voice stops. An edge only moves when a pause
 * lies right next to it; words run together stay as they were heard.
 */
export function snapToSpeech(transcript: Transcript, envelope: SpeechEnvelope): Transcript {
  const silences = findSilences(envelope);
  if (!silences || silences.length === 0) return transcript;

  const words = transcript.flatMap((segment) => segment.words);
  const snapped = new Map<(typeof words)[number], { start: number; end: number }>();
  let previous: { start: number; end: number } | undefined;

  words.forEach((word, index) => {
    const next = words[index + 1];
    let start = word.start;
    let end = word.end;

    // The voice starts where a pause that covers the reported start ends.
    const onset = closest(
      silences.filter((silence) => (
        silence.start <= word.start + 0.05
        && silence.end >= Math.max(word.start - SNAP_SECONDS, (previous?.start ?? -Infinity) + MIN_WORD_SECONDS)
        && silence.end <= Math.min(word.start + SNAP_SECONDS, word.end - MIN_WORD_SECONDS)
      )),
      (silence) => silence.end,
      word.start,
    );
    if (onset) start = Math.max(0, previous?.end ?? 0, onset.end - LEAD_SECONDS);

    // A word that runs across a pause was given the time of whatever is said
    // next. It ends where the pause starts, so it stays with the words before it.
    const gap = silences.find((silence) => (
      silence.end - silence.start >= INTERIOR_PAUSE_SECONDS
      && silence.start >= start + MIN_WORD_SECONDS
      && silence.end <= end
    ));
    if (gap) end = gap.start;

    // It stops where a pause begins that runs on to the reported end, or to
    // the next word. An end never grows into the word after it.
    const reach = Math.min(end, next?.start ?? Infinity) - 0.1;
    const offset = closest(
      silences.filter((silence) => (
        silence.end >= reach
        && silence.start >= Math.max(start + MIN_WORD_SECONDS, end - SNAP_END_SECONDS)
        && silence.start <= Math.min(end + SNAP_SECONDS, next?.start ?? Infinity)
      )),
      (silence) => silence.start,
      word.end,
    );
    if (offset) end = offset.start;
    // A drawn-out word ("hoollyyy") is reported at its usual length. It
    // lasts as long as the voice holds, up to the next word.
    else {
      const pause = silences.find((silence) => silence.end > end);
      const limit = Math.min(end + MAX_HOLD_SECONDS, next?.start ?? Infinity, pause ? Math.max(end, pause.start) : Infinity);
      end = heldUntil(envelope, start, end, limit);
    }

    if (end - start < MIN_WORD_SECONDS) {
      if (gap) end = start + MIN_WORD_SECONDS;
      else {
        start = word.start;
        end = word.end;
      }
    }

    const times = { start: round(start), end: round(end) };
    snapped.set(word, times);
    previous = times;
  });

  return transcript.map((segment) => ({
    ...segment,
    words: segment.words.map((word) => ({ ...word, ...snapped.get(word) })),
  }));
}

/**
 * Where the voice of a word said over `[start, end]` stops holding: the
 * audio stays within a few dB of the word's loud part, across brief dips,
 * until `limit`. `end` when it drops right away.
 */
function heldUntil(envelope: SpeechEnvelope, start: number, end: number, limit: number): number {
  const { levels, step } = envelope;
  const from = Math.floor(start / step);
  const to = Math.min(levels.length, Math.floor(end / step));
  if (to - from < 3) return end;

  const own = Float32Array.from(levels.subarray(from, to)).sort();
  const floor = own[Math.floor(own.length * 0.75)]! - HOLD_DROP_DB;
  const last = Math.min(levels.length, Math.floor(limit / step));
  const maxDip = Math.ceil(HOLD_DIP_SECONDS / step);
  let held = to;
  let dip = 0;

  for (let frame = to; frame < last; frame++) {
    if (levels[frame]! >= floor) {
      held = frame + 1;
      dip = 0;
    } else if (++dip > maxDip) {
      break;
    }
  }

  const heldEnd = held * step;
  return heldEnd - end >= MIN_HOLD_SECONDS ? heldEnd : end;
}

function closest<T>(items: T[], at: (item: T) => number, target: number): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (!best || Math.abs(at(item) - target) < Math.abs(at(best) - target)) best = item;
  }
  return best;
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
