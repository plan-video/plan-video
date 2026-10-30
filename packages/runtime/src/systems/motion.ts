/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or } from 'koota';
import { cubicBezier, steps, spring } from 'animejs';

import { store } from '../world/store';
import {
	Geometry, Group, AdjustmentLayer, Hidden, Culled,
	Computed, Cache, Animation, KeyframeTrack, Keyframe, Chars,
	UniformScale, Position, Offset, Rotation, Scale, Skew, Size, Opacity,
	Color, Blur, Volume, PlaybackRate, Effect, StrokeStyle, CornerRadius, MixedCornerRadius,
	ColorStop, WordTiming, Caption, Selected, Playback, Mode,
} from '../traits';
import { getSceneAncestor } from '../queries/hierarchy';
import { AnimationType, AnimationPhase } from '../constants';
import { revealChars, revealWords, scrambleChars } from '../utils/text-motion';
import { getLocalWindow } from '../utils/time';

import type { Entity, Trait, TraitRecord, World } from 'koota';

/**
 * Reset an entity's Computed values back to its authored trait values.
 * Motion (animations + keyframes) then layers on top each frame. A trait
 * the entity does not carry counts as its default: koota leaves store slots
 * as they were when a trait is removed, so the slot alone cannot say.
 * `ignore` treats one more trait as absent, for onRemove handlers (koota
 * fires them before the trait is cleared).
 */
export function resetAnimatedValues(world: World, entity: Entity | null, ignore?: Trait) {
	if (entity === null) return;

	const computed = store(world, Computed);
	const eid = entity.id();
	const read = <T extends Trait, K extends keyof TraitRecord<T>>(trait: T, field: K, fallback: TraitRecord<T>[K]): TraitRecord<T>[K] => {
		if (trait === ignore || !entity.has(trait)) return fallback;
		return (store(world, trait) as Record<K, TraitRecord<T>[K][]>)[field][eid] ?? fallback;
	};

	computed.positionX[eid] = read(Position, 'x', 0);
	computed.positionY[eid] = read(Position, 'y', 0);
	computed.offsetX[eid] = read(Offset, 'x', 0);
	computed.offsetY[eid] = read(Offset, 'y', 0);
	computed.rotation[eid] = read(Rotation, 'value', 0);
	computed.skewX[eid] = read(Skew, 'x', 0);
	computed.skewY[eid] = read(Skew, 'y', 0);
	computed.opacity[eid] = read(Opacity, 'value', 1);
	computed.color[eid] = read(Color, 'value', 0);
	computed.blur[eid] = read(Blur, 'value', 0);
	computed.volume[eid] = read(Volume, 'value', 0);
	computed.strokeWidth[eid] = read(StrokeStyle, 'width', 1);
	computed.cornerRadius[eid] = read(CornerRadius, 'value', 0);
	computed.cornerRadiusTopLeft[eid] = read(MixedCornerRadius, 'topLeft', 0);
	computed.cornerRadiusTopRight[eid] = read(MixedCornerRadius, 'topRight', 0);
	computed.cornerRadiusBottomRight[eid] = read(MixedCornerRadius, 'bottomRight', 0);
	computed.cornerRadiusBottomLeft[eid] = read(MixedCornerRadius, 'bottomLeft', 0);
	computed.stopOffset[eid] = read(ColorStop, 'offset', 0);
	computed.chars[eid] = read(Chars, 'value', '');

	if (entity.has(UniformScale) && ignore !== UniformScale) {
		computed.scaleX[eid] = read(UniformScale, 'value', 1);
		computed.scaleY[eid] = read(UniformScale, 'value', 1);
	} else {
		computed.scaleX[eid] = read(Scale, 'x', 1);
		computed.scaleY[eid] = read(Scale, 'y', 1);
	}
}

/** What a preset animation moves, as it stands before and after one plays. */
export type AnimationPose = {
	opacity: number;
	volume: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	offsetX: number;
	offsetY: number;
	blur: number;
	chars: string;
};

/**
 * Moves `pose` the way a preset animation does at the given normalized
 * progress. `text` is what the text presets reveal.
 */
export function poseAnimation(pose: AnimationPose, type: AnimationType | undefined, phase: AnimationPhase | undefined, progress: number, text: string): void {
	switch (type) {
		case AnimationType.FADE: {
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			pose.opacity = phase === AnimationPhase.OUT ? 1 - eased : eased;
			break;
		}
		case AnimationType.GAIN: {
			const func = cubicBezier(0.4, 0.095, 0.546, 0.875);
			const eased = clamp01(func(progress));
			const amplitude = phase === AnimationPhase.OUT ? 1 - eased : eased;
			pose.volume += amplitudeToDecibels(amplitude);
			break;
		}
		case AnimationType.GROW: {
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 - 0.5 * t;
			pose.scaleX = scale;
			pose.scaleY = scale;
			break;
		}
		case AnimationType.SHRINK: {
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 + 0.5 * t;
			pose.scaleX = scale;
			pose.scaleY = scale;
			break;
		}
		case AnimationType.BLUR: {
			const func = phase === AnimationPhase.OUT ? cubicBezier(0.4, 0, 1, 1) : cubicBezier(0.33, 0, 0.2, 1);
			const eased = clamp01(func(progress));
			pose.blur = phase === AnimationPhase.OUT ? lerp(0, 24, eased) : lerp(24, 0, eased);
			break;
		}
		case AnimationType.SLIDE_LEFT:
		case AnimationType.SLIDE_RIGHT:
		case AnimationType.SLIDE_UP:
		case AnimationType.SLIDE_DOWN: {
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;

			const sign = phase === AnimationPhase.OUT ? -1 : 1;
			if (type === AnimationType.SLIDE_LEFT) {
				pose.offsetX = sign * 100 * t;
			} else if (type === AnimationType.SLIDE_RIGHT) {
				pose.offsetX = sign * -100 * t;
			} else if (type === AnimationType.SLIDE_UP) {
				pose.offsetY = sign * 100 * t;
			} else if (type === AnimationType.SLIDE_DOWN) {
				pose.offsetY = sign * -100 * t;
			}
			pose.opacity = 1 - t;
			break;
		}
		case AnimationType.SPIN: {
			const func = cubicBezier(0.44, 0.02, 0.252, 0.992);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 - t;
			pose.scaleX = scale;
			pose.scaleY = scale;
			pose.rotation = -45 * t;
			break;
		}
		case AnimationType.TWIST: {
			const func = cubicBezier(0.1, 0.7, 0.5, 1);
			const eased = clamp01(func(progress));
			const t = phase === AnimationPhase.OUT ? eased : 1 - eased;
			const scale = 1 + t;
			pose.scaleX = scale;
			pose.scaleY = scale;
			pose.rotation = -10 * t;
			pose.offsetX = -30 * t;
			pose.offsetY = -30 * t;
			break;
		}
		case AnimationType.APPEAR_WORD: {
			const t = phase === AnimationPhase.OUT ? progress : 1 - progress;
			pose.chars = revealWords(text, 1 - t);
			break;
		}
		case AnimationType.APPEAR_CHAR: {
			const t = phase === AnimationPhase.OUT ? progress : 1 - progress;
			pose.chars = revealChars(text, 1 - t);
			break;
		}
		case AnimationType.SCRAMBLE: {
			const t = phase === AnimationPhase.OUT ? progress : 1 - progress;
			pose.chars = scrambleChars(text, 1 - t);
			break;
		}
		case AnimationType.POP: {
			const scale = popScale(progress, phase, 1.2);
			pose.scaleX = scale;
			pose.scaleY = scale;
			break;
		}
		case AnimationType.BOUNCE: {
			const scale = popScale(progress, phase, 1.35);
			pose.scaleX = scale;
			pose.scaleY = scale;
			break;
		}
	}
}

/**
 * Scale a word on the way TikTok captions do: grow past 1, settle back.
 * `overshoot` is how far past 1 it goes. Out shrinks to nothing.
 */
function popScale(progress: number, phase: AnimationPhase | undefined, overshoot: number): number {
	const t = clamp01(progress);
	if (phase === AnimationPhase.OUT) {
		const u = 1 - t;
		return u * u;
	}
	// Ease out to the overshoot, dip under 1, then settle — TikTok caption pop.
	if (t < 0.55) {
		const u = t / 0.55;
		const eased = 1 - (1 - u) * (1 - u) * (1 - u);
		return eased * overshoot;
	}
	if (t < 0.82) return overshoot - ((t - 0.55) / 0.27) * (overshoot - 0.92);
	return 0.92 + ((t - 0.82) / 0.18) * 0.08;
}

/**
 * Apply a preset animation to a node at the given normalized progress.
 */
function applyAnimation(world: World, entity: Entity, anim: Entity, progress: number) {
	const computed = store(world, Computed);
	const animation = store(world, Animation);
	const chars = store(world, Chars);
	const eid = entity.id();
	const aid = anim.id();

	const pose: AnimationPose = {
		opacity: computed.opacity[eid] ?? 1,
		volume: computed.volume[eid] ?? 0,
		scaleX: computed.scaleX[eid] ?? 1,
		scaleY: computed.scaleY[eid] ?? 1,
		rotation: computed.rotation[eid] ?? 0,
		offsetX: computed.offsetX[eid] ?? 0,
		offsetY: computed.offsetY[eid] ?? 0,
		blur: computed.blur[eid] ?? 0,
		chars: computed.chars[eid] ?? '',
	};
	poseAnimation(pose, animation.type[aid], animation.phase[aid], progress, chars.value[eid] ?? '');

	computed.opacity[eid] = pose.opacity;
	computed.volume[eid] = pose.volume;
	computed.scaleX[eid] = pose.scaleX;
	computed.scaleY[eid] = pose.scaleY;
	computed.rotation[eid] = pose.rotation;
	computed.offsetX[eid] = pose.offsetX;
	computed.offsetY[eid] = pose.offsetY;
	computed.blur[eid] = pose.blur;
	computed.chars[eid] = pose.chars;
}

function isWordPop(type: AnimationType | undefined): boolean {
	return type === AnimationType.POP || type === AnimationType.BOUNCE;
}

/** Plays one animation into `pose` for the window a word is spoken in. */
function playWordAnimation(
	pose: AnimationPose,
	type: AnimationType | undefined,
	phase: AnimationPhase | undefined,
	durationFrames: number,
	delayFrames: number,
	start: number,
	end: number,
	time: number,
	fps: number,
	/** Caption-level pop must not hide words that have not been said yet. */
	holdBefore: boolean,
): void {
	const duration = Math.min(durationFrames / fps, end - start);
	if (duration <= 0) return;
	const delay = delayFrames / fps;
	const isOut = phase === AnimationPhase.OUT;
	const windowStart = isOut ? end - duration - delay : start + delay;
	if (holdBefore && !isOut && time < windowStart) return;
	if (isOut ? time < windowStart : time >= windowStart + duration) return;
	const progress = clamp01((time - windowStart) / duration);
	poseAnimation(pose, type, phase, progress, '');
}

/**
 * Plays each caption word's own animations against the window it is spoken
 * in (see `WordTiming`), plus a pop or bounce authored on the caption itself
 * when the word has none of its own. Writes the pose into the range's
 * Computed. `time` is the caption's own, in seconds.
 */
export function animateCaptionWords(world: World, caption: Entity, time: number, fps: number): void {
	const cache = store(world, Cache);
	const ranges = cache.textRanges[caption.id()];
	if (!ranges?.length) return;

	const computed = store(world, Computed);
	const animation = store(world, Animation);
	const captionPops = (cache.animations[caption.id()] ?? []).filter((anim) =>
		isWordPop(animation.type[anim.id()]),
	);

	for (const range of ranges) {
		if (!range.has(WordTiming)) continue;
		const { start, end } = range.get(WordTiming)!;
		const rid = range.id();
		const own = cache.animations[rid] ?? [];

		const authoredX = range.has(Offset) ? range.get(Offset)!.x : 0;
		const authoredY = range.has(Offset) ? range.get(Offset)!.y : 0;
		const pose: AnimationPose = {
			opacity: 1,
			volume: 0,
			scaleX: 1,
			scaleY: 1,
			rotation: 0,
			offsetX: 0,
			offsetY: 0,
			blur: range.has(Blur) ? range.get(Blur)!.value : 0,
			chars: '',
		};

		for (const anim of own) {
			const aid = anim.id();
			playWordAnimation(
				pose,
				animation.type[aid],
				animation.phase[aid],
				animation.duration[aid] ?? 0,
				animation.delay[aid] ?? 0,
				start,
				end,
				time,
				fps,
				false,
			);
		}

		if (captionPops.length > 0 && !own.some((anim) => isWordPop(animation.type[anim.id()]))) {
			for (const anim of captionPops) {
				const aid = anim.id();
				playWordAnimation(
					pose,
					animation.type[aid],
					animation.phase[aid],
					animation.duration[aid] ?? 0,
					animation.delay[aid] ?? 0,
					start,
					end,
					time,
					fps,
					true,
				);
			}
		}

		// A word's own Scale is where it rests (a caption preset enlarging the
		// word being said), and its animations play on top of it.
		const rest = range.has(Scale) ? range.get(Scale)! : null;
		computed.opacity[rid] = pose.opacity * (range.has(Opacity) ? range.get(Opacity)!.value : 1);
		computed.scaleX[rid] = pose.scaleX * (rest?.x ?? 1);
		computed.scaleY[rid] = pose.scaleY * (rest?.y ?? 1);
		computed.rotation[rid] = pose.rotation;
		computed.offsetX[rid] = pose.offsetX + authoredX;
		computed.offsetY[rid] = pose.offsetY + authoredY;
		computed.blur[rid] = pose.blur;
	}
}

/**
 * Whether a node's in and out animations hold at rest this frame: in the
 * editor, while it is selected and its scene is paused, so it stays where it
 * sits, seen, and its box and a drag land where it is — not where a slide
 * has it at that frame, or invisible at a fade's first one. The playback
 * system shows such a node outside its time too. Playing and exports
 * animate it as ever.
 */
export function holdsAtRest(world: World, entity: Entity): boolean {
	if (!entity.has(Selected) || world.get(Mode)?.value !== 'realtime') return false;
	return !getSceneAncestor(entity)?.get(Playback)?.playing;
}

export function motionSystem(world: World): void {
	const computed = store(world, Computed);
	const cache = store(world, Cache);
	const animation = store(world, Animation);
	const keyframeTrack = store(world, KeyframeTrack);
	const worldProps = getPropertyPaths(world);

	for (const entity of world.query(
		Or(Geometry, Group, AdjustmentLayer), Not(Hidden), Not(Culled),
	)) {
		const eid = entity.id();

		if (computed.visibility[eid] === 0) continue;

		const animations = cache.animations[eid] ?? [];
		const keyframeTracks = cache.keyframeTracks[eid] ?? [];
		if (animations.length === 0 && keyframeTracks.length === 0) continue;

		resetAnimatedValues(world, entity);

		const source = getLocalWindow(entity);

		const localFrame = computed.localTime[eid];

		// 1: Preset animations (FADE/GAIN/GROW/SHRINK/BLUR/SLIDE)
		for (const anim of holdsAtRest(world, entity) ? [] : animations) {
			const aid = anim.id();
			// Pop / bounce on a caption play per word (see animateCaptionWords).
			if (entity.has(Caption) && isWordPop(animation.type[aid])) continue;
			const duration = animation.duration[aid] ?? 0;
			if (duration <= 0) continue;

			const delay = animation.delay[aid] ?? 0;
			const isOut = animation.phase[aid] === AnimationPhase.OUT;
			const windowStart = isOut
				? source.out - duration - delay
				: source.in + delay;
			const windowEnd = windowStart + duration;
			if (isOut ? localFrame < windowStart : localFrame >= windowEnd) continue;

			const progress = clamp01((localFrame - windowStart) / Math.max(1, duration - 1));
			applyAnimation(world, entity, anim, progress);
		}

		// 2: Keyframe tracks
		let uniformScale = entity.has(UniformScale);
		for (const track of keyframeTracks) {
			const tid = track.id();
			const property = keyframeTrack.property[tid] as PropertyPath;
			const target = keyframeTrack.target[tid];
			const keyframes = cache.keyframes[tid] ?? [];
			const result = sampleTrack(world, keyframes, localFrame, property);
			if (result === null || target == null) continue;
			worldProps[property].computed[target.id()] = result;
			// A 'scale' track is the uniform scale whether or not the node also
			// authors the prop, so it scales both axes like UniformScale does.
			if (property === 'scale' && target === entity) uniformScale = true;
		}

		// Uniform scale is authored/animated as scaleX only; mirror it onto scaleY.
		if (uniformScale) {
			computed.scaleY[eid] = computed.scaleX[eid];
		}
	}
}

/**
 * Keyframeable properties: dot-path string to the computed (per-frame
 * resolved) and authored (document) store arrays.
 */
export function getPropertyPaths(world: World) {
	const computed = store(world, Computed);
	return {
		'position.x': {
			computed: computed.positionX,
			authored: store(world, Position).x,
		},
		'position.y': {
			computed: computed.positionY,
			authored: store(world, Position).y,
		},
		'offset.x': {
			computed: computed.offsetX,
			authored: store(world, Offset).x,
		},
		'offset.y': {
			computed: computed.offsetY,
			authored: store(world, Offset).y,
		},
		'rotation': {
			computed: computed.rotation,
			authored: store(world, Rotation).value,
		},
		'scale.x': {
			computed: computed.scaleX,
			authored: store(world, Scale).x,
		},
		'scale.y': {
			computed: computed.scaleY,
			authored: store(world, Scale).y,
		},
		'scale': {
			computed: computed.scaleX,
			authored: store(world, UniformScale).value,
		},
		'skew.x': {
			computed: computed.skewX,
			authored: store(world, Skew).x,
		},
		'skew.y': {
			computed: computed.skewY,
			authored: store(world, Skew).y,
		},
		'width': {
			computed: computed.width,
			authored: store(world, Size).width,
		},
		'height': {
			computed: computed.height,
			authored: store(world, Size).height,
		},
		'opacity': {
			computed: computed.opacity,
			authored: store(world, Opacity).value,
		},
		'color': {
			computed: computed.color,
			authored: store(world, Color).value,
		},
		'blur': {
			computed: computed.blur,
			authored: store(world, Blur).value,
		},
		'volume': {
			computed: computed.volume,
			authored: store(world, Volume).value,
		},
		'playbackRate': {
			computed: computed.playbackRate,
			authored: store(world, PlaybackRate).value,
		},
		'effect.value': {
			computed: computed.value,
			authored: store(world, Effect).value,
		},
		'stroke.width': {
			computed: computed.strokeWidth,
			authored: store(world, StrokeStyle).width,
		},
		'vertexRadius': {
			computed: computed.cornerRadius,
			authored: store(world, CornerRadius).value,
		},
		'mixedVertexRadius.topLeft': {
			computed: computed.cornerRadiusTopLeft,
			authored: store(world, MixedCornerRadius).topLeft,
		},
		'mixedVertexRadius.topRight': {
			computed: computed.cornerRadiusTopRight,
			authored: store(world, MixedCornerRadius).topRight,
		},
		'mixedVertexRadius.bottomRight': {
			computed: computed.cornerRadiusBottomRight,
			authored: store(world, MixedCornerRadius).bottomRight,
		},
		'mixedVertexRadius.bottomLeft': {
			computed: computed.cornerRadiusBottomLeft,
			authored: store(world, MixedCornerRadius).bottomLeft,
		},
		'stop.offset': {
			computed: computed.stopOffset,
			authored: store(world, ColorStop).offset,
		},
		'chars': {
			computed: computed.chars,
			authored: store(world, Chars).value,
		},
	};
}

export type PropertyPath = keyof ReturnType<typeof getPropertyPaths>;

// ─── Easing ─────────────────────────────────────────────────

type EasingFunction = (t: number) => number;

const easingCache = new Map<string, EasingFunction>();

/**
 * Parse an easing descriptor string and return an easing function.
 * Returns null for empty/undefined (= default linear interpolation).
 * Supported formats:
 *   "steps(9)"  or "steps(9,true)"        → animejs steps(n, fromStart?)
 *   "cubicBezier(0.25,0.1,0.25,1)"       → animejs cubicBezier(x1,y1,x2,y2)
 *   "spring(0.5,500)"                     → animejs spring({ bounce, duration })
 */
function resolveEasing(descriptor: string | undefined): EasingFunction | null {
	if (!descriptor || descriptor === '') return null;

	const cached = easingCache.get(descriptor);
	if (cached) return cached;

	let fn: EasingFunction | null = null;

	const stepsMatch = descriptor.match(/^steps\((\d+)(?:,(true|false))?\)$/);
	if (stepsMatch) {
		const n = Number.parseInt(stepsMatch[1]!, 10);
		const fromStart = stepsMatch[2] === 'true';
		fn = steps(n, fromStart);
	}

	const bezierMatch = descriptor.match(/^cubicBezier\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)$/);
	if (bezierMatch) {
		const [, x1, y1, x2, y2] = bezierMatch;
		fn = cubicBezier(Number(x1), Number(y1), Number(x2), Number(y2));
	}

	const springMatch = descriptor.match(/^spring\(([\d.-]+),([\d.-]+)\)$/);
	if (springMatch) {
		const [, bounce, duration] = springMatch;
		const s = spring({
			bounce: Number(bounce),
			duration: Number(duration),
		});
		fn = (t: number) => s.ease(t);
	}

	if (fn) {
		easingCache.set(descriptor, fn);
		return fn;
	}

	return null;
}

/**
 * Sample a presorted aggregated keyframe track at a local frame.
 * Returns null only if the track has no keyframes.
 */
function sampleTrack(
	world: World,
	keyframes: Entity[],
	frame: number,
	property: PropertyPath,
): number | null {
	const keyframe = store(world, Keyframe);
	if (keyframes.length === 0) return null;

	if (keyframes.length === 1) {
		return keyframe.value[keyframes[0]!.id()]!;
	}

	const firstValue = keyframe.value[keyframes[0]!.id()]!;
	const lastValue = keyframe.value[keyframes[keyframes.length - 1]!.id()]!;

	const firstFrame = keyframe.time[keyframes[0]!.id()]!;
	const lastFrame = keyframe.time[keyframes[keyframes.length - 1]!.id()]!;

	if (frame <= firstFrame) {
		return firstValue;
	}

	if (frame >= lastFrame) {
		return lastValue;
	}

	for (let i = 0; i < keyframes.length - 1; i++) {
		const start = keyframe.time[keyframes[i]!.id()]!;
		const end = keyframe.time[keyframes[i + 1]!.id()]!;
		if (frame < start || frame > end) continue;

		const span = end - start;
		if (span <= 0) continue;

		let progress = Math.max(0, Math.min(1, (frame - start) / span));

		const easingFn = resolveEasing(keyframe.easing[keyframes[i]!.id()]);
		if (easingFn) {
			progress = easingFn(progress);
		}

		const startValue = keyframe.value[keyframes[i]!.id()]!;
		const endValue = keyframe.value[keyframes[i + 1]!.id()]!;

		if (property === 'color') {
			return lerpColor(startValue, endValue, progress);
		}

		// Linear interpolation
		return startValue + (endValue - startValue) * progress;
	}

	return lastValue;
}

/**
 * Channel-wise linear interpolation between two packed 0xRRGGBB colors.
 * Linear interpolation on the packed integer bleeds bits between channels
 * and produces wrong intermediate hues.
 */
function lerpColor(from: number, to: number, progress: number): number {
	const r0 = (from >> 16) & 0xFF;
	const g0 = (from >> 8) & 0xFF;
	const b0 = from & 0xFF;
	const r1 = (to >> 16) & 0xFF;
	const g1 = (to >> 8) & 0xFF;
	const b1 = to & 0xFF;
	const r = Math.round(r0 + (r1 - r0) * progress);
	const g = Math.round(g0 + (g1 - g0) * progress);
	const b = Math.round(b0 + (b1 - b0) * progress);
	return (r << 16) | (g << 8) | b;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

/**
 * An amplitude multiplier (0-1) as the decibels to add to a volume. Silence
 * is -Infinity, which is what the audio bus reads as a gain of zero; every
 * other value is negative, so a ramp only ever attenuates.
 */
function amplitudeToDecibels(amplitude: number): number {
	return amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude);
}

function lerp(from: number, to: number, progress: number): number {
	return from + (to - from) * progress;
}
