/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * An effect keeps no settings of its own: `effectOf` reads them back from what
 * it drew. Each add or change must be one synchronous burst so it undoes in one step.
 */

import { createStore } from 'solid-js/store';
import { AdjustmentLayer, ColorStop, Effect, Group, Keyframe, KeyframeTrack, RadialGradientPaint, Rect, authoredElement } from '@plan.video/reconciler';
import {
	Cache,
	Computed,
	FrameRate,
	Geometry,
	Keyframe as KeyframeTrait,
	getActiveEntity,
	getParentNode,
	getSourceFrameAt,
	getTimelineOrigin,
	isAdjustmentLayer,
	isGroup,
	isScene,
	isShape,
	parseColor,
	rateAtSource,
	readSpeedCurve,
	sourceFrameAtTimeline,
	store,
	timelineOffsetAtSource,
	type SpeedCurve,
} from '@plan.video/runtime';

import {
	AUTO_ZOOM_NAME,
	DEFAULT_AUTO_ZOOM,
	autoZoomTarget,
	layersOver,
	pivotOf,
	siblingBefore,
	slotOf,
	type AutoZoomOptions,
	type ZoomStrength,
} from './auto-zoom';
import { getDocumentEditor } from './editor';
import { findKeyframeTrack } from './keyframes';
import { authoredTime, editTime } from './timing';

import type { AnimatableProperty, Easing } from '@plan.video/jsx';
import type { Entity, World } from 'koota';

export type EffectKind =
	| 'zoomIn' | 'slowZoom' | 'autoZoom' | 'zoomBlur' | 'shake' | 'handheld' | 'pulse' | 'slowMotion'
	| 'flash' | 'fade' | 'glitch' | 'blur'
	| 'rgbSplit' | 'glow' | 'lightLeak' | 'vignette' | 'blackWhite' | 'bars';

export type Strength = 'subtle' | 'medium' | 'strong';
export type Tempo = 'slow' | 'normal' | 'fast';
/** Seconds, or until the clip under it ends. */
type Span = number | 'clip';

export interface EffectOptions {
	zoomIn: { strength: Strength; motion: 'snap' | 'smooth'; length: number };
	slowZoom: { direction: 'in' | 'out'; strength: Strength; length: number | 'clip' };
	autoZoom: AutoZoomOptions;
	shake: { strength: Strength; length: number };
	flash: { color: 'white' | 'black'; length: number };
	blur: { direction: 'in' | 'out'; strength: Strength; length: number };
	slowMotion: { speed: number; length: number; ramp: 'snap' | 'smooth' };
	bars: { size: Strength; length: number | 'scene' };
	zoomBlur: { strength: Strength; length: number };
	handheld: { strength: Strength; length: Span };
	pulse: { strength: Strength; tempo: Tempo; length: Span };
	fade: { direction: 'in' | 'out'; color: 'white' | 'black'; length: number };
	glitch: { strength: Strength; length: number };
	rgbSplit: { strength: Strength; length: Span };
	glow: { strength: Strength; length: Span };
	blackWhite: { length: Span };
	lightLeak: { color: 'warm' | 'pink'; length: number };
	vignette: { strength: Strength; length: number | 'scene' };
}

export const DEFAULT_EFFECTS: EffectOptions = {
	zoomIn: { strength: 'medium', motion: 'smooth', length: 2 },
	slowZoom: { direction: 'in', strength: 'medium', length: 'clip' },
	autoZoom: { ...DEFAULT_AUTO_ZOOM },
	shake: { strength: 'medium', length: 1 },
	flash: { color: 'white', length: 0.5 },
	blur: { direction: 'in', strength: 'medium', length: 1 },
	slowMotion: { speed: 0.5, length: 2, ramp: 'smooth' },
	bars: { size: 'medium', length: 'scene' },
	zoomBlur: { strength: 'medium', length: 0.5 },
	handheld: { strength: 'medium', length: 'clip' },
	pulse: { strength: 'medium', tempo: 'normal', length: 4 },
	fade: { direction: 'in', color: 'black', length: 1 },
	glitch: { strength: 'medium', length: 1 },
	rgbSplit: { strength: 'medium', length: 'clip' },
	glow: { strength: 'medium', length: 'clip' },
	blackWhite: { length: 'clip' },
	lightLeak: { color: 'warm', length: 2 },
	vignette: { strength: 'medium', length: 'scene' },
};

export const [effectDefaults, setEffectDefaults] = createStore<EffectOptions>(structuredClone(DEFAULT_EFFECTS));

/** `effectOf` recognises effects by these timeline names. */
export const EFFECT_NAMES: Record<Exclude<EffectKind, 'slowMotion'>, string> = {
	zoomIn: 'Zoom in',
	slowZoom: 'Slow zoom',
	autoZoom: AUTO_ZOOM_NAME,
	shake: 'Shake',
	flash: 'Flash',
	blur: 'Blur',
	bars: 'Cinematic bars',
	zoomBlur: 'Zoom blur',
	handheld: 'Handheld',
	pulse: 'Pulse',
	fade: 'Fade',
	glitch: 'Glitch',
	rgbSplit: 'RGB split',
	glow: 'Glow',
	blackWhite: 'Black and white',
	lightLeak: 'Light leak',
	vignette: 'Vignette',
};

const ZOOM_SCALES: Record<Strength, number> = { subtle: 1.12, medium: 1.25, strong: 1.45 };
const SLOW_ZOOM_SCALES: Record<Strength, number> = { subtle: 1.06, medium: 1.12, strong: 1.2 };
/** Must match engine/auto-zoom's scales. */
const AUTO_ZOOM_SCALES: Record<ZoomStrength, number> = { subtle: 1.1, medium: 1.2, strong: 1.35 };
/** `move` is a share of the short side; `scale` zooms in enough to hide the edges. */
const SHAKES: Record<Strength, { move: number; turn: number; scale: number }> = {
	subtle: { move: 0.008, turn: 0.4, scale: 1.04 },
	medium: { move: 0.016, turn: 0.8, scale: 1.07 },
	strong: { move: 0.03, turn: 1.5, scale: 1.12 },
};
/** Blur radius on a frame whose short side is 1080. */
const BLURS: Record<Strength, number> = { subtle: 8, medium: 18, strong: 36 };
/** Each bar's height, as a share of the frame's. */
const BARS: Record<Strength, number> = { subtle: 0.07, medium: 0.1, strong: 0.13 };
const ZOOM_BLURS: Record<Strength, { scale: number; blur: number }> = {
	subtle: { scale: 1.12, blur: 6 },
	medium: { scale: 1.25, blur: 12 },
	strong: { scale: 1.45, blur: 22 },
};
/** Slow drift like a camera held by hand; `scale` hides the edges. */
const HANDHELDS: Record<Strength, { move: number; turn: number; scale: number }> = {
	subtle: { move: 0.006, turn: 0.3, scale: 1.03 },
	medium: { move: 0.012, turn: 0.6, scale: 1.05 },
	strong: { move: 0.022, turn: 1.1, scale: 1.09 },
};
const PULSES: Record<Strength, number> = { subtle: 1.04, medium: 1.08, strong: 1.14 };
/** Seconds between beats. */
const TEMPOS: Record<Tempo, number> = { slow: 1, normal: 0.5, fast: 0.25 };
/** In px on a frame whose short side is 1080: how far red and blue part. */
const GLITCHES: Record<Strength, number> = { subtle: 8, medium: 16, strong: 30 };
const RGB_SPLITS: Record<Strength, number> = { subtle: 3, medium: 6, strong: 12 };
const GLOWS: Record<Strength, number> = { subtle: 6, medium: 12, strong: 24 };
const VIGNETTES: Record<Strength, number> = { subtle: 0.45, medium: 0.7, strong: 0.95 };
/** Two soft lights each, one wide and one smaller, drifting past each other. */
const LEAKS: Record<'warm' | 'pink', [string, string]> = { warm: ['#FF8A3D', '#FF4D6D'], pink: ['#FF5C8A', '#9D5CFF'] };
const LEAK_NAMES: Record<'warm' | 'pink', string> = { warm: 'Warm light', pink: 'Pink light' };
export const SLOW_SPEEDS = [0.25, 0.5, 0.75];
const RAMP = 0.35;
const BAR_RAMP = 0.5;
/** In seconds of footage. */
const SPEED_RAMP = 0.3;

export type EffectFailure = 'no-clip' | 'no-scene' | 'no-video' | 'too-short';
export type EffectResult = { ok: true; entity: Entity } | { ok: false; reason: EffectFailure };

export type FoundEffect = {
	[K in EffectKind]: { kind: K; entity: Entity; options: EffectOptions[K] };
}[EffectKind];

type Place = { start: number; anchor: Entity | undefined };

/** Auto zoom listens to the clip first, so it has its own `addAutoZoom`. */
export function addEffect(world: World, kind: Exclude<EffectKind, 'autoZoom'>): EffectResult {
	const options = { ...effectDefaults[kind] };
	switch (kind) {
		case 'flash':
			return drawFlash(world, options as EffectOptions['flash']);
		case 'bars':
			return drawBars(world, options as EffectOptions['bars']);
		case 'fade':
			return drawFade(world, options as EffectOptions['fade']);
		case 'lightLeak':
			return drawLightLeak(world, options as EffectOptions['lightLeak']);
		case 'vignette':
			return drawVignette(world, options as EffectOptions['vignette']);
		case 'slowMotion':
			return addSlowMotion(world, options as EffectOptions['slowMotion']);
		default: {
			const target = autoZoomTarget(world);
			if (!target) return { ok: false, reason: 'no-clip' };
			return drawLayer(world, kind, options as never, slotOf(target));
		}
	}
}

/** Auto zoom listens again, so it goes through `addAutoZoom` instead. */
export function updateEffect<K extends Exclude<EffectKind, 'autoZoom'>>(world: World, found: FoundEffect & { kind: K }, options: EffectOptions[K]): EffectResult {
	setEffectDefaults(found.kind, { ...options } as never);
	const entity = found.entity;

	if (found.kind === 'slowMotion') {
		const stretch = slowStretch(world, entity);
		if (!stretch) return { ok: false, reason: 'no-clip' };
		return writeSlowMotion(world, entity, options as EffectOptions['slowMotion'], stretch);
	}

	const place: Place = { start: Math.round(entity.get(Computed)?.start ?? 0), anchor: nextSibling(entity) };
	const editor = getDocumentEditor(world);

	const overlay = OVERLAYS[found.kind as OverlayKind];
	if (overlay) {
		editor.remove(entity);
		return overlay(world, options as never, place);
	}

	const clip = siblingBefore(entity);
	if (!clip) return { ok: false, reason: 'no-clip' };
	editor.remove(entity);
	return drawLayer(world, found.kind as LayerKind, options as never, slotOf(clip), place);
}

export function removeEffect(world: World, found: FoundEffect): void {
	const editor = getDocumentEditor(world);
	if (found.kind !== 'slowMotion') return void editor.remove(found.entity);

	const stretch = slowStretch(world, found.entity);
	if (stretch) writeSlowMotion(world, found.entity, null, stretch);
}

type OverlayKind = 'flash' | 'bars' | 'fade' | 'lightLeak' | 'vignette';

/** Drawn over the whole scene rather than over one clip. */
const OVERLAYS: { [K in OverlayKind]: (world: World, options: EffectOptions[K], place?: Place) => EffectResult } = {
	flash: (world, options, place) => drawFlash(world, options, place),
	bars: (world, options, place) => drawBars(world, options, place),
	fade: (world, options, place) => drawFade(world, options, place),
	lightLeak: (world, options, place) => drawLightLeak(world, options, place),
	vignette: (world, options, place) => drawVignette(world, options, place),
};

type LayerKind = 'zoomIn' | 'slowZoom' | 'shake' | 'blur' | 'zoomBlur' | 'handheld' | 'pulse' | 'glitch' | 'rgbSplit' | 'glow' | 'blackWhite';

function drawLayer<K extends LayerKind>(world: World, kind: K, options: EffectOptions[K], slot: Entity, place?: Place): EffectResult {
	const parent = getParentNode(slot);
	if (!parent) return { ok: false, reason: 'no-clip' };

	const fps = fpsOf(world);
	const computed = store(world, Computed);
	const clipStart = computed.start[slot.id()] ?? 0;
	const clipEnd = computed.end[slot.id()] ?? 0;
	const toEnd = ('length' in options && options.length === 'clip') || (kind === 'blur' && (options as EffectOptions['blur']).direction === 'out');
	const length = toEnd ? clipEnd - clipStart : Math.round((options.length as number) * fps);
	const [start, end] = windowAt(place?.start ?? playheadOf(world), clipStart, clipEnd, length, toEnd);
	if (end - start < 2) return { ok: false, reason: 'too-short' };

	const seconds = (end - start) / fps;
	const pivot = pivotOf(world, slot, parent);
	const short = Math.min(pivot.width, pivot.height);
	const origin = computed.origin[parent.id()] ?? 0;
	const props = {
		name: EFFECT_NAMES[kind],
		start: round((start - origin) / fps),
		end: round((end - origin) / fps),
		width: pivot.width,
		height: pivot.height,
	};

	const editor = getDocumentEditor(world);
	const [layer] = editor.insertElement(
		parent,
		() => {
			switch (kind) {
				case 'zoomIn': {
					const { strength, motion } = options as EffectOptions['zoomIn'];
					const scale = ZOOM_SCALES[strength];
					// A snap is a punch-in cut: the layer's window is the zoom.
					if (motion === 'snap') return <AdjustmentLayer {...props} scale={scale} />;
					const ramp = Math.min(RAMP, seconds / 3);
					return (
						<AdjustmentLayer {...props}>
							<Track property="scale" keys={[[0, 1, 'easeInOut'], [ramp, scale], [seconds - ramp, scale, 'easeInOut'], [seconds, 1]]} />
						</AdjustmentLayer>
					);
				}
				case 'slowZoom': {
					const { direction, strength } = options as EffectOptions['slowZoom'];
					const scale = SLOW_ZOOM_SCALES[strength];
					const [from, to] = direction === 'in' ? [1, scale] : [scale, 1];
					return (
						<AdjustmentLayer {...props}>
							<Track property="scale" keys={[[0, from, 'easeInOut'], [seconds, to]]} />
						</AdjustmentLayer>
					);
				}
				case 'shake': {
					const shake = SHAKES[(options as EffectOptions['shake']).strength];
					const keys = shakeKeys(seconds, fps, shake.move * short, shake.turn);
					const zoomIn = Math.min(2 / fps, seconds / 4);
					return (
						<AdjustmentLayer {...props}>
							<Track property="scale" keys={[[0, 1], [zoomIn, shake.scale], [seconds - zoomIn, shake.scale], [seconds, 1]]} />
							<Track property="x" keys={keys.x} />
							<Track property="y" keys={keys.y} />
							<Track property="rotation" keys={keys.rotation} />
						</AdjustmentLayer>
					);
				}
				case 'blur': {
					const { direction, strength, length: ramp } = options as EffectOptions['blur'];
					const amount = Math.round((BLURS[strength] * short) / 1080);
					const span = Math.min(ramp, seconds);
					const keys: TrackKey[] = direction === 'in'
						? [[0, amount, 'easeOut'], [span, 0]]
						: [[0, 0, 'easeIn'], [span, amount]];
					return (
						<AdjustmentLayer {...props}>
							<Effect type="blur" value={keys[0]![1]}>
								<Track property="value" keys={keys} />
							</Effect>
						</AdjustmentLayer>
					);
				}
				case 'zoomBlur': {
					const { scale, blur } = ZOOM_BLURS[(options as EffectOptions['zoomBlur']).strength];
					const amount = Math.round((blur * short) / 1080);
					const peak = seconds * 0.45;
					return (
						<AdjustmentLayer {...props}>
							<Track property="scale" keys={[[0, 1, 'easeIn'], [peak, scale, 'easeOut'], [seconds, 1]]} />
							<Effect type="blur" value={0}>
								<Track property="value" keys={[[0, 0, 'easeIn'], [peak, amount, 'easeOut'], [seconds, 0]]} />
							</Effect>
						</AdjustmentLayer>
					);
				}
				case 'handheld': {
					const hand = HANDHELDS[(options as EffectOptions['handheld']).strength];
					const keys = driftKeys(seconds, hand.move * short, hand.turn);
					return (
						<AdjustmentLayer {...props} scale={hand.scale}>
							<Track property="x" keys={keys.x} />
							<Track property="y" keys={keys.y} />
							<Track property="rotation" keys={keys.rotation} />
						</AdjustmentLayer>
					);
				}
				case 'pulse': {
					const { strength, tempo } = options as EffectOptions['pulse'];
					return (
						<AdjustmentLayer {...props}>
							<Track property="scale" keys={pulseKeys(seconds, fps, PULSES[strength], TEMPOS[tempo])} />
						</AdjustmentLayer>
					);
				}
				case 'glitch': {
					const amount = Math.round((GLITCHES[(options as EffectOptions['glitch']).strength] * short) / 1080);
					const keys = glitchKeys(seconds, fps, amount);
					return (
						<AdjustmentLayer {...props} scale={1.03}>
							<Track property="x" keys={keys.x} />
							<Effect type="rgbSplit" value={0}>
								<Track property="value" keys={keys.split} />
							</Effect>
						</AdjustmentLayer>
					);
				}
				case 'rgbSplit':
				case 'glow': {
					const table = kind === 'glow' ? GLOWS : RGB_SPLITS;
					const amount = Math.max(1, Math.round((table[(options as EffectOptions['glow']).strength] * short) / 1080));
					return (
						<AdjustmentLayer {...props}>
							<Effect type={kind} value={amount} />
						</AdjustmentLayer>
					);
				}
				case 'blackWhite':
					return (
						<AdjustmentLayer {...props}>
							<Effect type="grayscale" value={1} />
						</AdjustmentLayer>
					);
			}
		},
		place ? place.anchor : layerAnchor(slot),
	);
	if (!layer) return { ok: false, reason: 'no-clip' };

	// Expanded so the keyframes show on the timeline.
	const still = (kind === 'zoomIn' && (options as EffectOptions['zoomIn']).motion === 'snap') || kind === 'rgbSplit' || kind === 'glow' || kind === 'blackWhite';
	if (!still) editor.editProperty(layer, 'expanded', true);
	editor.select(layer);
	return { ok: true, entity: layer };
}

function layerAnchor(slot: Entity): Entity | undefined {
	const siblings = getParentNode(slot)?.get(Cache)?.children ?? [];
	return siblings[siblings.indexOf(slot) + layersOver(slot).length + 1];
}

/** Fixed seed so the same shake comes out each time. */
function shakeKeys(seconds: number, fps: number, move: number, turn: number) {
	const step = Math.max(1, Math.round(fps / 15)) / fps;
	const random = seeded(7);
	const x: TrackKey[] = [];
	const y: TrackKey[] = [];
	const rotation: TrackKey[] = [];
	for (let time = 0; time < seconds; time += step) {
		const progress = time / seconds;
		const envelope = progress < 0.2 ? 1 : Math.pow(1 - (progress - 0.2) / 0.8, 1.5);
		x.push([time, Math.round((random() * 2 - 1) * move * envelope * 10) / 10, 'easeInOut']);
		y.push([time, Math.round((random() * 2 - 1) * move * envelope * 10) / 10, 'easeInOut']);
		rotation.push([time, Math.round((random() * 2 - 1) * turn * envelope * 100) / 100, 'easeInOut']);
	}
	x.push([seconds, 0]);
	y.push([seconds, 0]);
	rotation.push([seconds, 0]);
	return { x, y, rotation };
}

/** A slow wander, one move every 0.6s, that starts and ends at rest. */
function driftKeys(seconds: number, move: number, turn: number) {
	const random = seeded(23);
	const x: TrackKey[] = [[0, 0, 'easeInOut']];
	const y: TrackKey[] = [[0, 0, 'easeInOut']];
	const rotation: TrackKey[] = [[0, 0, 'easeInOut']];
	const steps = Math.max(1, Math.round(seconds / 0.6));
	for (let index = 1; index < steps; index++) {
		const time = (seconds * index) / steps;
		x.push([time, Math.round((random() * 2 - 1) * move * 10) / 10, 'easeInOut']);
		y.push([time, Math.round((random() * 2 - 1) * move * 10) / 10, 'easeInOut']);
		rotation.push([time, Math.round((random() * 2 - 1) * turn * 100) / 100, 'easeInOut']);
	}
	x.push([seconds, 0]);
	y.push([seconds, 0]);
	rotation.push([seconds, 0]);
	return { x, y, rotation };
}

/** A punch in on each beat that eases back before the next. */
function pulseKeys(seconds: number, fps: number, peak: number, every: number): TrackKey[] {
	const keys: TrackKey[] = [];
	for (let beat = 0; beat < seconds - 1e-6; beat += every) {
		keys.push([beat, peak, 'easeOut']);
		const rest = Math.min(beat + every - 1 / fps, seconds);
		if (rest > beat + 1e-6) keys.push([rest, 1]);
	}
	if ((keys.at(-1)?.[0] ?? 0) < seconds - 1e-6) keys.push([seconds, 1]);
	return keys;
}

/** Bursts of colour split and sideways jumps that hold for a few frames each. Fixed seed, so it comes out the same. */
function glitchKeys(seconds: number, fps: number, amount: number) {
	const step = Math.max(1, Math.round(fps / 12)) / fps;
	const random = seeded(11);
	const split: TrackKey[] = [];
	const x: TrackKey[] = [];
	for (let time = 0; time < seconds - 1e-6; time += step) {
		const burst = time > 0 && random() < 0.6;
		const value = burst ? Math.round(amount * (0.35 + 0.65 * random())) : 0;
		const shift = burst && random() < 0.5 ? Math.round((random() * 2 - 1) * amount * 0.8) : 0;
		const hold = Math.min(time + step - 1 / fps, seconds);
		split.push([time, value, 'linear']);
		x.push([time, shift, 'linear']);
		if (hold > time + 1e-6) {
			split.push([hold, value, 'linear']);
			x.push([hold, shift, 'linear']);
		}
	}
	split.push([seconds, 0]);
	x.push([seconds, 0]);
	return { split: dedupe(split), x: dedupe(x) };
}

/** Keeps the last key at each time. */
function dedupe(keys: TrackKey[]): TrackKey[] {
	const kept: TrackKey[] = [];
	for (const key of keys) {
		if (kept.length > 0 && Math.abs(kept[kept.length - 1]![0] - key[0]) < 1e-4) kept[kept.length - 1] = key;
		else kept.push(key);
	}
	return kept;
}

function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function drawFlash(world: World, options: EffectOptions['flash'], place?: Place): EffectResult {
	const scene = activeScene(world);
	if (!scene) return { ok: false, reason: 'no-scene' };

	const fps = fpsOf(world);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const seconds = options.length;
	const peak = Math.min(2 / fps, seconds / 4);

	const editor = getDocumentEditor(world);
	const [flash] = editor.insertElement(
		scene,
		() => (
			<Rect
				name={EFFECT_NAMES.flash}
				x={0}
				y={0}
				width={width}
				height={height}
				start={round(start / fps)}
				end={round(start / fps + seconds)}
				fill={options.color === 'white' ? '#FFFFFF' : '#000000'}
				opacity={0}
			>
				<Track property="opacity" keys={[[0, 0], [peak, 1, 'easeOut'], [seconds, 0]]} />
			</Rect>
		),
		place?.anchor,
	);
	if (!flash) return { ok: false, reason: 'no-scene' };

	editor.editProperty(flash, 'expanded', true);
	editor.select(flash);
	return { ok: true, entity: flash };
}

function drawBars(world: World, options: EffectOptions['bars'], place?: Place): EffectResult {
	const scene = activeScene(world);
	if (!scene) return { ok: false, reason: 'no-scene' };

	const fps = fpsOf(world);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const toEnd = options.length === 'scene';
	const end = toEnd ? sceneEnd(world, scene, start) : start + Math.round((options.length as number) * fps);
	if (end - start < 2) return { ok: false, reason: 'too-short' };

	const seconds = (end - start) / fps;
	const bar = Math.round(height * BARS[options.size]);
	const ramp = Math.min(BAR_RAMP, seconds / 3);
	const grow: TrackKey[] = toEnd
		? [[0, 0, 'easeInOut'], [ramp, bar]]
		: [[0, 0, 'easeInOut'], [ramp, bar], [seconds - ramp, bar, 'easeInOut'], [seconds, 0]];
	const drop: TrackKey[] = grow.map(([time, value, easing]) => [time, height - value, easing]);

	const editor = getDocumentEditor(world);
	const [group] = editor.insertElement(
		scene,
		() => (
			<Group name={EFFECT_NAMES.bars} start={round(start / fps)}>
				<Rect name="Top bar" x={0} y={0} width={width} height={0} end={round(seconds)} fill="#000000">
					<Track property="height" keys={grow} />
				</Rect>
				<Rect name="Bottom bar" x={0} y={height} width={width} height={0} end={round(seconds)} fill="#000000">
					<Track property="y" keys={drop} />
					<Track property="height" keys={grow} />
				</Rect>
			</Group>
		),
		place?.anchor,
	);
	if (!group) return { ok: false, reason: 'no-scene' };

	editor.select(group);
	return { ok: true, entity: group };
}

function drawFade(world: World, options: EffectOptions['fade'], place?: Place): EffectResult {
	const scene = activeScene(world);
	if (!scene) return { ok: false, reason: 'no-scene' };

	const fps = fpsOf(world);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const seconds = options.length;
	const out = options.direction === 'out';
	// A fade out stays faded to the end of the scene.
	const end = out ? Math.max(sceneEnd(world, scene, start), start + Math.round(seconds * fps)) : start + Math.round(seconds * fps);
	const keys: TrackKey[] = out ? [[0, 0, 'easeInOut'], [seconds, 1]] : [[0, 1, 'easeInOut'], [seconds, 0]];

	const editor = getDocumentEditor(world);
	const [fade] = editor.insertElement(
		scene,
		() => (
			<Rect
				name={EFFECT_NAMES.fade}
				x={0}
				y={0}
				width={width}
				height={height}
				start={round(start / fps)}
				end={round(end / fps)}
				fill={options.color === 'white' ? '#FFFFFF' : '#000000'}
				opacity={keys[0]![1]}
			>
				<Track property="opacity" keys={keys} />
			</Rect>
		),
		place?.anchor,
	);
	if (!fade) return { ok: false, reason: 'no-scene' };

	editor.editProperty(fade, 'expanded', true);
	editor.select(fade);
	return { ok: true, entity: fade };
}

function drawLightLeak(world: World, options: EffectOptions['lightLeak'], place?: Place): EffectResult {
	const scene = activeScene(world);
	if (!scene) return { ok: false, reason: 'no-scene' };

	const fps = fpsOf(world);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const seconds = options.length;
	const [main, second] = LEAKS[options.color];
	const big = Math.round(Math.max(width, height) * 1.3);
	const small = Math.round(Math.max(width, height) * 0.8);
	const glow = (peak: number): TrackKey[] => [[0, 0, 'easeInOut'], [seconds * 0.4, peak, 'easeInOut'], [seconds, 0]];
	const Light = (props: { name: string; size: number; color: string; y: number; from: number; to: number; peak: number }) => (
		<Rect name={props.name} x={props.from} y={props.y} width={props.size} height={props.size} end={round(seconds)} opacity={0} blendMode="screen">
			<RadialGradientPaint>
				<ColorStop offset={0} color={props.color} opacity={0.95} />
				<ColorStop offset={0.45} color={props.color} opacity={0.45} />
				<ColorStop offset={1} color={props.color} opacity={0} />
			</RadialGradientPaint>
			<Track property="x" keys={[[0, props.from, 'easeInOut'], [seconds, props.to]]} />
			<Track property="opacity" keys={glow(props.peak)} />
		</Rect>
	);

	const editor = getDocumentEditor(world);
	const [group] = editor.insertElement(
		scene,
		() => (
			<Group name={EFFECT_NAMES.lightLeak} start={round(start / fps)}>
				<Light name={LEAK_NAMES[options.color]} size={big} color={main} y={Math.round(-big * 0.35)} from={Math.round(-big * 0.6)} to={Math.round(width - big * 0.45)} peak={1} />
				<Light name={LEAK_NAMES[options.color]} size={small} color={second} y={Math.round(height - small * 0.6)} from={Math.round(width - small * 0.3)} to={Math.round(-small * 0.3)} peak={0.8} />
			</Group>
		),
		place?.anchor,
	);
	if (!group) return { ok: false, reason: 'no-scene' };

	editor.select(group);
	return { ok: true, entity: group };
}

function drawVignette(world: World, options: EffectOptions['vignette'], place?: Place): EffectResult {
	const scene = activeScene(world);
	if (!scene) return { ok: false, reason: 'no-scene' };

	const fps = fpsOf(world);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const end = options.length === 'scene' ? sceneEnd(world, scene, start) : start + Math.round(options.length * fps);
	if (end - start < 2) return { ok: false, reason: 'too-short' };

	// A circle reaching the corners, so wide and tall frames darken alike.
	const size = Math.round(Math.hypot(width, height));
	const editor = getDocumentEditor(world);
	const [vignette] = editor.insertElement(
		scene,
		() => (
			<Rect
				name={EFFECT_NAMES.vignette}
				x={Math.round((width - size) / 2)}
				y={Math.round((height - size) / 2)}
				width={size}
				height={size}
				start={round(start / fps)}
				end={round(end / fps)}
				opacity={VIGNETTES[options.strength]}
			>
				<RadialGradientPaint>
					<ColorStop offset={0} color="#000000" opacity={0} />
					<ColorStop offset={0.4} color="#000000" opacity={0} />
					<ColorStop offset={1} color="#000000" opacity={1} />
				</RadialGradientPaint>
			</Rect>
		),
		place?.anchor,
	);
	if (!vignette) return { ok: false, reason: 'no-scene' };

	editor.select(vignette);
	return { ok: true, entity: vignette };
}

/** In the scene's frames; an empty scene gets five seconds. */
function sceneEnd(world: World, scene: Entity, start: number): number {
	const computed = store(world, Computed);
	return computed.empty[scene.id()] ? start + 5 * fpsOf(world) : (computed.duration[scene.id()] ?? 0);
}

/** Keys in source frames. */
type Stretch = { before: number; from: number; to: number; after: number };

function addSlowMotion(world: World, options: EffectOptions['slowMotion']): EffectResult {
	const target = autoZoomTarget(world);
	if (!target) return { ok: false, reason: 'no-clip' };
	if (!target.has(Geometry)) return { ok: false, reason: 'no-video' };

	const computed = store(world, Computed);
	const clipStart = computed.start[target.id()] ?? 0;
	const clipEnd = computed.end[target.id()] ?? 0;
	const playhead = playheadOf(world);
	const at = playhead >= clipStart && playhead < clipEnd ? playhead : clipStart;
	return writeSlowMotion(world, target, options, null, getSourceFrameAt(target, at));
}

/**
 * Other slow-downs on the track stay. A clip that authors its end is resized
 * by as much as the change adds or saves, so the footage after it still plays
 * to the same last frame.
 */
function writeSlowMotion(world: World, clip: Entity, options: EffectOptions['slowMotion'] | null, replacing: Stretch | null, from = replacing?.from ?? 0): EffectResult {
	const fps = fpsOf(world);
	const computed = store(world, Computed);
	const clipEnd = computed.end[clip.id()] ?? 0;
	const curve = readSpeedCurve(clip);
	const sourceEnd = getSourceFrameAt(clip, clipEnd);

	let keys = curve.keys.filter((key) => !replacing || key.time < replacing.before - 0.5 || key.time > replacing.after + 0.5);
	const kept: SpeedCurve = { base: curve.base, keys };

	if (options) {
		const rate = rateAtSource(kept, from);
		const span = Math.min(options.length * fps * rate, sourceEnd - from);
		if (span < 2) return { ok: false, reason: 'too-short' };

		const ramp = options.ramp === 'smooth' ? Math.min(SPEED_RAMP * fps * rate, span / 3) : 1;
		const before = Math.max(0, from - ramp);
		const after = from + span + ramp;
		const easing: Easing = options.ramp === 'smooth' ? 'easeInOut' : 'linear';
		keys = [
			...keys.filter((key) => key.time < before || key.time > after),
			{ time: before, value: rateAtSource(kept, before), easing },
			{ time: from, value: rate * options.speed, easing: 'linear' },
			{ time: from + span, value: rate * options.speed, easing },
			{ time: after, value: rateAtSource(kept, after), easing: 'linear' },
		].sort((a, b) => a.time - b.time);
	}

	const editor = getDocumentEditor(world);
	const existing = findKeyframeTrack(world, clip, 'playbackRate');
	if (existing) editor.remove(existing);
	if (keys.length > 0) {
		editor.insertElement(clip, () => (
			<KeyframeTrack property="playbackRate">
				{keys.map((key) => <Keyframe time={round(key.time / fps)} value={round(key.value)} easing={key.easing as Easing} />)}
			</KeyframeTrack>
		));
	}

	if (authoredTime(world, clip, 'end') !== undefined && authoredTime(world, clip, 'sourceOut') === undefined) {
		const next: SpeedCurve = { base: curve.base, keys };
		const end = (computed.origin[clip.id()] ?? 0) + timelineOffsetAtSource(next, sourceEnd);
		editTime(world, clip, 'end', Math.round(end) - getTimelineOrigin(clip));
	}

	editor.editProperty(clip, 'expanded', true);
	editor.select(clip);
	return { ok: true, entity: clip };
}

/** `effectOf` relies on this shape: two equal keys below the keys either side, as `writeSlowMotion` writes. */
function slowStretch(world: World, clip: Entity): Stretch | null {
	const keys = readSpeedCurve(clip).keys;
	const stretches: Stretch[] = [];
	for (let index = 1; index + 2 < keys.length; index++) {
		const [before, from, to, after] = [keys[index - 1]!, keys[index]!, keys[index + 1]!, keys[index + 2]!];
		if (Math.abs(from.value - to.value) > 1e-3 || from.value >= before.value || to.value >= after.value) continue;
		stretches.push({ before: before.time, from: from.time, to: to.time, after: after.time });
	}
	if (stretches.length === 0) return null;

	const playhead = sourceFrameAtTimeline(clip, playheadOf(world));
	const distance = (stretch: Stretch) => (playhead < stretch.before ? stretch.before - playhead : playhead > stretch.after ? playhead - stretch.after : 0);
	return stretches.reduce((best, stretch) => (distance(stretch) < distance(best) ? stretch : best));
}

/** Each kind is known by its name and its shape; a clip counts as slow motion while its speed track holds a slow-down. */
export function effectOf(world: World, entity: Entity | undefined): FoundEffect | null {
	if (!entity || !entity.isAlive()) return null;
	const name = authoredElement(entity)?.props.name;
	const fps = fpsOf(world);
	const computed = store(world, Computed);
	const seconds = ((computed.end[entity.id()] ?? 0) - (computed.start[entity.id()] ?? 0)) / fps;
	const length = Math.round(seconds * 100) / 100;

	if (isAdjustmentLayer(entity)) {
		const scales = trackValues(world, entity, 'scale');
		const clip = siblingBefore(entity);
		const span = (): number | 'clip' =>
			clip !== null && Math.abs((computed.end[entity.id()] ?? 0) - (computed.end[slotOf(clip).id()] ?? 0)) <= 1 ? 'clip' : length;
		const short = clip ? Math.min(...Object.values(pivotOf(world, slotOf(clip), getParentNode(slotOf(clip)) ?? clip))) : 1080;
		/** The first effect's value, or its keys' highest, back on a frame whose short side is 1080. */
		const effectAmount = (keyed: boolean) => {
			const effect = (entity.get(Cache)?.effects ?? [])[0];
			if (!effect) return 0;
			const value = keyed ? Math.max(0, ...trackValues(world, effect, 'value')) : (store(world, Computed).value[effect.id()] ?? 0);
			return (value * 1080) / short;
		};
		switch (name) {
			case EFFECT_NAMES.zoomIn: {
				const fixed = Number(authoredElement(entity)?.props.scale ?? 1);
				const scale = scales.length > 0 ? Math.max(...scales) : fixed;
				return { kind: 'zoomIn', entity, options: { strength: nearest(ZOOM_SCALES, scale), motion: scales.length > 0 ? 'smooth' : 'snap', length } };
			}
			case EFFECT_NAMES.slowZoom: {
				const first = scales[0] ?? 1;
				const last = scales[scales.length - 1] ?? 1;
				return {
					kind: 'slowZoom',
					entity,
					options: { direction: last >= first ? 'in' : 'out', strength: nearest(SLOW_ZOOM_SCALES, Math.max(first, last)), length: span() },
				};
			}
			case EFFECT_NAMES.zoomBlur: {
				const scale = Math.max(1, ...scales);
				const strength = (Object.keys(ZOOM_BLURS) as Strength[]).reduce((best, key) => (Math.abs(ZOOM_BLURS[key].scale - scale) < Math.abs(ZOOM_BLURS[best].scale - scale) ? key : best));
				return { kind: 'zoomBlur', entity, options: { strength, length } };
			}
			case EFFECT_NAMES.handheld: {
				const scale = Number(authoredElement(entity)?.props.scale ?? 1);
				const strength = (Object.keys(HANDHELDS) as Strength[]).reduce((best, key) => (Math.abs(HANDHELDS[key].scale - scale) < Math.abs(HANDHELDS[best].scale - scale) ? key : best));
				return { kind: 'handheld', entity, options: { strength, length: span() } };
			}
			case EFFECT_NAMES.pulse: {
				const keys = trackKeyframes(world, entity, 'scale');
				const peaks = keys.filter((key) => key.value > 1.001);
				const every = peaks.length > 1 ? (peaks[1]!.time - peaks[0]!.time) / fps : TEMPOS.normal;
				return { kind: 'pulse', entity, options: { strength: nearest(PULSES, Math.max(1, ...scales)), tempo: nearest(TEMPOS, every), length: span() } };
			}
			case EFFECT_NAMES.glitch:
				return { kind: 'glitch', entity, options: { strength: nearest(GLITCHES, effectAmount(true)), length } };
			case EFFECT_NAMES.rgbSplit:
				return { kind: 'rgbSplit', entity, options: { strength: nearest(RGB_SPLITS, effectAmount(false)), length: span() } };
			case EFFECT_NAMES.glow:
				return { kind: 'glow', entity, options: { strength: nearest(GLOWS, effectAmount(false)), length: span() } };
			case EFFECT_NAMES.blackWhite:
				return { kind: 'blackWhite', entity, options: { length: span() } };
			case EFFECT_NAMES.autoZoom: {
				const times = trackTimes(world, entity, 'scale');
				const snap = times.length > 1 && times[1]! - times[0]! <= 1.5;
				return {
					kind: 'autoZoom',
					entity,
					options: { ...effectDefaults.autoZoom, strength: nearest(AUTO_ZOOM_SCALES, Math.max(1, ...scales)), motion: snap ? 'snap' : 'smooth' },
				};
			}
			case EFFECT_NAMES.shake: {
				const scale = Math.max(1, ...scales);
				const strength = (Object.keys(SHAKES) as Strength[]).reduce((best, key) => (Math.abs(SHAKES[key].scale - scale) < Math.abs(SHAKES[best].scale - scale) ? key : best));
				return { kind: 'shake', entity, options: { strength, length } };
			}
			case EFFECT_NAMES.blur: {
				const effect = (entity.get(Cache)?.effects ?? [])[0];
				if (!effect) return null;
				const values = trackValues(world, effect, 'value');
				const times = trackTimes(world, effect, 'value');
				const clip = siblingBefore(entity);
				const short = clip ? Math.min(...Object.values(pivotOf(world, slotOf(clip), getParentNode(slotOf(clip)) ?? clip))) : 1080;
				const amount = (Math.max(0, ...values) * 1080) / short;
				const ramp = times.length > 1 ? (times[times.length - 1]! - times[0]!) / fps : length;
				return {
					kind: 'blur',
					entity,
					options: { direction: (values[0] ?? 0) > (values[values.length - 1] ?? 0) ? 'in' : 'out', strength: nearest(BLURS, amount), length: Math.round(ramp * 100) / 100 },
				};
			}
		}
		return null;
	}

	if (isShape(entity) && name === EFFECT_NAMES.flash && findKeyframeTrack(world, entity, 'opacity')) {
		const fill = parseColor(String(authoredElement(entity)?.props.fill ?? '#FFFFFF')) ?? 0xffffff;
		return { kind: 'flash', entity, options: { color: fill > 0x7fffff ? 'white' : 'black', length } };
	}

	if (isShape(entity) && name === EFFECT_NAMES.fade) {
		const keys = trackKeyframes(world, entity, 'opacity');
		if (keys.length < 2) return null;
		const fill = parseColor(String(authoredElement(entity)?.props.fill ?? '#000000')) ?? 0;
		const seconds = Math.round(((keys[keys.length - 1]!.time - keys[0]!.time) / fps) * 100) / 100;
		return {
			kind: 'fade',
			entity,
			options: { direction: keys[0]!.value > keys[keys.length - 1]!.value ? 'in' : 'out', color: fill > 0x7fffff ? 'white' : 'black', length: seconds },
		};
	}

	if (isShape(entity) && name === EFFECT_NAMES.vignette) {
		const scene = activeScene(world);
		const opacity = Number(authoredElement(entity)?.props.opacity ?? VIGNETTES.medium);
		const toEnd = scene !== null && Math.abs((computed.end[entity.id()] ?? 0) - sceneEnd(world, scene, computed.start[entity.id()] ?? 0)) <= 1;
		return { kind: 'vignette', entity, options: { strength: nearest(VIGNETTES, opacity), length: toEnd ? 'scene' : length } };
	}

	if (isGroup(entity) && name === EFFECT_NAMES.lightLeak) {
		const first = (entity.get(Cache)?.children ?? [])[0];
		const color = first && authoredElement(first)?.props.name === LEAK_NAMES.pink ? 'pink' : 'warm';
		return { kind: 'lightLeak', entity, options: { color, length } };
	}

	if (isGroup(entity) && name === EFFECT_NAMES.bars) {
		const top = (entity.get(Cache)?.children ?? [])[0];
		const heights = top ? trackValues(world, top, 'height') : [];
		const scene = activeScene(world);
		const height = scene ? sceneSize(world, scene).height : 1080;
		const kept = (heights[heights.length - 1] ?? 0) > 0;
		return { kind: 'bars', entity, options: { size: nearest(BARS, Math.max(0, ...heights) / height), length: kept ? 'scene' : length } };
	}

	if (entity.has(Geometry) && !isAdjustmentLayer(entity)) {
		const stretch = slowStretch(world, entity);
		if (!stretch) return null;
		const curve = readSpeedCurve(entity);
		const outside = rateAtSource(curve, stretch.before);
		const slow = rateAtSource(curve, stretch.from);
		const speed = SLOW_SPEEDS.reduce((best, value) => (Math.abs(value - slow / outside) < Math.abs(best - slow / outside) ? value : best));
		return {
			kind: 'slowMotion',
			entity,
			options: {
				speed,
				length: Math.round(((stretch.to - stretch.from) / fps / outside) * 100) / 100,
				ramp: stretch.from - stretch.before <= 1.5 ? 'snap' : 'smooth',
			},
		};
	}

	return null;
}

function trackKeyframes(world: World, holder: Entity, property: AnimatableProperty) {
	const track = findKeyframeTrack(world, holder, property);
	return (track?.get(Cache)?.keyframes ?? [])
		.map((keyframe) => keyframe.get(KeyframeTrait))
		.filter((key): key is { time: number; value: number; easing: string } => key !== undefined)
		.sort((a, b) => a.time - b.time);
}

const trackValues = (world: World, holder: Entity, property: AnimatableProperty) => trackKeyframes(world, holder, property).map((key) => key.value);
const trackTimes = (world: World, holder: Entity, property: AnimatableProperty) => trackKeyframes(world, holder, property).map((key) => key.time);

function nearest<K extends string>(table: Record<K, number>, value: number): K {
	return (Object.keys(table) as K[]).reduce((best, key) => (Math.abs(table[key] - value) < Math.abs(table[best] - value) ? key : best));
}

type TrackKey = [time: number, value: number, easing?: Easing];

/** `[seconds, value, easing]` triples. */
function Track(props: { property: 'scale' | 'x' | 'y' | 'rotation' | 'value' | 'opacity' | 'height'; keys: TrackKey[] }) {
	return (
		<KeyframeTrack property={props.property}>
			{props.keys.map(([time, value, easing]) => <Keyframe time={round(time)} value={value} easing={easing} />)}
		</KeyframeTrack>
	);
}

/** One that would not fit after `at` ends with the clip instead. */
function windowAt(at: number, clipStart: number, clipEnd: number, length: number, toEnd: boolean): [number, number] {
	const start = at >= clipStart && at < clipEnd ? at : clipStart;
	if (toEnd) return [start, clipEnd];
	if (start + length <= clipEnd) return [start, start + length];
	return [Math.max(clipStart, clipEnd - length), clipEnd];
}

function nextSibling(entity: Entity): Entity | undefined {
	const siblings = getParentNode(entity)?.get(Cache)?.children ?? [];
	return siblings[siblings.indexOf(entity) + 1];
}

function activeScene(world: World): Entity | null {
	const scene = getActiveEntity(world);
	return scene && isScene(scene) ? scene : null;
}

/** In the scene's frames. */
function playheadOf(world: World): number {
	const scene = getActiveEntity(world);
	return scene ? Math.round(store(world, Computed).localTime[scene.id()] ?? 0) : 0;
}

function sceneSize(world: World, scene: Entity) {
	const computed = store(world, Computed);
	return {
		width: Math.round(computed.width[scene.id()] || 1920),
		height: Math.round(computed.height[scene.id()] || 1080),
	};
}

const fpsOf = (world: World) => world.get(FrameRate)?.value || 30;

const round = (value: number) => Math.round(value * 1000) / 1000;
