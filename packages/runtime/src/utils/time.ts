/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CONONICAL_TIME_BASE, PaintType } from '../constants';
import {
	Audio, AssetId, Cache, Computed, Geometry, Paint, Trim, Library, FrameRate,
	Delay, IsMask, PlaybackRate, SourceFrameRate,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { readSpeedCurve, sourceFrameAtOffset } from './speed';
import { getSourceDuration } from '../actions/assets';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';

export function snapToMs(seconds: number) {
	return Math.round(seconds * CONONICAL_TIME_BASE) / CONONICAL_TIME_BASE;
}

export function snapToFps(seconds: number, fps: number = 30) {
	return Math.round(seconds * fps) / fps;
}

export function secondsToFrames(seconds: number = 0, fps: number = 30) {
	return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number = 0, fps: number = 30) {
	return snapToMs(frames / fps);
}

function splitTimecode(seconds: number, frameRate: number): [hours: number, minutes: number, seconds: number, frames: number] {
	const fps = Math.max(1, Math.round(frameRate));
	const totalFrames = Math.round(seconds * fps);
	const totalSeconds = Math.floor(totalFrames / fps);
	return [
		Math.floor(totalSeconds / 3600),
		Math.floor((totalSeconds % 3600) / 60),
		totalSeconds % 60,
		totalFrames % fps,
	];
}

/** `HH:MM:SS:FF`, fixed width so ruler ticks line up. */
export function formatTimestamp(seconds: number, frameRate: number): string {
	return splitTimecode(seconds, frameRate).map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * The same timecode with its zero segments dropped, for labels and filenames:
 * `08s10f`, `01m05s`, `0f`. Each segment carries its unit, so nothing is
 * ambiguous once the empty ones are gone.
 */
export function formatTimecode(seconds: number, frameRate: number): string {
	const units = ['h', 'm', 's', 'f'];
	const stamp = splitTimecode(seconds, frameRate)
		.map((value, i) => (value === 0 ? '' : `${String(value).padStart(2, '0')}${units[i]}`))
		.join('');
	return stamp || '0f';
}

/**
 * The scene frame that local time 0 means for `entity`, its parent's
 * origin. Converts between the absolute frames Computed works in and the
 * parent-relative frames Delay is expressed in.
 */
export function getTimelineOrigin(entity: Entity): number {
	const parent = getParentNode(entity);
	return parent === null ? 0 : (parent.get(Computed)?.origin ?? 0);
}

export function getSourceFrameAt(entity: Entity, frame: number): number {
	const computed = entity.get(Computed);
	const origin = computed?.origin ?? 0;
	const curve = readSpeedCurve(entity);
	if (curve.keys.length > 0) return Math.round(sourceFrameAtOffset(curve, frame - origin));

	const playbackRate = computed?.playbackRate || 1;
	return Math.round((frame - origin) * playbackRate);
}

/** Derived from the resolved duration rather than Trim's end, so a window the node never plays isn't reported as playing. */
export function getSourceWindow(entity: Entity): { in: number; out: number } {
	const sourceIn = entity.get(Trim)?.start ?? 0;
	const computed = entity.get(Computed);
	const curve = readSpeedCurve(entity);
	if (curve.keys.length > 0) {
		const end = computed?.end ?? 0;
		return { in: sourceIn, out: Math.round(sourceFrameAtOffset(curve, end - (computed?.origin ?? 0))) };
	}

	const duration = computed?.duration ?? 0;
	const playbackRate = computed?.playbackRate || 1;
	return { in: sourceIn, out: sourceIn + Math.round(duration * playbackRate) };
}

/** Differs from `getSourceWindow` for a container spanning its children, whose span starts where its first child does. Preset animation windows must use this. */
export function getLocalWindow(entity: Entity): { in: number; out: number } {
	const computed = entity.get(Computed);
	const origin = computed?.origin ?? 0;
	const curve = readSpeedCurve(entity);
	if (curve.keys.length > 0) {
		return {
			in: Math.round(sourceFrameAtOffset(curve, (computed?.start ?? 0) - origin)),
			out: Math.round(sourceFrameAtOffset(curve, (computed?.end ?? 0) - origin)),
		};
	}

	const playbackRate = computed?.playbackRate || 1;
	return {
		in: Math.round(((computed?.start ?? 0) - origin) * playbackRate),
		out: Math.round(((computed?.end ?? 0) - origin) * playbackRate),
	};
}

/** An intrinsic paint is drawn by the geometry itself, from its own AssetId, beneath any paint children; a paint sub-entity has no Geometry. */
export function getIntrinsicPaint(entity: Entity): PaintType | undefined {
	if (!entity.has(Geometry)) return undefined;
	return entity.get(Paint)?.value;
}

export function isPaintEntity(entity: Entity): boolean {
	return entity.has(Paint) && !entity.has(Geometry);
}

/** The element the source props belong to, so an editor writing `src` has to write it here. */
export function findGeometryAssetSource(world: World, entity: Entity): Entity | null {
	const assets = world.get(Library);
	if (!assets) return null;

	const ownId = entity.get(AssetId)?.value;
	if (ownId && assets.get(ownId)) return entity;

	for (const fill of entity.get(Cache)?.fills ?? []) {
		const fillId = fill.get(AssetId)?.value;
		if (fillId && assets.get(fillId)) return fill;
	}

	return null;
}

export function findGeometryAsset(world: World, entity: Entity): Asset | null {
	const source = findGeometryAssetSource(world, entity);
	if (source === null) return null;

	return world.get(Library)?.get(source.get(AssetId)?.value ?? '') ?? null;
}

export type TimeTrait = typeof Delay | typeof PlaybackRate | typeof SourceFrameRate;

/** koota fires onRemove before it clears the trait, so a removal handler asks for the length the node will have once it's gone. */
export type Ignorable = TimeTrait | typeof Trim | typeof AssetId | typeof IsMask;

/** In project frames; null when nothing time-based is attached. Asked of the holder because a frames directory lasts as long as its rate says. */
export function findAssetDuration(world: World, entity: Entity, ignore?: Ignorable): number | null {
	const assets = world.get(Library);
	if (!assets) return null;
	const frameRate = world.get(FrameRate)?.value ?? 30;
	const ignoreAuthoredRate = ignore === SourceFrameRate;

	const paint = getIntrinsicPaint(entity);
	if (ignore !== AssetId && (entity.has(Audio) || paint === PaintType.VIDEO)) {
		const asset = assets.get(entity.get(AssetId)?.value ?? '');
		const duration = asset ? getSourceDuration(entity, asset, ignoreAuthoredRate) : null;
		if (duration !== null) return secondsToFrames(duration, frameRate);
	}

	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (fill.get(Paint)?.value !== PaintType.VIDEO) continue;

		const asset = assets.get(fill.get(AssetId)?.value ?? '');
		const duration = asset ? getSourceDuration(fill, asset, ignoreAuthoredRate) : null;
		if (duration !== null) return secondsToFrames(duration, frameRate);
	}

	return null;
}
