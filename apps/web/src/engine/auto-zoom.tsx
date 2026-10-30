/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Auto zoom: punch-ins on the moments a clip's voice lands, written as one
 * `<adjustmentLayer>` right above the clip with a keyframed `scale`. The
 * footage is never touched, so the zooms can be retimed on the timeline,
 * edited keyframe by keyframe, or deleted in one go; adding again replaces
 * the layer.
 */

import { AdjustmentLayer, Keyframe, KeyframeTrack, authoredElement } from '@plan.video/reconciler';
import {
	AssetId,
	Audio,
	Cache,
	Computed,
	FrameRate,
	Geometry,
	Group,
	Hidden,
	Muted,
	Paint,
	PaintType,
	Selected,
	getActiveEntity,
	getAsset,
	getAssetFile,
	getEntityTree,
	getParentNode,
	getSourceWindow,
	isAdjustmentLayer,
	isPaintEntity,
	isScene,
	readSpeedCurve,
	store,
	timelineOffsetAtSource,
	Sequential,
} from '@plan.video/runtime';

import { extractSpeechWav } from '@/lib/clip-audio';
import { evenPunchIns, findPunchIns, mergePunchIns, type PunchIn } from '@/lib/punch-ins';

import { getDocumentEditor } from './editor';

import type { Easing } from '@plan.video/jsx';
import type { Entity, World } from 'koota';

export const AUTO_ZOOM_NAME = 'Auto zoom';

export type ZoomStrength = 'subtle' | 'medium' | 'strong';
export type ZoomFrequency = 'fewer' | 'normal' | 'more';
export type ZoomMotion = 'snap' | 'smooth';

export interface AutoZoomOptions {
	strength: ZoomStrength;
	frequency: ZoomFrequency;
	motion: ZoomMotion;
}

export const DEFAULT_AUTO_ZOOM: AutoZoomOptions = { strength: 'medium', frequency: 'normal', motion: 'snap' };

const SCALES: Record<ZoomStrength, number> = { subtle: 1.1, medium: 1.2, strong: 1.35 };
/** The least time between two punch-ins, in seconds. */
const GAPS: Record<ZoomFrequency, number> = { fewer: 6, normal: 3.5, more: 2 };
/** How long a smooth zoom takes to go in or come out. */
const SMOOTH_RAMP = 0.35;

export type AutoZoomResult =
	| { ok: true; layer: Entity; count: number; followedVoice: boolean }
	| { ok: false; reason: 'no-clip' | 'nothing-found' };

/**
 * The clip auto zoom works on: the selected one (or the one under a selected
 * auto zoom), else the topmost clip under the playhead in the active scene.
 */
export function autoZoomTarget(world: World): Entity | null {
	for (const entity of world.query(Selected)) {
		if (isScene(entity)) continue;
		if (isAdjustmentLayer(entity)) {
			const below = siblingBefore(entity);
			if (below) return below;
			continue;
		}
		if (entity.has(Geometry) || entity.has(Group)) return entity;
	}

	const scene = getActiveEntity(world);
	if (!scene || !isScene(scene)) return null;
	const computed = store(world, Computed);
	const frame = computed.localTime[scene.id()] ?? 0;
	const children = scene.get(Cache)?.children ?? [];
	for (let i = children.length - 1; i >= 0; i--) {
		const child = children[i]!;
		if (!child.has(Geometry) && !child.has(Group)) continue;
		if (child.has(Hidden) || !hasPicture(world, child)) continue;
		const start = computed.start[child.id()] ?? 0;
		const end = computed.end[child.id()] ?? 0;
		if (frame >= start && frame < end) return child;
	}
	return null;
}

/**
 * Listens to the clip's audio for where to punch in, and writes the zooms as
 * an adjustment layer over it. With no voice to follow, the zooms keep a
 * steady beat instead.
 */
export async function addAutoZoom(world: World, target: Entity, options: AutoZoomOptions): Promise<AutoZoomResult> {
	const slot = slotOf(target);
	const parent = getParentNode(slot);
	if (!parent) return { ok: false, reason: 'no-clip' };

	// Layers stack over the clip, each acting on it; an auto zoom among them
	// is the one adding again replaces.
	const replacing = layersOver(slot).find((layer) => authoredElement(layer)?.props.name === AUTO_ZOOM_NAME);

	const fps = world.get(FrameRate)?.value || 30;
	const computed = store(world, Computed);
	const start = computed.start[slot.id()] ?? 0;
	const end = computed.end[slot.id()] ?? 0;
	const duration = (end - start) / fps;
	if (duration <= 0) return { ok: false, reason: 'no-clip' };

	const gap = GAPS[options.frequency];
	const ramp = options.motion === 'snap' ? 1 / fps : SMOOTH_RAMP;
	const heard = await voicePunchIns(world, slot, start, end, gap);
	const punches = mergePunchIns(heard ?? evenPunchIns(duration, gap), gap, ramp + 1 / fps)
		.filter((punch) => punch.end + ramp <= duration);
	if (punches.length === 0) return { ok: false, reason: 'nothing-found' };

	const keys = zoomKeyframes(punches, SCALES[options.strength], options.motion, ramp, fps);
	const parentOrigin = computed.origin[parent.id()] ?? 0;
	const pivot = pivotOf(world, slot, parent);

	const editor = getDocumentEditor(world);
	if (replacing) editor.remove(replacing);
	const above = (parent.get(Cache)?.children ?? []);
	const anchor = above[above.indexOf(slot) + layersOver(slot).length + 1];
	const [layer] = editor.insertElement(
		parent,
		() => (
			<AdjustmentLayer
				name={AUTO_ZOOM_NAME}
				start={round((start - parentOrigin) / fps)}
				end={round((end - parentOrigin) / fps)}
				width={pivot.width}
				height={pivot.height}
			>
				<KeyframeTrack property="scale">
					{keys.map((key) => <Keyframe time={key.time} value={key.value} easing={key.easing} />)}
				</KeyframeTrack>
			</AdjustmentLayer>
		),
		anchor,
	);
	if (!layer) return { ok: false, reason: 'no-clip' };

	// Open, so the punch-ins show as keyframes on the timeline.
	editor.editProperty(layer, 'expanded', true);
	editor.select(layer);
	return { ok: true, layer, count: punches.length, followedVoice: heard !== null };
}

/**
 * The scale keyframes for `punches`, in the layer's own seconds. A snap jumps
 * in one frame, the way a punch-in cut looks; a smooth zoom eases in and out.
 */
function zoomKeyframes(punches: PunchIn[], scale: number, motion: ZoomMotion, ramp: number, fps: number) {
	const easing: Easing = motion === 'snap' ? 'linear' : 'easeInOut';
	const keys: { time: number; value: number; easing: Easing }[] = [];
	const at = (time: number, value: number) => keys.push({ time: round(Math.round(time * fps) / fps), value, easing });

	for (const { start, end } of punches) {
		if (motion === 'snap') {
			at(Math.max(0, start - ramp), 1);
			at(start, scale);
			at(end, scale);
			at(end + ramp, 1);
		} else {
			at(start, 1);
			at(start + ramp, scale);
			at(end, scale);
			at(end + ramp, 1);
		}
	}

	// Two keys rounded onto one frame would make a jump of their own.
	return keys.filter((key, index) => index === 0 || key.time > keys[index - 1]!.time);
}

/**
 * Punch-ins from the voice heard under `slot` between absolute frames
 * `start` and `end`, in seconds from `start`. The slot's own clips are heard
 * first; a slot with no sound of its own (b-roll over a voiceover) follows
 * the audio clips playing alongside it. Null when nothing has a voice to
 * follow.
 */
async function voicePunchIns(world: World, slot: Entity, start: number, end: number, gap: number): Promise<PunchIn[] | null> {
	const scene = sceneOf(slot);
	let clips = audibleClips(world, slot);
	if (clips.length === 0 && scene) {
		const computed = store(world, Computed);
		clips = audibleClips(world, scene).filter((clip) => clip.has(Audio)
			&& (computed.start[clip.id()] ?? 0) < end && (computed.end[clip.id()] ?? 0) > start);
	}
	if (clips.length === 0) return null;

	const fps = world.get(FrameRate)?.value || 30;
	const computed = store(world, Computed);
	const found: PunchIn[] = [];
	let heardAny = false;

	await Promise.all(clips.map(async (clip) => {
		const assetId = assetOf(clip)?.get(AssetId)?.value;
		const asset = assetId ? getAsset(world, assetId) : undefined;
		if (!asset || (asset.type !== 'AUDIO' && asset.type !== 'VIDEO')) return;

		const source = getSourceWindow(clip);
		try {
			const speech = await extractSpeechWav(await getAssetFile(asset), source.in / fps, Math.max(source.in, source.out) / fps);
			if (!speech) return;
			const punches = findPunchIns(speech.envelope, gap);
			if (!punches) return;
			heardAny = true;

			const origin = computed.origin[clip.id()] ?? 0;
			const rate = computed.playbackRate[clip.id()] || 1;
			const curve = readSpeedCurve(clip);
			// Envelope seconds onto the slot's own seconds, through the clip's
			// place on the timeline and its speed.
			const local = (seconds: number) => {
				const media = (speech.mediaStart + seconds) * fps;
				const frame = origin + (curve.keys.length > 0 ? timelineOffsetAtSource(curve, media) : media / rate);
				return (frame - start) / fps;
			};
			const clipStart = ((computed.start[clip.id()] ?? start) - start) / fps;
			const clipEnd = ((computed.end[clip.id()] ?? end) - start) / fps;
			for (const punch of punches) {
				const from = local(punch.start);
				const to = Math.min(local(punch.end), clipEnd);
				if (from >= clipStart && to > from) found.push({ start: from, end: to });
			}
		} catch (error) {
			console.warn('[auto-zoom] could not read the clip audio', error);
		}
	}));

	return heardAny ? found : null;
}

/** The clips under `root` that can be heard: their own audio, unmuted and shown. */
function audibleClips(world: World, root: Entity): Entity[] {
	const clips = new Set<Entity>();
	for (const entity of getEntityTree(world, root)) {
		if (entity.has(Hidden) || entity.has(Muted) || !entity.has(AssetId)) continue;
		if (!entity.has(Audio) && entity.get(Paint)?.value !== PaintType.VIDEO) continue;
		// A video paint keeps the 16s a new entity starts with; the clip it
		// fills is what sits on the timeline.
		const clip = isPaintEntity(entity) ? getParentNode(entity) ?? entity : entity;
		if (!clip.has(Hidden) && !clip.has(Muted)) clips.add(clip);
	}
	return [...clips];
}

/** Whichever of the clip and its paints holds the asset. */
function assetOf(clip: Entity): Entity | undefined {
	if (clip.has(AssetId)) return clip;
	return (clip.get(Cache)?.fills ?? []).find((fill) => fill.has(AssetId));
}

/** Whether anything under `entity` draws footage or a picture. */
function hasPicture(world: World, entity: Entity): boolean {
	return getEntityTree(world, entity).some((child) => {
		const paint = child.get(Paint)?.value;
		return paint === PaintType.VIDEO || paint === PaintType.IMAGE;
	});
}

/**
 * Where the layer has to sit: a clip inside a sequence is one of a row, and
 * an adjustment layer acts on what is below the whole row.
 */
export function slotOf(entity: Entity): Entity {
	let slot = entity;
	let parent = getParentNode(slot);
	while (parent && parent.has(Sequential)) {
		slot = parent;
		parent = getParentNode(slot);
	}
	return slot;
}

/** The clip an adjustment layer acts on: the one under it and any layers stacked below it. */
export function siblingBefore(entity: Entity): Entity | null {
	const slot = slotOf(entity);
	const siblings = getParentNode(slot)?.get(Cache)?.children ?? [];
	let index = siblings.indexOf(slot) - 1;
	while (index >= 0 && isAdjustmentLayer(siblings[index]!)) index--;
	const below = index >= 0 ? siblings[index] : undefined;
	return below && (below.has(Geometry) || below.has(Group)) ? below : null;
}

/** The adjustment layers stacked right over `slot`, bottom first: all of them act on it. */
export function layersOver(slot: Entity): Entity[] {
	const siblings = getParentNode(slot)?.get(Cache)?.children ?? [];
	const layers: Entity[] = [];
	for (let index = siblings.indexOf(slot) + 1; index < siblings.length && isAdjustmentLayer(siblings[index]!); index++) {
		layers.push(siblings[index]!);
	}
	return layers;
}

function sceneOf(entity: Entity): Entity | null {
	let current: Entity | null = entity;
	while (current && !isScene(current)) current = getParentNode(current);
	return current;
}

/**
 * The layer's box. It is never drawn; its middle is where the zoom pivots,
 * so it is sized to put that middle on the middle of the clip: a full-frame
 * clip gets the frame's own size.
 */
export function pivotOf(world: World, slot: Entity, parent: Entity): { width: number; height: number } {
	const computed = store(world, Computed);
	const id = slot.id();
	const width = computed.width[id] ?? 0;
	const height = computed.height[id] ?? 0;
	const centerX = (computed.positionX[id] ?? 0) + (computed.originX[id] ?? 0) + width / 2;
	const centerY = (computed.positionY[id] ?? 0) + (computed.originY[id] ?? 0) + height / 2;
	if (width > 0 && height > 0 && centerX > 0 && centerY > 0) {
		return { width: Math.round(centerX * 2), height: Math.round(centerY * 2) };
	}
	return {
		width: Math.round(computed.width[parent.id()] || 1920),
		height: Math.round(computed.height[parent.id()] || 1080),
	};
}

const round = (value: number) => Math.round(value * 1000) / 1000;
