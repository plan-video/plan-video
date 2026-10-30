/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { parseSource } from '@plan.video/jsx';

import { Ai, Cache, Computed, Delay, FrameRate, FramePromises, Generating, GenerationRequest, Host, Library, LoadRequest, PendingSource, PendingSync, PlaybackRate, Source, SourceError, SyncRequest, TranscriptionRequest, Trim } from '../traits';
import { bindAsset, getAssetFile } from '../actions/assets';
import { getEntityTree, getParentNode, getSceneAncestor } from '../queries/hierarchy';
import { findAssetDuration, findGeometryAsset } from '../utils/time';
import { computeAudioSyncOffsetCached } from '../media/audio-sync';
import { store } from '../world/store';
import { assert } from '../utils/assert';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';

export function assetSystem(world: World): void {
	for (const entity of world.query(LoadRequest, Host)) {
		const source = entity.get(LoadRequest)!.value;
		if (!isDomImage(entity)) continue;
		pointDomImageAt(entity, null);
		if (source !== '' && !/^(?:data|blob):/i.test(source)) continue;
		entity.remove(LoadRequest);
		pointDomImageAt(entity, source || null);
	}

	const library = world.get(Library);
	if (library) {
		for (const entity of world.query(LoadRequest)) {
			const source = entity.get(LoadRequest)!.value;
			entity.remove(LoadRequest);
			resolve(world, entity, library.resolve(source));
		}
	}

	const ai = world.get(Ai);
	if (ai) {
		for (const entity of world.query(GenerationRequest)) {
			const ref = entity.get(GenerationRequest)!.ref;
			entity.remove(GenerationRequest);
			if (ref === null) continue;
			if (isDomImage(entity)) pointDomImageAt(entity, null);
			resolve(world, entity, ai.resolve(ref), true);
		}

		for (const entity of world.query(TranscriptionRequest)) {
			const scene = getSceneAncestor(entity);
			if (!scene || hasPendingSources(world, scene, entity)) continue;

			const seed = entity.get(TranscriptionRequest)!.seed;
			entity.remove(TranscriptionRequest);
			resolve(world, entity, ai.transcribe(world, scene, seed), true);
		}
	}

	for (const entity of world.query(SyncRequest)) {
		if (waitingOnSources(entity)) continue;

		const id = entity.get(SyncRequest)!.value;
		const target = findElementById(world, id, entity);

		if (target === undefined) {
			fail(entity, `syncTo: no other element carries id "${id}"`);
			continue;
		}

		if (inCycle(world, entity)) {
			fail(entity, `syncTo: "${id}" leads back around to this element; a sync cannot go in a circle`);
			continue;
		}

		if (target.has(SyncRequest) || target.has(PendingSync) || waitingOnSources(target)) continue;

		const source = findGeometryAsset(world, entity);
		if (source === null || (source.type !== 'AUDIO' && source.type !== 'VIDEO')) {
			fail(entity, 'syncTo: the element has no audio or video source to align');
			continue;
		}

		const reference = findGeometryAsset(world, target);
		if (reference === null || (reference.type !== 'AUDIO' && reference.type !== 'VIDEO')) {
			fail(entity, `syncTo: "${id}" has no audio or video source to align against`);
			continue;
		}

		entity.remove(SyncRequest);

		const token = {};
		entity.add(PendingSync);
		entity.set(PendingSync, { value: token });

		const done = computeAudioSyncOffsetCached(source, reference)
			.then(({ offsetSeconds }) => {
				if (!currentSync(entity, token)) return;
				if (target.isAlive()) placeSynced(world, entity, target, id, offsetSeconds);
				entity.remove(PendingSync);
			})
			.catch((error: unknown) => {
				if (!currentSync(entity, token)) return;
				fail(entity, error instanceof Error ? error.message : String(error));
			});

		world.get(FramePromises)?.list?.push(done);
	}
}

/**
 * The measured offset is how long after the target's recording this one started; Delay is
 * parent-relative where Computed is absolute, and the origin keeps its fraction so scheduled audio
 * doesn't slip half a frame. Authored trim bounds survive; a window closing before it opens is reported.
 */
function placeSynced(world: World, entity: Entity, target: Entity, id: string, offsetSeconds: number): void {
	const computed = store(world, Computed);
	const frameRate = world.get(FrameRate)?.value ?? 30;

	const parent = getParentNode(entity);
	const parentOrigin = parent !== null ? computed.origin[parent.id()] ?? 0 : 0;
	const origin = (computed.origin[target.id()] ?? 0) + offsetSeconds * frameRate;

	entity.add(Delay);
	entity.set(Delay, { value: origin - parentOrigin });

	const rate = entity.get(PlaybackRate)?.value || 1;
	const trim = entity.get(Trim);
	const targetStart = computed.start[target.id()] ?? 0;
	const targetEnd = computed.end[target.id()] ?? 0;

	const start = trim?.start ?? Math.max(0, (targetStart - origin) * rate);
	let end = trim?.end ?? null;
	if (end === null) {
		end = (targetEnd - origin) * rate;
		const duration = findAssetDuration(world, entity);
		if (duration !== null) end = Math.min(end, duration);
	}

	assert(end > start, `syncTo: the aligned clip does not overlap the window of "${id}"`);

	entity.add(Trim);
	entity.set(Trim, { start, end });
}

/** Ids ride in as the source stamp's locator, so only stamped elements are found and a positional (numeric) locator never matches. Loop iterations share one stamp; the first stands for them all. */
function findElementById(world: World, id: string, except: Entity): Entity | undefined {
	for (const entity of world.query(Source)) {
		if (entity === except) continue;
		if (parseSource(entity.get(Source)!.value)?.locator === id) return entity;
	}
	return undefined;
}

/** Only standing requests are links (a placed element is a fixed point). Each cycle member fails on its own turn; whoever is checked after the others failed aligns against their default placement. */
function inCycle(world: World, entity: Entity): boolean {
	const seen = new Set<Entity>([entity]);
	let current = entity;
	for (; ;) {
		const id = current.get(SyncRequest)?.value;
		if (id === undefined) return false;
		const next = findElementById(world, id, current);
		if (next === undefined) return false;
		if (next === entity) return true;
		if (seen.has(next)) return false;
		seen.add(next);
		current = next;
	}
}

/** On the element itself or on a fill (a `<rect><videoPaint/>` carries its src there). */
function waitingOnSources(entity: Entity): boolean {
	if (pendingSource(entity)) return true;
	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (pendingSource(fill)) return true;
	}
	return false;
}

function pendingSource(entity: Entity): boolean {
	return entity.has(LoadRequest) || entity.has(GenerationRequest) || entity.has(PendingSource);
}

function fail(entity: Entity, message: string): void {
	entity.remove(SyncRequest, PendingSync);
	entity.add(SourceError);
	entity.set(SourceError, { value: message, generated: false });
	console.error('[runtime] could not sync:', message);
}

function currentSync(entity: Entity, token: object): boolean {
	return entity.isAlive() && entity.get(PendingSync)?.value === token;
}

/** A pending `syncTo` counts: the clip has a source but not yet the placement a transcription would read it at. */
function hasPendingSources(world: World, scene: Entity, except: Entity): boolean {
	for (const entity of getEntityTree(world, scene)) {
		if (entity === except) continue;
		if (pendingSource(entity) || entity.has(SyncRequest) || entity.has(PendingSync)) {
			return true;
		}
	}
	return false;
}

/** PendingSource remembers which resolution the entity waits on, so of overlapping ones only the latest binds, and one outliving its element (or src) is dropped. */
function resolve(world: World, entity: Entity, promise: Promise<Asset>, generating = false): void {
	const token = {};
	entity.remove(SourceError);
	entity.add(PendingSource);
	entity.set(PendingSource, { value: token });
	if (generating) entity.add(Generating);

	const done = promise.then(async (asset) => {
		if (!current(entity, token)) return;
		bindAsset(entity, asset);
		await bindDomImage(entity, asset, token);
		if (current(entity, token)) entity.remove(PendingSource, Generating);
	}).catch((error: unknown) => {
		if (!current(entity, token)) return;
		entity.remove(PendingSource, Generating);
		entity.add(SourceError);
		entity.set(SourceError, { value: errorMessage(error), generated: generating });
		console.error('[runtime] could not resolve src:', error);
	});

	world.get(FramePromises)?.list?.push(done);
}

function isDomImage(entity: Entity): boolean {
	return typeof HTMLImageElement !== 'undefined'
		&& entity.get(Host)?.element instanceof HTMLImageElement;
}

function pointDomImageAt(entity: Entity, source: string | null): void {
	const node = entity.get(Host);
	const image = node?.element;
	if (typeof HTMLImageElement === 'undefined' || !(image instanceof HTMLImageElement) || !node) return;

	releaseDomImageSource(image);
	if (source === null) image.removeAttribute('src');
	else image.src = source;
}

export function releaseDomImageSource(image: HTMLImageElement): void {
	if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
}

async function bindDomImage(entity: Entity, asset: Asset, token: object): Promise<void> {
	if (!isDomImage(entity)) return;
	const file = await getAssetFile(asset);
	if (!current(entity, token)) return;

	const url = URL.createObjectURL(file);
	if (!current(entity, token)) {
		URL.revokeObjectURL(url);
		return;
	}

	pointDomImageAt(entity, url);
	const image = entity.get(Host)?.element;
	if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
		await image.decode().catch(() => undefined);
	}
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.trim() || 'Something went wrong';
}

function current(entity: Entity, token: object): boolean {
	return entity.isAlive() && entity.get(PendingSource)?.value === token;
}
