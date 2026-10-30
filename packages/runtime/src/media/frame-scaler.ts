/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Scales decoded video frames down to their cache tile on worker threads,
 * for browsers that draw them slowly on the page's own thread.
 *
 * With hardware acceleration on, drawing a frame into the cache is a GPU copy
 * of a fraction of a millisecond. Without it (Chrome's "Use graphics
 * acceleration" off, a blocklisted GPU), the browser converts every 1080p
 * frame from YUV and scales it on the CPU, ~4 ms on a fast laptop and several
 * times that on an ordinary PC: playing a 60 fps clip then takes most of the
 * main thread and the whole editor stutters or freezes. Which browser this is
 * is not asked but measured, from the draws the cache does itself.
 */

/** A frame drawn on the main thread slower than this counts as a slow draw. */
const SLOW_DRAW_MS = 1.5;

/** The first draws warm the context up, and are left out of the count. */
const WARMUP_DRAWS = 3;

/** Draws timed before deciding. */
const SAMPLE_DRAWS = 8;

/** Most of them slow sends every frame after to the workers. */
const SLOW_DRAWS_NEEDED = 6;

/** Frames out at the workers at once; past this the caller draws in place. */
const MAX_IN_FLIGHT = 8;

const WORKER_SOURCE = `
let canvas = null;
let ctx = null;
self.onmessage = ({ data }) => {
	const { id, frame, width, height, rotation } = data;
	try {
		if (!canvas || canvas.width !== width || canvas.height !== height) {
			canvas = new OffscreenCanvas(width, height);
			ctx = canvas.getContext('2d');
			ctx.imageSmoothingQuality = 'high';
		}
		const turned = rotation === 90 || rotation === 270;
		const w = turned ? height : width;
		const h = turned ? width : height;
		ctx.setTransform(1, 0, 0, 1, width / 2, height / 2);
		ctx.rotate((rotation * Math.PI) / 180);
		ctx.drawImage(frame, -w / 2, -h / 2, w, h);
		frame.close();
		const bitmap = canvas.transferToImageBitmap();
		self.postMessage({ id, bitmap }, [bitmap]);
	} catch (error) {
		frame.close();
		self.postMessage({ id, error: String(error) });
	}
};
`;

type Job = { resolve: (bitmap: ImageBitmap | null) => void };

let timed = 0;
let slow = 0;
let offload = false;
let broken = false;

let workers: Worker[] = [];
let next = 0;
let nextId = 0;
const jobs = new Map<number, Job>();

/**
 * Counts how long one main-thread draw of a video frame took. Once enough of
 * them are slow, `scaleFrame` takes the frames from then on.
 */
export function recordFrameDraw(ms: number): void {
	if (offload || broken) return;
	timed++;
	if (timed <= WARMUP_DRAWS) return;
	if (ms > SLOW_DRAW_MS) slow++;
	if (timed - WARMUP_DRAWS < SAMPLE_DRAWS) return;

	if (slow >= SLOW_DRAWS_NEEDED) {
		offload = true;
	} else {
		// Not slow (yet): start the count over, so a machine that gets slower
		// (a second clip, a 4K one) is still caught.
		timed = WARMUP_DRAWS;
		slow = 0;
	}
}

/**
 * `frame` drawn upright into a `width` × `height` bitmap on a worker, or null
 * when the main thread should draw it: draws there are fast, the workers are
 * full, or they cannot be had. A frame handed over is the worker's, and
 * closed by it; the promise gives null if it could not be drawn.
 */
export function scaleFrame(frame: VideoFrame, width: number, height: number, rotation: number): Promise<ImageBitmap | null> | null {
	if (!offload || broken || jobs.size >= MAX_IN_FLIGHT || width <= 0 || height <= 0) return null;

	const pool = getWorkers();
	if (!pool) return null;

	const id = nextId++;
	const worker = pool[next++ % pool.length]!;

	return new Promise<ImageBitmap | null>((resolve) => {
		jobs.set(id, { resolve });
		try {
			worker.postMessage({ id, frame, width, height, rotation }, [frame as unknown as Transferable]);
		} catch {
			// A browser that cannot send a frame to a worker draws on the page.
			jobs.delete(id);
			broken = true;
			resolve(null);
		}
	});
}

/** Whether frames are being sent to the workers. */
export function isScalingOffThread(): boolean {
	return offload && !broken;
}

function getWorkers(): Worker[] | null {
	if (workers.length) return workers;
	if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
		broken = true;
		return null;
	}

	try {
		const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
		// Each worker keeps a core busy while it draws; leave the page and the
		// decoder theirs.
		const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
		for (let i = 0; i < count; i++) {
			const worker = new Worker(url);
			worker.onmessage = onMessage;
			worker.onerror = onError;
			workers.push(worker);
		}
	} catch {
		for (const worker of workers) worker.terminate();
		workers = [];
		broken = true;
		return null;
	}

	return workers;
}

function onMessage({ data }: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>): void {
	const job = jobs.get(data.id);
	jobs.delete(data.id);
	if (!job) {
		data.bitmap?.close();
		return;
	}
	job.resolve(data.bitmap ?? null);
}

function onError(): void {
	// A worker that will not run (a blocked blob: URL) leaves the frames to
	// the page, as before.
	broken = true;
	for (const worker of workers) worker.terminate();
	workers = [];
	for (const job of jobs.values()) job.resolve(null);
	jobs.clear();
}
