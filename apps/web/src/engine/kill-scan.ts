/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny';

import { killfeedUi, KILLFEED_AGENTS, KILLFEED_WEAPONS } from '@/lib/killfeed-assets';
import {
	BADGE, nameStrip, pickNames, placeKills, placeLength, prepareArt, ROW, scanLength, watchFeed, WEAPON, whoAmI,
	type FoundKill, type FrameSource, type PreparedArt, type Rgba, type Sighting, type Watched,
} from '@/lib/kill-read';
import { createNameReader } from '@/lib/name-ocr';
import { pictureClips } from '@/lib/scene-audio';

import type { Entity, World } from 'koota';

export type SceneKill = FoundKill & {
	/** Scene seconds. */
	at: number;
	/** As the video shows them, where they could be read. */
	killerName?: string;
	victimName?: string;
};

/** The killfeed is in the frame's top right: a square across, under half way down. */
const FEED_HEIGHT = 0.45;
/** Valorant's interface is laid out for a 1080 tall screen. */
const BASE_HEIGHT = 1080;

let art: Promise<PreparedArt> | undefined;

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Could not load ${url}`));
		image.src = url;
	});
}

async function pixels(url: string, width: number | null, height: number, mirror = false): Promise<Rgba> {
	const image = await loadImage(url);
	const canvas = document.createElement('canvas');
	canvas.width = width ?? Math.max(1, Math.round((image.naturalWidth * height) / image.naturalHeight));
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.imageSmoothingQuality = 'high';
	if (mirror) {
		ctx.translate(canvas.width, 0);
		ctx.scale(-1, 1);
	}
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** The pictures the feed is drawn from, at the size an entry is read at. */
function loadArt(): Promise<PreparedArt> {
	art ??= (async () => {
		const [agents, weapons, headshot] = await Promise.all([
			Promise.all(KILLFEED_AGENTS.map(async (agent) => ({ name: agent.name, picture: await pixels(agent.portrait, ROW * 2, ROW) }))),
			// The feed draws guns facing the victim, as lib/killfeed.ts does.
			Promise.all(KILLFEED_WEAPONS.map(async (weapon) => ({ id: weapon.id, picture: await pixels(weapon.url, null, WEAPON, weapon.group === 'weapons') }))),
			pixels(killfeedUi('headshot'), BADGE, BADGE),
		]);
		return prepareArt({ agents, weapons, headshot });
	})();
	art.catch(() => (art = undefined));
	return art;
}

type Reader = FrameSource & { dispose: () => void };

async function openReader(file: Blob): Promise<Reader | null> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	let track: InputVideoTrack | null = null;
	try {
		track = await input.getPrimaryVideoTrack();
		if (!track || !(await track.canDecode())) {
			input.dispose();
			return null;
		}
	} catch (error) {
		input.dispose();
		throw error;
	}
	const width = track.displayWidth;
	const height = track.displayHeight;
	const side = Math.min(width, height);
	const crop = { left: width - side, top: 0, width: side, height: Math.round(FEED_HEIGHT * height) };
	// Bigger than 1080 tall is read at 1080, where the thresholds are set; smaller as it is.
	const scale = Math.min(1, BASE_HEIGHT / height);
	const sink = new CanvasSink(track, {
		crop,
		width: Math.round(crop.width * scale),
		height: Math.round(crop.height * scale),
		fit: 'fill',
		poolSize: 2,
	});
	const [stats, duration] = await Promise.all([track.computePacketStats(100).catch(() => null), track.computeDuration()]);

	return {
		unit: (height * scale) / BASE_HEIGHT,
		frameRate: stats?.averagePacketRate || 60,
		duration,
		dispose: () => input.dispose(),
		async *frames(times) {
			for await (const wrapped of sink.canvasesAtTimestamps(times)) {
				if (!wrapped) {
					yield null;
					continue;
				}
				const { canvas, timestamp } = wrapped;
				const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
				yield { time: timestamp, frame: ctx.getImageData(0, 0, canvas.width, canvas.height) };
			}
		},
	};
}

/** Long enough to fetch the text model on a slow connection. */
const NAMES_TIMEOUT = 60_000;

/** The players' names, read off each entry; a kill whose names can't be read keeps the agents'. */
async function readNames(kills: SceneKill[], onKill?: (done: number) => void): Promise<SceneKill[]> {
	if (!kills.length) return kills;
	// Tesseract can fail to start without ever saying so; the kills shouldn't wait on it.
	const reader = await Promise.race([
		createNameReader(),
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out starting text recognition')), NAMES_TIMEOUT)),
	]).catch((error: unknown) => {
		console.warn('[kill-scan] names could not be read', error);
		return null;
	});
	if (!reader) return kills;
	try {
		const read = [];
		for (const kill of kills) {
			read.push({
				killer: await reader.read(nameStrip(kill.picture, kill.names.killer, 'killer')),
				victim: await reader.read(nameStrip(kill.picture, kill.names.victim, 'victim')),
			});
			onKill?.(read.length / kills.length);
		}
		const names = pickNames(kills, read);
		return kills.map((kill, index) => ({ ...kill, killerName: names[index]!.killer, victimName: names[index]!.victim }));
	} finally {
		await reader.close();
	}
}

/** Of the progress bar: watching the feed is most of the work, then timing each kill to its frame, then the names. */
const WATCH_SHARE = 0.75;
const PLACE_SHARE = 0.2;

/** Your kills and deaths in the scene's videos, by reading Valorant's killfeed in the top right. */
export async function findKills(world: World, scene: Entity, onProgress?: (done: number) => void): Promise<SceneKill[] | null> {
	const clips = await pictureClips(world, scene);
	if (!clips.length) return null;
	const prepared = await loadArt();
	const opened = await Promise.allSettled(clips.map((clip) => openReader(clip.file)));
	const readers = opened.map((result) => (result.status === 'fulfilled' ? result.value : null));
	const failed = opened.find((result) => result.status === 'rejected');
	if (failed) {
		for (const reader of readers) reader?.dispose();
		throw failed.reason;
	}
	try {
		const total = clips.reduce((sum, clip, index) => sum + (readers[index] ? scanLength(readers[index], clip.trimStart, clip.trimEnd) : 0), 0);
		let done = 0;
		const watched: (Watched | null)[] = [];
		for (const [index, clip] of clips.entries()) {
			const reader = readers[index];
			watched.push(reader && (await watchFeed(reader, clip.trimStart, clip.trimEnd, prepared, () => onProgress?.((++done / total) * WATCH_SHARE))));
		}

		// Clips cut from one video show one player, who a short clip on its own may show too few entries to tell.
		const sightings = new Map<string, Sighting[]>();
		clips.forEach((clip, index) => sightings.set(clip.asset, [...(sightings.get(clip.asset) ?? []), ...(watched[index]?.sightings ?? [])]));

		const me = clips.map((clip) => whoAmI(sightings.get(clip.asset)!));
		const placing = clips.reduce((sum, _, index) => sum + (readers[index] && watched[index] ? placeLength(readers[index], watched[index], me[index]) : 0), 0);
		let placed = 0;
		const kills: SceneKill[] = [];
		for (const [index, clip] of clips.entries()) {
			const reader = readers[index];
			const seen = watched[index];
			if (!reader || !seen) continue;
			const scene = (media: number) => (clip.at ? clip.at(media) : clip.origin + media / (clip.rate || 1));
			const found = await placeKills(reader, seen, me[index], () => onProgress?.(WATCH_SHARE + (++placed / placing) * PLACE_SHARE));
			for (const kill of found) kills.push({ ...kill, at: scene(kill.time) });
		}
		const named = await readNames(kills.sort((a, b) => a.at - b.at), (done) => onProgress?.(WATCH_SHARE + PLACE_SHARE + done * (1 - WATCH_SHARE - PLACE_SHARE)));
		onProgress?.(1);
		return named;
	} finally {
		for (const reader of readers) reader?.dispose();
	}
}
