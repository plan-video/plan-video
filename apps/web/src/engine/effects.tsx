/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The Effects tab's effects, each put on at the playhead as something the
 * timeline shows and the inspector edits:
 *
 * - a zoom, a slow zoom, a shake or a blur is an `<adjustmentLayer>` in a row
 *   of its own over the clip, keyframed. Layers stack, so a clip can take
 *   several, and the footage is never touched;
 * - a flash or cinematic bars draw over the whole scene, so they are shapes
 *   on top of it;
 * - slow motion is the clip's own speed: four keys on its `playbackRate`
 *   track, slowing down and back up.
 *
 * An effect keeps no settings of its own: `effectOf` reads them back from
 * what it drew, and `updateEffect` draws it again in the same place with new
 * ones. Each add or change is one synchronous burst of edits, so it undoes
 * in one step.
 */

import { createStore } from 'solid-js/store';
import { AdjustmentLayer, Effect, Group, Keyframe, KeyframeTrack, Rect, authoredElement } from '@plan.video/reconciler';
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

export type EffectKind = 'zoomIn' | 'slowZoom' | 'autoZoom' | 'shake' | 'flash' | 'blur' | 'slowMotion' | 'bars';

export type Strength = 'subtle' | 'medium' | 'strong';

export interface EffectOptions {
	zoomIn: { strength: Strength; motion: 'snap' | 'smooth'; length: number };
	slowZoom: { direction: 'in' | 'out'; strength: Strength; length: number | 'clip' };
	autoZoom: AutoZoomOptions;
	shake: { strength: Strength; length: number };
	flash: { color: 'white' | 'black'; length: number };
	blur: { direction: 'in' | 'out'; strength: Strength; length: number };
	slowMotion: { speed: number; length: number; ramp: 'snap' | 'smooth' };
	bars: { size: Strength; length: number | 'scene' };
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
};

/**
 * The settings the next effect of each kind is added with: the last ones
 * picked, kept across tab switches.
 */
export const [effectDefaults, setEffectDefaults] = createStore<EffectOptions>(structuredClone(DEFAULT_EFFECTS));

/** What each effect is called on the timeline, which is how `effectOf` knows it again. */
export const EFFECT_NAMES: Record<Exclude<EffectKind, 'slowMotion'>, string> = {
	zoomIn: 'Zoom in',
	slowZoom: 'Slow zoom',
	autoZoom: AUTO_ZOOM_NAME,
	shake: 'Shake',
	flash: 'Flash',
	blur: 'Blur',
	bars: 'Cinematic bars',
};

const ZOOM_SCALES: Record<Strength, number> = { subtle: 1.12, medium: 1.25, strong: 1.45 };
const SLOW_ZOOM_SCALES: Record<Strength, number> = { subtle: 1.06, medium: 1.12, strong: 1.2 };
/** Auto zoom's own scales, from engine/auto-zoom. */
const AUTO_ZOOM_SCALES: Record<ZoomStrength, number> = { subtle: 1.1, medium: 1.2, strong: 1.35 };
/** Shake: how far it throws (share of the short side), how far it turns, and the zoom that hides the edges. */
const SHAKES: Record<Strength, { move: number; turn: number; scale: number }> = {
	subtle: { move: 0.008, turn: 0.4, scale: 1.04 },
	medium: { move: 0.016, turn: 0.8, scale: 1.07 },
	strong: { move: 0.03, turn: 1.5, scale: 1.12 },
};
/** Blur radius on a frame whose short side is 1080. */
const BLURS: Record<Strength, number> = { subtle: 8, medium: 18, strong: 36 };
/** Each bar's height, as a share of the frame's. */
const BARS: Record<Strength, number> = { subtle: 0.07, medium: 0.1, strong: 0.13 };
export const SLOW_SPEEDS = [0.25, 0.5, 0.75];
/** How long a smooth zoom or the bars take to come in or go out. */
const RAMP = 0.35;
const BAR_RAMP = 0.5;
/** How long smooth slow motion takes to slow down or speed back up, in seconds of footage. */
const SPEED_RAMP = 0.3;

export type EffectFailure = 'no-clip' | 'no-scene' | 'no-video' | 'too-short';
export type EffectResult = { ok: true; entity: Entity } | { ok: false; reason: EffectFailure };

/** An effect on the timeline, with the settings it was drawn with. */
export type FoundEffect = {
	[K in EffectKind]: { kind: K; entity: Entity; options: EffectOptions[K] };
}[EffectKind];

/** Where an effect is drawn again: the frame it starts on and the sibling it sits under. */
type Place = { start: number; anchor: Entity | undefined };

/**
 * Puts `kind` on at the playhead with the settings it was last given, and
 * selects it, so its settings open in the inspector. Auto zoom listens to
 * the clip first, so it has its own `addAutoZoom`.
 */
export function addEffect(world: World, kind: Exclude<EffectKind, 'autoZoom'>): EffectResult {
	const options = { ...effectDefaults[kind] };
	switch (kind) {
		case 'flash':
			return drawFlash(world, options as EffectOptions['flash']);
		case 'bars':
			return drawBars(world, options as EffectOptions['bars']);
		case 'slowMotion':
			return addSlowMotion(world, options as EffectOptions['slowMotion']);
		default: {
			const target = autoZoomTarget(world);
			if (!target) return { ok: false, reason: 'no-clip' };
			return drawLayer(world, kind, options as never, slotOf(target));
		}
	}
}

/**
 * Draws `found` again with `options`, where it was: the same start and the
 * same place among its siblings, selected. Its settings become the next
 * one's too. Auto zoom listens again, so it is `addAutoZoom` once more.
 */
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

	if (found.kind === 'flash' || found.kind === 'bars') {
		editor.remove(entity);
		return found.kind === 'flash'
			? drawFlash(world, options as EffectOptions['flash'], place)
			: drawBars(world, options as EffectOptions['bars'], place);
	}

	const clip = siblingBefore(entity);
	if (!clip) return { ok: false, reason: 'no-clip' };
	editor.remove(entity);
	return drawLayer(world, found.kind as LayerKind, options as never, slotOf(clip), place);
}

/** Takes an effect off: the element, or for slow motion, its keys on the clip's speed. */
export function removeEffect(world: World, found: FoundEffect): void {
	const editor = getDocumentEditor(world);
	if (found.kind !== 'slowMotion') return void editor.remove(found.entity);

	const stretch = slowStretch(world, found.entity);
	if (stretch) writeSlowMotion(world, found.entity, null, stretch);
}

/* Layers over the clip */

type LayerKind = 'zoomIn' | 'slowZoom' | 'shake' | 'blur';

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
			}
		},
		place ? place.anchor : layerAnchor(slot),
	);
	if (!layer) return { ok: false, reason: 'no-clip' };

	// Open, so the keyframes show on the timeline.
	if (!(kind === 'zoomIn' && (options as EffectOptions['zoomIn']).motion === 'snap')) editor.editProperty(layer, 'expanded', true);
	editor.select(layer);
	return { ok: true, entity: layer };
}

/**
 * Where a new layer goes: on top of the layers already over the clip, so it
 * gets a row of its own above them.
 */
function layerAnchor(slot: Entity): Entity | undefined {
	const siblings = getParentNode(slot)?.get(Cache)?.children ?? [];
	return siblings[siblings.indexOf(slot) + layersOver(slot).length + 1];
}

/**
 * Shake offsets every other frame or so, thrown hard at first and settling,
 * from a fixed seed so the same shake comes out each time.
 */
function shakeKeys(seconds: number, fps: number, move: number, turn: number) {
	const step = Math.max(1, Math.round(fps / 15)) / fps;
	const random = seeded(7);
	const x: TrackKey[] = [];
	const y: TrackKey[] = [];
	const rotation: TrackKey[] = [];
	for (let time = 0; time < seconds; time += step) {
		const progress = time / seconds;
		// Full strength over the first fifth, then dying away.
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

function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

/* Over the whole scene */

function drawFlash(world: World, options: EffectOptions['flash'], place?: Place): EffectResult {
	const scene = activeScene(world);
	if (!scene) return { ok: false, reason: 'no-scene' };

	const fps = fpsOf(world);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const seconds = options.length;
	// It hits within two frames and fades out from there.
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
	const computed = store(world, Computed);
	const { width, height } = sceneSize(world, scene);
	const start = place?.start ?? playheadOf(world);
	const sceneEnd = computed.empty[scene.id()] ? start + 5 * fps : (computed.duration[scene.id()] ?? 0);
	const toEnd = options.length === 'scene';
	const end = toEnd ? sceneEnd : start + Math.round((options.length as number) * fps);
	if (end - start < 2) return { ok: false, reason: 'too-short' };

	const seconds = (end - start) / fps;
	const bar = Math.round(height * BARS[options.size]);
	const ramp = Math.min(BAR_RAMP, seconds / 3);
	// Bars kept to the end stay on; otherwise they slide back out.
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

/* The clip's own speed */

/** One slow-down on a clip's speed track: its four keys, in source frames. */
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
 * Writes the clip's speed track again with one slow-down put on (from
 * `from`, or where `replacing` began) or, with no options, taken off. Other
 * slow-downs on it stay. A clip that authors its end is lengthened or
 * shortened by as much as the change adds or saves, so the footage after it
 * still plays to the same last frame.
 */
function writeSlowMotion(world: World, clip: Entity, options: EffectOptions['slowMotion'] | null, replacing: Stretch | null, from = replacing?.from ?? 0): EffectResult {
	const fps = fpsOf(world);
	const computed = store(world, Computed);
	const clipEnd = computed.end[clip.id()] ?? 0;
	const curve = readSpeedCurve(clip);
	const sourceEnd = getSourceFrameAt(clip, clipEnd);

	// The keys the clip keeps: all of them, but the slow-down being redrawn.
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

/**
 * The slow-down on the clip's speed track nearest the playhead: two keys
 * holding a speed below the keys either side of them, as `writeSlowMotion`
 * puts on. Null when the clip has none.
 */
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

/* Reading an effect back */

/**
 * The effect `entity` is, with the settings it was drawn with, or null when
 * it is none. Each kind is known by its name and its shape; a clip counts as
 * slow motion while its speed track holds a slow-down.
 */
export function effectOf(world: World, entity: Entity | undefined): FoundEffect | null {
	if (!entity || !entity.isAlive()) return null;
	const name = authoredElement(entity)?.props.name;
	const fps = fpsOf(world);
	const computed = store(world, Computed);
	const seconds = ((computed.end[entity.id()] ?? 0) - (computed.start[entity.id()] ?? 0)) / fps;
	const length = Math.round(seconds * 100) / 100;

	if (isAdjustmentLayer(entity)) {
		const scales = trackValues(world, entity, 'scale');
		switch (name) {
			case EFFECT_NAMES.zoomIn: {
				const fixed = Number(authoredElement(entity)?.props.scale ?? 1);
				const scale = scales.length > 0 ? Math.max(...scales) : fixed;
				return { kind: 'zoomIn', entity, options: { strength: nearest(ZOOM_SCALES, scale), motion: scales.length > 0 ? 'smooth' : 'snap', length } };
			}
			case EFFECT_NAMES.slowZoom: {
				const first = scales[0] ?? 1;
				const last = scales[scales.length - 1] ?? 1;
				const clip = siblingBefore(entity);
				const toEnd = clip !== null && Math.abs((computed.end[entity.id()] ?? 0) - (computed.end[slotOf(clip).id()] ?? 0)) <= 1;
				return {
					kind: 'slowZoom',
					entity,
					options: { direction: last >= first ? 'in' : 'out', strength: nearest(SLOW_ZOOM_SCALES, Math.max(first, last)), length: toEnd ? 'clip' : length },
				};
			}
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

/** The setting whose value is closest to `value`. */
function nearest<K extends string>(table: Record<K, number>, value: number): K {
	return (Object.keys(table) as K[]).reduce((best, key) => (Math.abs(table[key] - value) < Math.abs(table[best] - value) ? key : best));
}

/* Shared */

type TrackKey = [time: number, value: number, easing?: Easing];

/** A keyframe track from `[seconds, value, easing]` triples. */
function Track(props: { property: 'scale' | 'x' | 'y' | 'rotation' | 'value' | 'opacity' | 'height'; keys: TrackKey[] }) {
	return (
		<KeyframeTrack property={props.property}>
			{props.keys.map(([time, value, easing]) => <Keyframe time={round(time)} value={value} easing={easing} />)}
		</KeyframeTrack>
	);
}

/**
 * The effect's window: from `at` while it is on the clip, else from the
 * clip's start, and cut off where the clip ends. One that would not fit
 * after `at` ends with the clip instead.
 */
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

/** The active scene's playhead, in its frames. */
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
