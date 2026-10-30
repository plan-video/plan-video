/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A clip's speed as a function of its source time. Keyframes name source
// frames, the same clock as every other track. The timeline distance to a
// source frame is the integral of 1/rate up to it, so a stretch played at 2×
// occupies half as much of the timeline. With no track the rate is the
// constant `playbackRate` prop and both directions reduce to multiply/divide.

import { cubicBezier, spring, steps } from 'animejs';

import { Cache, Computed, Keyframe, KeyframeTrack, PlaybackRate } from '../traits';

import type { Entity } from 'koota';

/** Slowest speed a curve will actually play at. Zero would pin the playhead. */
export const MIN_PLAYBACK_RATE = 0.01;

export type SpeedKey = { time: number; value: number; easing: string };

export type SpeedCurve = { base: number; keys: SpeedKey[] };

type Ease = (t: number) => number;

const easingCache = new Map<string, Ease>();

function clampRate(rate: number): number {
	return Number.isFinite(rate) && rate > MIN_PLAYBACK_RATE ? rate : MIN_PLAYBACK_RATE;
}

function resolveEasing(descriptor: string | undefined): Ease | null {
	if (!descriptor) return null;

	const cached = easingCache.get(descriptor);
	if (cached) return cached;

	let fn: Ease | null = null;

	const stepsMatch = descriptor.match(/^steps\((\d+)(?:,(true|false))?\)$/);
	if (stepsMatch) {
		fn = steps(Number.parseInt(stepsMatch[1]!, 10), stepsMatch[2] === 'true');
	}

	const bezierMatch = descriptor.match(/^cubicBezier\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)$/);
	if (bezierMatch) {
		fn = cubicBezier(Number(bezierMatch[1]), Number(bezierMatch[2]), Number(bezierMatch[3]), Number(bezierMatch[4]));
	}

	const springMatch = descriptor.match(/^spring\(([\d.-]+),([\d.-]+)\)$/);
	if (springMatch) {
		const resolved = spring({ bounce: Number(springMatch[1]), duration: Number(springMatch[2]) });
		fn = (t: number) => resolved.ease(t);
	}

	if (!fn) return null;
	easingCache.set(descriptor, fn);
	return fn;
}

/** The clip's speed curve. `keys` is empty when speed is the constant prop. */
export function readSpeedCurve(entity: Entity): SpeedCurve {
	const base = clampRate(entity.get(PlaybackRate)?.value || 1);
	const tracks = entity.get(Cache)?.keyframeTracks ?? [];

	for (const track of tracks) {
		if (track.get(KeyframeTrack)?.property !== 'playbackRate') continue;

		const keys = (track.get(Cache)?.keyframes ?? [])
			.map((keyframe) => {
				const value = keyframe.get(Keyframe);
				if (!value) return null;
				return { time: value.time, value: clampRate(value.value), easing: value.easing };
			})
			.filter((key): key is SpeedKey => key !== null)
			.sort((a, b) => a.time - b.time);

		return { base, keys };
	}

	return { base, keys: [] };
}

/** Playback rate at a source frame. Holds the first key before it and the last after it. */
export function rateAtSource(curve: SpeedCurve, sourceFrame: number): number {
	const { keys, base } = curve;
	if (keys.length === 0) return base;
	if (keys.length === 1 || sourceFrame <= keys[0]!.time) return keys[0]!.value;

	const last = keys[keys.length - 1]!;
	if (sourceFrame >= last.time) return last.value;

	for (let i = 0; i < keys.length - 1; i++) {
		const start = keys[i]!;
		const end = keys[i + 1]!;
		if (sourceFrame < start.time || sourceFrame > end.time) continue;

		const span = end.time - start.time;
		if (span <= 0) return start.value;

		let progress = (sourceFrame - start.time) / span;
		const easing = resolveEasing(start.easing);
		if (easing) progress = easing(Math.max(0, Math.min(1, progress)));

		return clampRate(start.value + (end.value - start.value) * progress);
	}

	return last.value;
}

function easingBetween(curve: SpeedCurve, sourceFrame: number): string {
	for (let i = 0; i < curve.keys.length - 1; i++) {
		const start = curve.keys[i]!;
		const end = curve.keys[i + 1]!;
		if (sourceFrame >= start.time && sourceFrame < end.time) return start.easing;
	}
	return '';
}

/** Timeline frames it takes to play from source frame `s0` to `s1`. */
function integrateSegment(curve: SpeedCurve, s0: number, s1: number): number {
	const span = s1 - s0;
	if (span <= 0) return 0;

	if (resolveEasing(easingBetween(curve, s0))) {
		const steps = 8;
		const ds = span / steps;
		let sum = 0;
		for (let i = 0; i < steps; i++) sum += ds / rateAtSource(curve, s0 + (i + 0.5) * ds);
		return sum;
	}

	const r0 = rateAtSource(curve, s0);
	const r1 = rateAtSource(curve, s1);
	if (Math.abs(r0 - r1) < 1e-6) return span / r0;
	return span * Math.log(r1 / r0) / (r1 - r0);
}

function sourceInSegment(curve: SpeedCurve, s0: number, s1: number, timelineFrames: number): number {
	const span = s1 - s0;
	if (span <= 0) return s0;

	if (resolveEasing(easingBetween(curve, s0))) {
		let lo = s0;
		let hi = s1;
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (integrateSegment(curve, s0, mid) < timelineFrames) lo = mid;
			else hi = mid;
		}
		return (lo + hi) / 2;
	}

	const r0 = rateAtSource(curve, s0);
	const r1 = rateAtSource(curve, s1);
	if (Math.abs(r0 - r1) < 1e-6) return s0 + timelineFrames * r0;

	const t = (r0 / (r1 - r0)) * (Math.exp((timelineFrames * (r1 - r0)) / span) - 1);
	return s0 + Math.min(1, Math.max(0, t)) * span;
}

function marksUpTo(curve: SpeedCurve, sourceFrame: number): number[] {
	const marks = [0];
	for (const key of curve.keys) {
		if (key.time > marks[marks.length - 1]! && key.time < sourceFrame) marks.push(key.time);
	}
	return marks;
}

/**
 * Timeline frames after the clip's origin at which source frame `sourceFrame`
 * is on screen. Constant speed divides; a curve integrates 1/rate.
 */
export function timelineOffsetAtSource(curve: SpeedCurve, sourceFrame: number): number {
	if (curve.keys.length === 0) return sourceFrame / curve.base;
	if (sourceFrame <= 0) return sourceFrame / rateAtSource(curve, 0);

	let acc = 0;
	let cursor = 0;
	for (const mark of marksUpTo(curve, sourceFrame)) {
		if (mark <= cursor) continue;
		acc += integrateSegment(curve, cursor, mark);
		cursor = mark;
	}
	return acc + integrateSegment(curve, cursor, sourceFrame);
}

/** Source frame playing at `offset` timeline frames after the clip's origin. */
export function sourceFrameAtOffset(curve: SpeedCurve, offset: number): number {
	if (curve.keys.length === 0) return offset * curve.base;
	if (offset <= 0) return offset * rateAtSource(curve, 0);

	let remaining = offset;
	let cursor = 0;
	const marks = [0];
	for (const key of curve.keys) {
		if (key.time > marks[marks.length - 1]!) marks.push(key.time);
	}

	for (let i = 0; i < marks.length; i++) {
		const start = marks[i]!;
		const end = marks[i + 1];
		if (start > cursor) cursor = start;
		if (end === undefined) return cursor + remaining * rateAtSource(curve, cursor);

		const span = integrateSegment(curve, start, end);
		if (remaining <= span) return sourceInSegment(curve, start, end, remaining);
		remaining -= span;
		cursor = end;
	}

	return cursor + remaining * rateAtSource(curve, cursor);
}

/** Scene frame at which `sourceFrame` of `entity` plays. */
export function timelineFrameAtSource(entity: Entity, sourceFrame: number): number {
	const origin = entity.get(Computed)?.origin ?? 0;
	return origin + timelineOffsetAtSource(readSpeedCurve(entity), sourceFrame);
}

/** Source frame `entity` is playing at scene frame `frame`. */
export function sourceFrameAtTimeline(entity: Entity, frame: number): number {
	const origin = entity.get(Computed)?.origin ?? 0;
	return sourceFrameAtOffset(readSpeedCurve(entity), frame - origin);
}
