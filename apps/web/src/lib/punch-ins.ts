/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { SpeechEnvelope } from "./speech-timing";

/** One punch-in: zoomed from `start` until `end`, in seconds. */
export interface PunchIn {
  start: number;
  end: number;
}

/** Loudness is read in blocks this long, so a single plosive is not a moment. */
const BLOCK_SECONDS = 0.05;
/** How far back a rise in level is measured from. */
const RISE_SECONDS = 0.3;
/** Speech this close to its noise floor is under music or noise; its peaks say nothing. */
const MIN_CONTRAST_DB = 12;
/** A moment must be at least this far up from the floor towards the loud end. */
const LOUD_SHARE = 0.55;
/** A phrase lasts while the level stays this far up, allowing short dips. */
const PHRASE_SHARE = 0.35;
const PHRASE_DIP_SECONDS = 0.25;
export const MIN_HOLD_SECONDS = 1;
export const MAX_HOLD_SECONDS = 2.5;
/** Kept clear at the clip's end, so a punch never lands on the last frame. */
const EDGE_SECONDS = 0.3;
/** The opening is left to breathe: a punch this early reads as a glitch, not emphasis. */
const LEAD_SECONDS = 1;

/**
 * The moments in the audio worth punching in on: where the voice comes in
 * loud after a quieter stretch (a new phrase, a stressed word), at least
 * `minGap` seconds apart, each held to the end of its phrase. Seconds are
 * the envelope's own, 0 being its first sample. Null when the voice does not
 * stand clear of the background, so the caller can fall back to a rhythm.
 */
export function findPunchIns(envelope: SpeechEnvelope, minGap: number): PunchIn[] | null {
  const per = Math.max(1, Math.round(BLOCK_SECONDS / envelope.step));
  const step = per * envelope.step;
  const levels = blocks(envelope.levels, per);
  if (levels.length < 4) return null;

  const sorted = Float32Array.from(levels).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)]!;
  const loud = sorted[Math.floor(sorted.length * 0.95)]!;
  if (loud - floor < MIN_CONTRAST_DB) return null;

  const loudLine = floor + (loud - floor) * LOUD_SHARE;
  const phraseLine = floor + (loud - floor) * PHRASE_SHARE;
  const back = Math.max(1, Math.round(RISE_SECONDS / step));
  const duration = levels.length * step;

  // Each loud block scored by how far it rose over the stretch before it,
  // plus how loud it is: the start of a phrase out of a pause scores high.
  const candidates: { index: number; score: number }[] = [];
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i]!;
    if (level < loudLine) continue;
    let low = Infinity;
    for (let j = Math.max(0, i - back); j < i; j++) low = Math.min(low, levels[j]!);
    const rise = level - low;
    if (rise < 6) continue;
    candidates.push({ index: i, score: rise + (level - floor) * 0.5 });
  }
  candidates.sort((a, b) => b.score - a.score);

  const picked: number[] = [];
  for (const { index } of candidates) {
    const time = index * step;
    if (time < LEAD_SECONDS || time > duration - MIN_HOLD_SECONDS - EDGE_SECONDS) continue;
    if (picked.some((other) => Math.abs(other - time) < minGap)) continue;
    picked.push(time);
  }
  picked.sort((a, b) => a - b);

  return picked.map((start) => {
    const phraseEnd = endOfPhrase(levels, Math.round(start / step), phraseLine, Math.round(PHRASE_DIP_SECONDS / step)) * step;
    const end = Math.min(duration - EDGE_SECONDS, start + clamp(phraseEnd - start, MIN_HOLD_SECONDS, MAX_HOLD_SECONDS));
    return { start, end };
  });
}

/** Punch-ins on a steady beat, for a clip with no voice to follow. */
export function evenPunchIns(duration: number, minGap: number): PunchIn[] {
  const every = minGap * 1.25;
  const hold = clamp(every / 2.5, MIN_HOLD_SECONDS, MAX_HOLD_SECONDS);
  const punches: PunchIn[] = [];
  for (let start = Math.min(every / 2, 1.5); start + hold <= duration - EDGE_SECONDS; start += every) {
    punches.push({ start, end: start + hold });
  }
  return punches;
}

/**
 * Puts punch-ins from several clips in one order and keeps them apart: one
 * closer than `minGap` to the one before is dropped, and each ends at least
 * `room` before the next begins, so their ramps never overlap.
 */
export function mergePunchIns(punches: PunchIn[], minGap: number, room: number): PunchIn[] {
  const sorted = [...punches].sort((a, b) => a.start - b.start);
  const kept: PunchIn[] = [];
  for (const punch of sorted) {
    const last = kept[kept.length - 1];
    if (last && punch.start - last.start < minGap) continue;
    kept.push({ ...punch });
  }
  for (let i = 0; i < kept.length - 1; i++) {
    const punch = kept[i]!;
    punch.end = Math.min(punch.end, kept[i + 1]!.start - room);
  }
  return kept.filter((punch) => punch.end > punch.start);
}

/** The levels averaged in power over blocks of `per` frames, back in dB. */
function blocks(levels: Float32Array, per: number): Float32Array {
  const count = Math.floor(levels.length / per);
  const out = new Float32Array(count);
  for (let block = 0; block < count; block++) {
    let power = 0;
    for (let i = 0; i < per; i++) power += 10 ** ((levels[block * per + i] ?? -100) / 10);
    out[block] = 10 * Math.log10(power / per);
  }
  return out;
}

/** The block where the phrase starting at `from` falls quiet for longer than `dip` blocks. */
function endOfPhrase(levels: Float32Array, from: number, line: number, dip: number): number {
  let quiet = 0;
  for (let i = from; i < levels.length; i++) {
    if (levels[i]! >= line) quiet = 0;
    else if (++quiet > dip) return i - quiet + 1;
  }
  return levels.length;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
