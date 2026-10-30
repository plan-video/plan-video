/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Computed is derived state (store writes, no events); the Delay/Trim traits fire change events,
// so edits go through entity.set.

import { store } from '../world/store';
import { DEFAULT_DURATION_FRAMES } from '../constants';
import {
	Geometry, Group, AdjustmentLayer, Paint, Caption, Cache, Computed,
	Delay, Trim, PlaybackRate, CaptionDecoderHandle, AssetId, FrameRate,
	FramePromises,
} from '../traits';
import { isGroupLike } from '../queries/predicates';
import { getParentNode } from '../queries/hierarchy';
import { readSpeedCurve, sourceFrameAtOffset, timelineOffsetAtSource } from '../utils/speed';
import { findAssetDuration, getSourceFrameAt, isPaintEntity, secondsToFrames } from '../utils/time';
import { getAsset } from './assets';
import { getTranscriptDuration, primeTranscriptDuration } from '../media/caption/utils';

import type { Entity, World } from 'koota';
import type { Ignorable, TimeTrait } from '../utils/time';

/** `ignore` reads one trait as absent: koota fires onRemove before it clears the trait. */
function stored(entity: Entity, trait: TimeTrait, ignore?: Ignorable): number | undefined {
	return trait === ignore ? undefined : entity.get(trait)?.value;
}

function storedTrim(entity: Entity, ignore?: Ignorable) {
	return Trim === ignore ? undefined : entity.get(Trim);
}

/**
 * In source frames. Every bound caps the window, so the shortest wins rather than one overriding
 * another. With none the node runs its whole source, or 16s without one (a shape's asset length is
 * a default, not a cap).
 */
function resolveSourceOut(
	world: World,
	entity: Entity,
	trimStart: number,
	trimEnd: number | null,
	ignore?: Ignorable,
): number {
	const assetDuration = findAssetDuration(world, entity, ignore);

	let out = trimEnd ?? Infinity;

	if (assetDuration !== null) out = Math.min(out, assetDuration);

	if (out === Infinity) out = DEFAULT_DURATION_FRAMES;

	return Math.max(trimStart, out);
}

/** In project frames; null until the transcript is read (see `primeTranscriptDuration`) or when it has no words. */
function findTranscriptDuration(world: World, entity: Entity, ignore?: Ignorable): number | null {
	if (ignore === AssetId) return null;

	const asset = getAsset(world, entity.get(AssetId)?.value ?? '');
	if (!asset) return null;

	const duration = getTranscriptDuration(asset);
	if (duration === null) return null;

	return secondsToFrames(duration, world.get(FrameRate)?.value ?? 30);
}

/** The transcript is a fallback length, not a cap: an authored end wins. Null when the caption follows its parent (see `resolveParentSpan`). */
function resolveCaptionSourceOut(
	world: World,
	entity: Entity,
	trimStart: number,
	trimEnd: number | null,
	ignore?: Ignorable,
): number | null {
	if (trimEnd !== null) return Math.max(trimStart, trimEnd);

	const duration = findTranscriptDuration(world, entity, ignore);
	if (duration !== null) return Math.max(trimStart, duration);

	return null;
}

/** An initial value read when the range is recomputed, not a live derivation. The parent's fit already contains the caption's previous span, so it is a fixed point, never a runaway. */
function resolveParentSpan(world: World, entity: Entity, origin: number, playbackRate: number): number {
	const parent = getParentNode(entity);
	const end = parent === null ? -Infinity : store(world, Computed).end[parent.id()] ?? -Infinity;

	const span = (end - origin) * playbackRate;
	return Number.isFinite(span) && span > 0 ? span : DEFAULT_DURATION_FRAMES;
}

/** Delay is parent-relative and Trim in source frames; Computed is absolute, so every comparison works in one space. The origin places source frame 0. */
export function recomputeEntityTimeRange(world: World, entity: Entity, ignore?: Ignorable): void {
	const computed = store(world, Computed);
	const eid = entity.id();

	const parent = getParentNode(entity);
	const parentOrigin = parent !== null ? (computed.origin[parent.id()] ?? 0) : 0;

	const delay = stored(entity, Delay, ignore) ?? 0;
	const playbackRate = stored(entity, PlaybackRate, ignore) || 1;
	const trim = storedTrim(entity, ignore);
	const curve = readSpeedCurve(entity);

	// Bounds land on frame boundaries, since everything comparing nodes works
	// in whole frames, while the origin keeps its fraction so audio scheduled
	// against it doesn't inherit a half-frame of slip.
	const origin = parentOrigin + delay;
	const trimStart = trim?.start ?? 0;
	const start = Math.round(origin + (
		curve.keys.length > 0 ? timelineOffsetAtSource(curve, trimStart) : trimStart / playbackRate
	));

	computed.origin[eid] = origin;
	computed.playbackRate[eid] = playbackRate;

	// A container with no trimmed end spans its children; an empty one keeps the default for itself and
	// is left out by its container, so an empty layer never makes its scene longer.
	if (fitsChildren(entity, ignore)) {
		let fitStart = Infinity;
		let fitEnd = -Infinity;
		for (const child of entity.get(Cache)?.children ?? []) {
			if (computed.empty[child.id()]) continue;
			const cs = computed.start[child.id()] ?? start;
			const ce = computed.end[child.id()] ?? start;
			if (cs < fitStart) fitStart = cs;
			if (ce > fitEnd) fitEnd = ce;
		}

		const empty = fitEnd === -Infinity;
		if (empty) {
			fitStart = start;
			fitEnd = start + DEFAULT_DURATION_FRAMES;
		}

		computed.start[eid] = fitStart;
		computed.end[eid] = fitEnd;
		computed.duration[eid] = fitEnd - fitStart;
		computed.empty[eid] = empty;
		return;
	}

	computed.empty[eid] = false;

	let sourceOut = resolveSourceOut(world, entity, trimStart, trim?.end ?? null, ignore);

	if (entity.has(Caption)) {
		sourceOut = resolveCaptionSourceOut(world, entity, trimStart, trim?.end ?? null, ignore)
			?? resolveParentSpan(world, entity, origin, playbackRate)
	}

	const end = Math.max(start, Math.round(origin + (
		curve.keys.length > 0 ? timelineOffsetAtSource(curve, sourceOut) : sourceOut / playbackRate
	)));

	computed.start[eid] = start;
	computed.end[eid] = end;
	computed.duration[eid] = end - start;
}

/** Use when the entity's origin or rate changed: every child is placed against that origin. */
export function propagateTimeRangeDown(world: World, entity: Entity, ignore?: Ignorable): void {
	recomputeEntityTimeRange(world, entity, ignore);
	for (const child of entity.get(Cache)?.children ?? []) {
		propagateTimeRangeDown(world, child);
	}
	for (const mask of entity.get(Cache)?.masks ?? []) {
		propagateTimeRangeDown(world, mask);
	}
	recomputeEntityTimeRange(world, entity, ignore);
}

/** Call with the entity that changed. */
export function bubbleTimeRangeUp(world: World, child: Entity): void {
	const entity = getParentNode(child);
	if (entity === null) return;

	if (!fitsChildren(entity)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

export function fitsChildren(entity: Entity, ignore?: Ignorable): boolean {
	if (!isGroupLike(entity)) return false;
	return (storedTrim(entity, ignore)?.end ?? null) === null;
}

/** Used when a paint is removed: without it the geometry falls back to the 16s default after losing its asset source. */
export function pinTrimToCurrentBounds(world: World, entity: Entity): void {
	if ((entity.get(Trim)?.end ?? null) !== null) return;

	const computed = store(world, Computed);
	const eid = entity.id();
	const origin = computed.origin[eid] ?? 0;
	const playbackRate = computed.playbackRate[eid] || 1;
	const end = computed.end[eid] ?? 0;
	const curve = readSpeedCurve(entity);

	entity.add(Trim);
	entity.set(Trim, {
		end: curve.keys.length > 0
			? sourceFrameAtOffset(curve, end - origin)
			: (end - origin) * playbackRate,
	});
}

/** The origin stays put and the trim opens later, so the remaining frames still line up with the timeline. */
export function trimEntityIn(world: World, entity: Entity, frame: number): void {
	// The out point is only implied while the trim is open-ended; pin it
	// before moving the head, or the tail would follow along.
	pinTrimToCurrentBounds(world, entity);

	entity.add(Trim);
	entity.set(Trim, { start: getSourceFrameAt(entity, frame) });
}

export function trimEntityOut(_world: World, entity: Entity, frame: number): void {
	entity.add(Trim);
	entity.set(Trim, { end: getSourceFrameAt(entity, frame) });
}

/** `ignore`: the trait is on its way off (koota fires onRemove before clearing it). */
export function reactToAssetChange(world: World, entity: Entity, ignore?: Ignorable) {
	if (isPaintEntity(entity)) {
		reactToPaintChange(world, entity);
	} else if (entity.has(Caption)) {
		// Re-pointed transcript: drop the decoder so it re-resolves with the
		// new asset.
		if (entity.has(CaptionDecoderHandle)) {
			entity.get(CaptionDecoderHandle)?.dispose();
			entity.set(CaptionDecoderHandle, null);
		}

		// The transcript is the caption's fallback length: recompute against
		// what is known now, and once the new transcript's words are read
		// (a file read, so async) recompute again with its actual end.
		recomputeEntityTimeRange(world, entity, ignore);
		bubbleTimeRangeUp(world, entity);

		const asset = ignore === AssetId ? undefined : getAsset(world, entity.get(AssetId)?.value ?? '');
		if (asset && getTranscriptDuration(asset) === null) {
			const done = primeTranscriptDuration(asset).then(() => {
				if (!entity.isAlive() || entity.get(AssetId)?.value !== asset.id) return;
				recomputeEntityTimeRange(world, entity);
				bubbleTimeRangeUp(world, entity);
			}).catch(() => undefined);
			world.get(FramePromises)?.list?.push(done);
		}
	} else if (entity.has(Geometry)) {
		// A geometry's own asset backs its intrinsic paint (a video's footage)
		// or, on an audio clip, its recording: a new one is a new source length.
		recomputeEntityTimeRange(world, entity, ignore);
		bubbleTimeRangeUp(world, entity);
	}
}

/** The asset length is one of resolveSourceOut's caps, so a shorter source shortens the clip on its own. */
export function reactToPaintChange(world: World, paint: Entity) {
	// A geometry's own Paint is its intrinsic paint: the geometry is the clip.
	const entity = paint.has(Geometry) ? paint : getParentNode(paint);
	if (entity === null || !entity.has(Geometry)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

export function reactToGeometryDurationChange(world: World, entity: Entity) {
	if (!entity.has(Geometry)) return;

	recomputeEntityTimeRange(world, entity);
	bubbleTimeRangeUp(world, entity);
}

export function reactToChildAttached(world: World, child: Entity) {
	if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) {
		propagateTimeRangeDown(world, child);
		bubbleTimeRangeUp(world, child);
		return;
	}

	if (child.has(Paint)) {
		reactToPaintChange(world, child);
	}
}

/**
 * The parent is refitted whatever the child was: a destroy strips the child's traits before it
 * fires the ChildOf removal, so nothing on a deleted clip says it was one.
 */
export function reactToChildDetached(world: World, child: Entity, parent: Entity) {
	if (fitsChildren(parent)) {
		recomputeEntityTimeRange(world, parent);
		bubbleTimeRangeUp(world, parent);
	}

	if (child.has(Geometry) || child.has(Group) || child.has(AdjustmentLayer)) return;

	if (child.has(Paint)) {
		if (!parent.has(Geometry)) return;
		// A caption's length comes from its transcript or parent, never from
		// its fills; pinning here would freeze that derived length into a
		// trim whenever a preset's styling children are cleared.
		if (parent.has(Caption)) return;
		// Pin the current duration before recomputing; otherwise the geometry
		// would silently fall back to the 16s default after losing its paint.
		pinTrimToCurrentBounds(world, parent);
	}
}
