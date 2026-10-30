/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Crops are stored as fractions of the source so they survive a frame the decoder has scaled.

import { createSignal } from 'solid-js';
import { Effect as EffectElement, Rect } from '@plan.video/reconciler';
import {
	Computed,
	Constraint,
	Effect,
	EffectType,
	MediaCrop,
	Muted,
	Offset,
	Rotation,
	Scale,
	UniformScale,
	VideoDecoderHandle,
	findGeometryAsset,
	findGeometryAssetSource,
	getActiveEntity,
	getEntityChildren,
	getEntityTree,
	getNextName,
	getParentEntity,
	getSelection,
	isGroup,
	isMask,
	isRect,
	isScene,
	isSequence,
} from '@plan.video/runtime';
import { toast } from 'somoto';

import { t } from '@/lib/i18n';
import {
	CROP_LABELS,
	CROP_SHAPES,
	LAYOUT_HEIGHT,
	LAYOUT_WIDTH,
	coverRect,
	cropStyle,
	defaultCrop,
	getStreamLayout,
	reshapeCrop,
	slotRounding,
	styleSlots,
	toPixels,
} from '@/lib/stream-layouts';

import { zoomToFitWhenSettled } from './camera';
import { getDocumentEditor } from './editor';
import { resizeScene } from './scene-size';
import { ProjectConfig } from './traits';

import type { Box, CropId, CropShape, CropStyles, Crops, Slot } from '@/lib/stream-layouts';
import type { WorkflowLayout } from '@/lib/workflows';
import type { Entity, World } from 'koota';

export type PreviewPlatform = 'tiktok' | 'shorts' | 'reels' | 'none';

type LayoutTarget = {
	scene: Entity;
	video: Entity;
	sequence: Entity | null;
	assetId: string;
	source: { width: number; height: number };
};

const [target, setTarget] = createSignal<LayoutTarget | null>(null);
const [layoutId, setLayoutId] = createSignal('split');
const [crops, setCrops] = createSignal<Crops>({});
const [styles, setStyles] = createSignal<CropStyles>({});
const [platform, setPlatform] = createSignal<PreviewPlatform>('tiktok');

const remembered = new Map<string, { crops: Crops; styles: CropStyles }>();

/** Lets whoever opened the setup tell an applied layout from a cancelled one. */
const [lastApplied, setLastApplied] = createSignal<{ scene: Entity; layout: WorkflowLayout } | null>(null);
export { lastApplied as lastAppliedLayout };

export {
	crops as layoutCrops,
	styles as layoutCropStyles,
	layoutId as activeLayoutId,
	platform as previewPlatform,
	setPlatform as setPreviewPlatform,
	target as layoutTarget,
};

export const activeLayout = () => getStreamLayout(layoutId());

export const layoutCropsPx = (): Crops => {
	const current = target();
	return current ? toPixels(crops(), current.source.width, current.source.height) : {};
};

export const layoutSlots = (): Slot[] => styleSlots(activeLayout().slots(layoutCropsPx()), styles());

export function openStreamLayout(world: World, id: string): void {
	let current = target();
	if (!current || !current.scene.isAlive() || !current.video.isAlive()) {
		const found = findTarget(world);
		if (!found) return;
		current = found;
		setTarget(found);
		const last = remembered.get(found.assetId);
		setCrops(last?.crops ?? {});
		setStyles(last?.styles ?? {});
	}

	const layout = getStreamLayout(id);
	const aspect = current.source.width / current.source.height;
	const next = { ...crops() };
	for (const spec of layout.crops) {
		next[spec.id] ??= defaultCrop(spec, aspect);
	}
	setLayoutId(layout.id);
	setCrops(next);
}

export function setLayoutSetup(saved: { crops?: Crops; styles?: CropStyles }): void {
	setCrops((current) => ({ ...current, ...saved.crops }));
	setStyles((current) => ({ ...current, ...saved.styles }));
}

export function setLayoutCrop(id: CropId, box: Box): void {
	setCrops((current) => ({ ...current, [id]: box }));
}

export function setLayoutCropShape(id: CropId, shape: CropShape): void {
	const current = target();
	const crop = crops()[id];
	const aspect = CROP_SHAPES.find((item) => item.id === shape)?.aspect ?? null;
	if (current && crop && aspect) {
		setLayoutCrop(id, reshapeCrop(crop, aspect, current.source.width / current.source.height));
	}
	const round = layoutSlots().find((slot) => slot.crop === id && !slot.blur);
	const wasCircle = !!round && slotRounding(round) >= 99.5;
	setStyles((all) => {
		const style = cropStyle(all, id);
		const rounding = wasCircle && shape !== 'circle' ? 0 : style.rounding;
		return { ...all, [id]: { shape, rounding } };
	});
}

/** 0–100%. A circle given less becomes a square. */
export function setLayoutCropRounding(id: CropId, rounding: number): void {
	setStyles((all) => {
		const style = cropStyle(all, id);
		const shape = style.shape === 'circle' && rounding < 100 ? 'square' : style.shape;
		return { ...all, [id]: { shape, rounding } };
	});
}

export function deleteLayoutCrop(id: CropId): void {
	setCrops(({ [id]: _, ...rest }) => rest);
	setStyles(({ [id]: _, ...rest }) => rest);
}

export function closeStreamLayout(): void {
	const current = target();
	if (current) remembered.set(current.assetId, { crops: crops(), styles: styles() });
	setTarget(null);
}

export function getLayoutFrame(world: World): (HTMLCanvasElement | OffscreenCanvas) | null {
	const current = target();
	if (!current || !current.video.isAlive()) return null;
	const sequence = current.sequence?.isAlive() ? current.sequence : null;
	const clip = (sequence && atPlayhead(current.scene, unitClips(world, sequence))[0]) || current.video;
	const paint = findGeometryAssetSource(world, clip);
	const frame = paint?.get(VideoDecoderHandle)?.toBitmap() ?? null;
	if (!frame || frame.width === 0 || frame.height === 0) return null;
	return frame;
}

export function applyStreamLayout(world: World): void {
	const current = target();
	if (!current) return;
	const { scene, video, sequence } = current;
	if (!scene.isAlive() || !video.isAlive()) {
		closeStreamLayout();
		return;
	}

	const editor = getDocumentEditor(world);
	const slots = layoutSlots().filter((slot) => crops()[slot.crop]);
	if (!slots.length) return;

	const unit = sequence?.isAlive() && getParentEntity(video) === sequence ? sequence : video;
	if (getParentEntity(unit) !== scene && !editor.reparent(unit, scene)) {
		toast(t('Move the video into the scene first'));
		return;
	}

	const old = layoutCopies(world, scene, unit);
	if (old.length) editor.remove(old);

	// The original keeps the sound, so it takes the main gameplay slot.
	const mainIndex = Math.max(0, slots.findIndex((slot) => slot.crop === 'gameplay' && !slot.blur));
	const units: Entity[] = [];
	for (let i = 0; i < slots.length; i++) {
		if (i === mainIndex) {
			units.push(unit);
			continue;
		}
		const copy = editor.duplicateInPlace(unit)[0]?.copy;
		if (!copy) {
			toast(t('Could not copy the video'));
			return;
		}
		// A sequence's copy keeps only its footage: its pictures, text and sound would show twice.
		if (isSequence(copy)) {
			const kept = new Set(unitClips(world, copy));
			const rest = getEntityChildren(world, copy).filter((child) => !kept.has(child));
			if (rest.length) editor.remove(rest);
		}
		units.push(copy);
	}

	resizeScene(world, scene, LAYOUT_WIDTH, LAYOUT_HEIGHT);

	slots.forEach((slot, i) => {
		const placed = units[i]!;
		for (const clip of unitClips(world, placed)) {
			const asset = findGeometryAsset(world, clip);
			const source = asset && 'width' in asset ? { width: asset.width, height: asset.height } : { width: 0, height: 0 };
			const crop = toPixels(crops(), source.width, source.height)[slot.crop];
			if (crop) placeSlot(world, clip, slot, crop, source);
			if (placed !== unit) editor.editProperty(clip, 'muted', true);
		}
		if (placed === unit) return;
		editor.editProperty(placed, 'name', getNextName(world, slot.blur ? t('Background') : t(CROP_LABELS[slot.crop])));
	});

	// Slots are listed back to front and the scene draws children in order, so they go where the original stood.
	const placedSet = new Set(units);
	const siblings = getEntityChildren(world, scene);
	const anchor = siblings.slice(siblings.indexOf(unit) + 1).find((sibling) => !placedSet.has(sibling));
	for (const placed of units) editor.reparent(placed, scene, anchor);

	// Saved with the project so a workflow saved from it takes the same crops.
	const used = new Set(activeLayout().crops.map((spec) => spec.id));
	const kept = <T,>(all: Partial<Record<CropId, T>>) =>
		Object.fromEntries(Object.entries(all).filter(([id]) => used.has(id as CropId))) as Partial<Record<CropId, T>>;
	const layout: WorkflowLayout = { id: layoutId(), crops: kept(crops()), styles: kept(styles()) };
	void world.get(ProjectConfig)?.setLayout(scene, layout);
	setLastApplied({ scene, layout });

	closeStreamLayout();
	editor.select(scene);
	zoomToFitWhenSettled(world);
}

/** The clip is the slot and the crop fills it, so layer, selection box and picture match; a mask only rounds corners. */
function placeSlot(world: World, clip: Entity, slot: Slot, crop: Box, source: { width: number; height: number }): void {
	const editor = getDocumentEditor(world);
	const { box } = slot;
	const shown = coverRect(crop, box.width / box.height);

	editor.editProperty(clip, 'keepAspectRatio', false);
	if ((clip.get(Rotation)?.value ?? 0) !== 0) editor.editProperty(clip, 'rotation', 0);
	if ((clip.get(UniformScale)?.value ?? 1) !== 1) editor.editProperty(clip, 'scale', 1);
	const flip = clip.get(Scale);
	if (flip && (flip.x !== 1 || flip.y !== 1)) {
		editor.editProperty(clip, 'scaleX', 1);
		editor.editProperty(clip, 'scaleY', 1);
	}
	const offset = clip.get(Offset);
	if (offset && (offset.x !== 0 || offset.y !== 0)) {
		editor.editProperty(clip, 'offsetX', 0);
		editor.editProperty(clip, 'offsetY', 0);
	}
	if (clip.has(Constraint)) {
		editor.editProperty(clip, 'constrainX', false);
		editor.editProperty(clip, 'constrainY', false);
	}
	editor.editProperty(clip, 'x', Math.round(box.x));
	editor.editProperty(clip, 'y', Math.round(box.y));
	editor.editProperty(clip, 'width', Math.round(box.width));
	editor.editProperty(clip, 'height', Math.round(box.height));

	const paint = findGeometryAssetSource(world, clip);
	if (paint && source.width > 0 && source.height > 0) {
		editor.editProperty(paint, 'objectFit', 'fill');
		editor.editProperty(paint, 'cropX', shown.x / source.width);
		editor.editProperty(paint, 'cropY', shown.y / source.height);
		editor.editProperty(paint, 'cropWidth', shown.width / source.width);
		editor.editProperty(paint, 'cropHeight', shown.height / source.height);
	}

	const children = getEntityChildren(world, clip);
	const stale = children.filter((child) => isMask(child) || isBlur(child));
	if (stale.length) editor.remove(stale);

	const radius = slot.radius ?? 0;
	if (radius > 0) {
		const name = getNextName(world, t({ message: 'Crop', context: 'noun' }));
		const width = Math.round(box.width);
		const height = Math.round(box.height);
		editor.insertElement(clip, () => (
			<Rect mask name={name} x={0} y={0} width={width} height={height} cornerRadius={radius} />
		));
	}
	if (slot.blur) {
		const blur = slot.blur;
		editor.insertElement(clip, () => <EffectElement type="blur" value={blur} />);
	}
}

function isBlur(entity: Entity): boolean {
	return entity.has(Effect) && entity.get(Effect)?.type === EffectType.LAYER_BLUR;
}

function isLayoutCopy(world: World, entity: Entity): boolean {
	if (!entity.has(Muted)) return false;
	if (getEntityChildren(world, entity).some((child) => isMask(child))) return true;
	const paint = findGeometryAssetSource(world, entity);
	return paint?.has(MediaCrop) ?? false;
}

function unitClips(world: World, unit: Entity): Entity[] {
	if (!isSequence(unit)) return [unit];
	return getEntityChildren(world, unit).filter((child) => isVideoClip(world, child));
}

function layoutCopies(world: World, scene: Entity, unit: Entity): Entity[] {
	const own = new Set(unitClips(world, unit));
	const assets = new Set([...own].map((clip) => findGeometryAsset(world, clip)?.id).filter(Boolean));
	const copies = new Set<Entity>();
	for (const clip of videoClips(world, scene)) {
		if (own.has(clip) || !assets.has(findGeometryAsset(world, clip)?.id) || !isLayoutCopy(world, clip)) continue;
		const parent = getParentEntity(clip);
		const wholeSequence =
			parent !== null && parent !== unit && isSequence(parent) && unitClips(world, parent).every((other) => isLayoutCopy(world, other));
		copies.add(wholeSequence ? parent : clip);
	}
	return [...copies];
}

function atPlayhead(scene: Entity, clips: Entity[]): Entity[] {
	const frame = scene.get(Computed)?.localTime ?? 0;
	return clips.filter((clip) => {
		const computed = clip.get(Computed);
		return !!computed && frame >= computed.start && frame < computed.end;
	});
}

function findTarget(world: World): LayoutTarget | null {
	const scene = getActiveEntity(world);
	if (!scene || !isScene(scene)) {
		toast(t('Open a scene first'));
		return null;
	}

	const clips = videoClips(world, scene);
	const selection = getSelection(world);
	const selectedSequence = selection.find((entity) => isSequence(entity) && getEntityTree(world, scene).includes(entity));
	const pool = selectedSequence ? unitClips(world, selectedSequence) : clips;
	// A muted clip is most likely a copy an earlier layout made; the one at the playhead shows a frame to crop on.
	const sound = pool.filter((clip) => !clip.has(Muted));
	const video =
		selection.find((entity) => clips.includes(entity)) ??
		largest(atPlayhead(scene, sound)) ??
		largest(sound) ??
		largest(pool);
	if (!video) {
		toast(t('Add a video to the scene first'));
		return null;
	}

	const asset = findGeometryAsset(world, video);
	if (!asset || (asset.type !== 'VIDEO' && asset.type !== 'SEQUENCE') || asset.width <= 0 || asset.height <= 0) {
		toast(t('This video has no size yet'));
		return null;
	}

	const parent = getParentEntity(video);
	const sequence = parent && isSequence(parent) ? parent : null;
	return { scene, video, sequence, assetId: asset.id, source: { width: asset.width, height: asset.height } };
}

function largest(clips: Entity[]): Entity | null {
	let best: Entity | null = null;
	let bestArea = 0;
	for (const clip of clips) {
		const computed = clip.get(Computed);
		const area = (computed?.width ?? 0) * (computed?.height ?? 0);
		if (area > bestArea) {
			best = clip;
			bestArea = area;
		}
	}
	return best;
}

function videoClips(world: World, scene: Entity): Entity[] {
	const found: Entity[] = [];
	const visit = (parent: Entity) => {
		for (const child of getEntityChildren(world, parent)) {
			if (isMask(child) || isScene(child)) continue;
			if (isSequence(child)) {
				visit(child);
				continue;
			}
			if (isVideoClip(world, child)) found.push(child);
			if (isGroup(child)) visit(child);
		}
	};
	visit(scene);
	return found;
}

function isVideoClip(world: World, entity: Entity): boolean {
	if (!isRect(entity) || isMask(entity)) return false;
	const type = findGeometryAsset(world, entity)?.type;
	return type === 'VIDEO' || type === 'SEQUENCE';
}
