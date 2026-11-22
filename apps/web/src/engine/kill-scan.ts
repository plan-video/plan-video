/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny';

import { killfeedUi, KILLFEED_AGENTS, KILLFEED_WEAPONS } from '@/lib/killfeed-assets';
import {
	arrival, BADGE, createTracker, gatherKills, measureColumn, nameStrip, pickNames, prepareArt, readKill, readRows, ROW, WEAPON,
	type FeedRow, type FoundKill, type PreparedArt, type Rgba,
} from '@/lib/kill-read';
import { createNameReader } from '@/lib/name-ocr';
import { pictureClips } from '@/lib/scene-audio';

import type { SpeechClip } from '@/lib/scene-audio';
import type { Entity, World } from 'koota';

export type SceneKill = FoundKill & {
	/** Scene seconds. */
	at: number;
	/** As the video shows them, where they could be read. */
	killerName?: string;
	victimName?: string;
};

/** Often enough to catch every entry, which stays up for seconds. */
const STEP = 0.1;
/** How far before an entry was first caught to look for the frame it came in on. */
const LOOKBACK = 1;
/** And after: it was caught mid-arrival, and is followed back from where it looks settled. */
const SETTLE = 0.3;
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

type Reader = {
	unit: number;
	/** In seconds, the clip's frames, oldest first; null where the file has none. */
	frames: (times: number[]) => AsyncGenerator<{ time: number; frame: Rgba } | null>;
	frameRate: number;
	dispose: () => void;
};

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
	const stats = await track.computePacketStats(100).catch(() => null);

	return {
		unit: (height * scale) / BASE_HEIGHT,
		frameRate: stats?.averagePacketRate || 60,
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

function sampleTimes(from: number, to: number, step: number): number[] {
	const times: number[] = [];
	for (let time = from; time <= to; time += step) times.push(time);
	return times;
}

async function scanClip(clip: SpeechClip, prepared: PreparedArt, onFrame: () => void): Promise<SceneKill[]> {
	const reader = await openReader(clip.file);
	if (!reader) return [];
	try {
		const tracker = createTracker();
		const seen: FeedRow[] = [];
		for await (const read of reader.frames(sampleTimes(clip.trimStart, clip.trimEnd, STEP))) {
			onFrame();
			if (!read) continue;
			const rows = readRows(read.frame, reader.unit);
			seen.push(...rows);
			const column = measureColumn(seen);
			if (column) tracker.see(read.time, read.frame, rows, column, reader.unit);
		}

		const found = gatherKills(
			tracker.kills().flatMap((track) => {
				const kill = track.picture && readKill(track.picture, prepared);
				return kill ? [{ time: track.first, death: track.mine === 'victim', seen: track.seen, row: track.arrived, picture: track.picture!, kill }] : [];
			}),
		);

		// Caught a tenth of a second apart; the entry came in on one frame, flashing its colour first.
		const step = 1 / reader.frameRate;
		const scene = (media: number) => (clip.at ? clip.at(media) : clip.origin + media / (clip.rate || 1));
		const kills: SceneKill[] = [];
		for (const kill of found) {
			const frames: { time: number; frame: Rgba }[] = [];
			for await (const read of reader.frames(sampleTimes(Math.max(clip.trimStart, kill.time - LOOKBACK), Math.min(clip.trimEnd, kill.time + SETTLE), step))) {
				if (read) frames.push(read);
			}
			const time = arrival(frames, kill.row, kill.time) ?? kill.time;
			kills.push({ ...kill, time, at: scene(time) });
		}
		return kills;
	} finally {
		reader.dispose();
	}
}

/** Long enough to fetch the text model on a slow connection. */
const NAMES_TIMEOUT = 60_000;

/** The players' names, read off each entry; a kill whose names can't be read keeps the agents'. */
async function readNames(kills: SceneKill[]): Promise<SceneKill[]> {
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
		}
		const names = pickNames(kills, read);
		return kills.map((kill, index) => ({ ...kill, killerName: names[index]!.killer, victimName: names[index]!.victim }));
	} finally {
		await reader.close();
	}
}

/** Reading the frames is most of the work; the names come after. */
const FRAMES_SHARE = 0.9;

/** Your kills and deaths in the scene's videos, by reading Valorant's killfeed in the top right. */
export async function findKills(world: World, scene: Entity, onProgress?: (done: number) => void): Promise<SceneKill[] | null> {
	const clips = await pictureClips(world, scene);
	if (!clips.length) return null;
	const prepared = await loadArt();
	const total = clips.reduce((sum, clip) => sum + sampleTimes(clip.trimStart, clip.trimEnd, STEP).length, 0);
	let done = 0;
	const kills: SceneKill[] = [];
	for (const clip of clips) {
		kills.push(...(await scanClip(clip, prepared, () => onProgress?.((++done / total) * FRAMES_SHARE))));
	}
	const named = await readNames(kills.sort((a, b) => a.at - b.at));
	onProgress?.(1);
	return named;
}
