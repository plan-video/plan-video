/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { AnimationPhase, AnimationType } from '../constants';
import { animationProgress, poseAnimation, type AnimationPose } from './motion';

const clip = { in: 0, out: 300 };

describe('animationProgress', () => {
	it('plays an in animation once from the head', () => {
		expect(animationProgress(AnimationPhase.IN, 30, 0, clip, 0)).toBe(0);
		expect(animationProgress(AnimationPhase.IN, 30, 0, clip, 29)).toBe(1);
		expect(animationProgress(AnimationPhase.IN, 30, 0, clip, 30)).toBeNull();
	});

	it('plays an out animation into the tail', () => {
		expect(animationProgress(AnimationPhase.OUT, 30, 0, clip, 269)).toBeNull();
		expect(animationProgress(AnimationPhase.OUT, 30, 0, clip, 270)).toBe(0);
	});

	it('repeats a loop for the whole clip, after its delay', () => {
		expect(animationProgress(AnimationPhase.LOOP, 30, 10, clip, 9)).toBeNull();
		expect(animationProgress(AnimationPhase.LOOP, 30, 10, clip, 10)).toBe(0);
		expect(animationProgress(AnimationPhase.LOOP, 30, 10, clip, 25)).toBe(0.5);
		expect(animationProgress(AnimationPhase.LOOP, 30, 10, clip, 40)).toBe(0);
		expect(animationProgress(AnimationPhase.LOOP, 30, 10, clip, 295)).toBe(0.5);
		expect(animationProgress(AnimationPhase.LOOP, 30, 10, clip, 300)).toBeNull();
	});
});

const rest = (): AnimationPose => ({
	opacity: 1, volume: 0, scaleX: 1, scaleY: 1, rotation: 0, offsetX: 0, offsetY: 0, blur: 0, chars: '',
});

const LOOPS = [
	AnimationType.FLOAT,
	AnimationType.PULSE,
	AnimationType.WIGGLE,
	AnimationType.SHAKE,
	AnimationType.FLICKER,
	AnimationType.BREATHE,
];

describe('looping motions', () => {
	it.each(LOOPS)('type %i starts and ends each cycle at rest, so loops join up', (type) => {
		for (const progress of [0, 1]) {
			const pose = rest();
			poseAnimation(pose, type, AnimationPhase.LOOP, progress, '');
			for (const [key, value] of Object.entries(rest())) {
				if (typeof value === 'number') expect(pose[key as keyof AnimationPose]).toBeCloseTo(value, 9);
			}
		}
	});

	it.each(LOOPS)('type %i moves mid-cycle', (type) => {
		const moved = [0.13, 0.25, 0.5, 0.56, 0.75].some((progress) => {
			const pose = rest();
			poseAnimation(pose, type, AnimationPhase.LOOP, progress, '');
			return Object.entries(rest()).some(([key, value]) => Math.abs((pose[key as keyof AnimationPose] as number) - (value as number)) > 0.01);
		});
		expect(moved).toBe(true);
	});

	it('adds to an in animation it overlaps rather than replacing it', () => {
		const pose = rest();
		poseAnimation(pose, AnimationType.POP, AnimationPhase.IN, 0.3, '');
		const popped = pose.scaleX;
		poseAnimation(pose, AnimationType.PULSE, AnimationPhase.LOOP, 0.5, '');
		expect(pose.scaleX).toBeGreaterThan(popped);
	});
});
