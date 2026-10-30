/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait, type Entity } from 'koota';

import { AnimationType, AnimationPhase } from '../constants';

/** One per (target, property), ChildOf its target. `target` is denormalised (ChildOf is authoritative) so motion/render needn't walk the relation every frame. */
export const KeyframeTrack = trait({
	property: '',
	target: null as Entity | null,
});

// Keyframe entity: ChildOf its KeyframeTrack. Easing applies to the segment
// from this keyframe to the next-in-time on the same track.
export const Keyframe = trait({ time: 0, value: 0, easing: 'linear' });

export const Animation = trait({
	type: AnimationType.FADE as AnimationType,
	duration: 0, // frames
	delay: 0, // frames
	phase: AnimationPhase.IN as AnimationPhase,
});
