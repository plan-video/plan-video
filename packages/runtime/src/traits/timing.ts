/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { TransitionDirection, TransitionEasing, TransitionType } from '../constants';

// Offset where the node's local time 0 (source frame 0) sits on its parent's
// timeline, in frames. May carry a fraction: audio is scheduled against it,
// and a trimmed clip's origin sits sourceIn/rate before its first visible
// frame. Absent is 0 (the node's time begins with its parent's).
export const Delay = trait({ value: 0 });

/** In source frames. A null `end` runs to the source's natural end (16s with no source); absent, `start` is 0 and scenes/groups fit their children. */
export const Trim = trait({ start: 0, end: null as number | null });

/** The only thing that says how long a frames directory lasts; absent means the library's rate. Unrelated to PlaybackRate. */
export const SourceFrameRate = trait({ value: 0 });

// Speed multiplier for the node's local time (1 = normal). Scales the source
// window against the timeline window: at 2, twice the source frames fit into
// the same stretch of timeline.
export const PlaybackRate = trait({ value: 1 });

// Explicit playback/export window on a scene.
export const Workarea = trait({ start: 0, end: 0 });

export const Playback = trait({
	playing: false,
	loop: true,
	speed: 1, // playback speed multiplier (negative = reverse)
});

// Tag marking a container whose direct children cannot overlap in time.
// Drag/trim of any direct child clamps at the neighbour's edge.
export const Sequential = trait();

/** In a Sequential parent it blends into the next clip, centred on the cut; elsewhere the clip plays out on its own. */
export const Transition = trait({
	type: TransitionType.DISSOLVE as TransitionType,
	duration: 0, // frames
	direction: TransitionDirection.AUTO as TransitionDirection,
	easing: TransitionEasing.AUTO as TransitionEasing,
	color: -1, // 0xRRGGBB a fade or flash goes through; -1 is the style's own
});

// How a clip comes in, on its own, from its start. Gives way to a Transition
// the clip before it in a Sequential parent already plays into it.
export const TransitionIn = trait({
	type: TransitionType.DISSOLVE as TransitionType,
	duration: 0, // frames
	direction: TransitionDirection.AUTO as TransitionDirection,
	easing: TransitionEasing.AUTO as TransitionEasing,
	color: -1, // 0xRRGGBB a fade or flash goes through; -1 is the style's own
});

// Per-clip user-customized timeline row height (persisted).
export const ClipHeight = trait({ value: 0 });

// Tag: this clip's keyframe rows are expanded below the clip body (persisted).
export const Expanded = trait();
