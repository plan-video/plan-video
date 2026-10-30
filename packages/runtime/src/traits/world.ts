/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait, type Entity, type World } from 'koota';

import type { FontSource } from '../fonts/types';
import type { AssetLibrary } from '@plan.video/assets';
import type { GenAi } from '../ai';
import type { Quad } from '../math/aabb';


export const Project = trait({ id: '' });

// Tag on the single stage entity every runtime world owns.
export const Stage = trait();

export const Root = trait(() => null as Entity | null);

/**
 * 2D affine camera transform in CSS pixel space (before DPR scaling), on the
 * stage. The render system multiplies this by RenderSurface.resolution
 * to derive the canvas transform.
 */
export const Camera = trait({ a: 0.3, b: 0, c: 0, d: 0.3, e: 85, f: 150 });

export type Camera2D = { a: number; b: number; c: number; d: number; e: number; f: number };

export const DEFAULT_BACKGROUND = 0x161616;

export const Background = trait({ value: DEFAULT_BACKGROUND });

// On the world: what a live preview shows for a stage left on the default
// background. The editor sets it to its own canvas color, so the default
// follows the editor's theme; a background the project picked is drawn as is.
export const DefaultBackground = trait({ value: DEFAULT_BACKGROUND });

export const DEFAULT_GENERATING_PULSE = { from: 0x1c1c1c, to: 0x292929 };

// On the world: the two grays (0xRRGGBB) a node in generation pulses between
// in a live preview, so the editor can match them to its theme.
export const GeneratingPulse = trait({ ...DEFAULT_GENERATING_PULSE });

export type RuntimeMode = 'realtime' | 'offline-video' | 'offline-audio';

export const Mode = trait({ value: 'realtime' as RuntimeMode });

/** Nothing in this render is heard, so no audio decoder opens (frame capture). Kept apart from `Muted`, the composition's own. */
export const Silent = trait();

export const Time = trait({ now: 0, delta: 0 });

export const FrameRate = trait({ value: 30 });

// Render target injected by the host. Capture uses an HTML canvas too so HTML
// paint roots can live in its layout subtree. resolution is the pixel ratio.
export const RenderSurface = trait({
	canvas: () => null as HTMLCanvasElement | OffscreenCanvas | null,
	ctx: () => null as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
	resolution: 1,
});

/** Like After Effects' Full/Half/Quarter: 0.5 fills a quarter of the pixels and stretches them up. Offline renders ignore it. */
export const PreviewQuality = trait({ value: 1 });

// Audio output injected by the host: a realtime AudioContext in the editor,
// an OfflineAudioContext during capture.
export const AudioEngine = trait({
	context: () => null as AudioContext | OfflineAudioContext | null,
});

export const Fonts = trait({ list: () => [] as FontSource[] });

/** Null in a world without a project. */
export const Library = trait(() => null as AssetLibrary | null);

/** Optional: without one, `generate.*` sources stay pending and never resolve. */
export const Ai = trait(() => null as GenAi | null);

/** Fired by the playback system once per tick, after playheads advance, so whatever runs the systems drives the mounts without knowing them. */
export const Tickers = trait(() => new Set<() => void>());

// Async barrier for offline capture: systems push decoder/host readiness
// promises here; the encoder awaits and clears them before sampling a frame.
// null in realtime mode (nothing collects).
export const FramePromises = trait({
	list: () => null as (Promise<unknown> | null)[] | null,
});

export type EntityTarget = {
	kind: 'entity';
	id: Entity;
};

export type HudTarget = {
	kind: 'hud';
	id: string;
	quad: Quad;
	entity?: Entity;
};

export type PointerEventType =
	| 'pointermove'
	| 'pointerdown'
	| 'pointerup'
	| 'pointerenter'
	| 'pointerleave'
	| 'dragstart'
	| 'drag'
	| 'dragend'
	| 'click'
	| 'dblclick';

/** Canvas device pixels (CSS pixels × resolution), the space of WorldTransform and the hit quads. The app's input layer distills one per DOM event. */
export type CanvasPointerEvent = {
	type: PointerEventType;
	clientX: number;
	clientY: number;
	button: number; // 0: left, 1: middle, 2: right
};

export type DispatchedPointerEvent = CanvasPointerEvent & {
	target: EntityTarget | HudTarget;
};

/** Paint order, topmost last. The render system pushes callback-less entries; the app's input system clears them each frame and adds its HUD handlers. */
export type HitRegion = {
	target: EntityTarget | HudTarget;
	callback?: (world: World, event: DispatchedPointerEvent) => void;
};

export const HitRegions = trait({ list: () => [] as HitRegion[] });
