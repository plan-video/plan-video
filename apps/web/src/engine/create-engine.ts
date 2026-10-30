/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetSystem, renderSystem, transformSystem, playbackSystem, motionSystem, AudioEngine, createRuntimeWorld, focusRect, Geometry, getCameraMatrix, Mode, PreviewQuality, RenderSurface, setCameraMatrix, Time, ChildOf, syncInteractiveState, DefaultBackground, Generating, GeneratingPulse, onVideoFrame, panCamera, Playback } from '@plan.video/runtime';
import { hudSystem } from './hud';
import { createSignal, type Accessor, type Setter } from 'solid-js';
import { AssetSelection, EditorTheme, Hud, Keys, MODIFIER_KEYS, Pointer, PointerEvents, ProjectConfig, SnapLines } from './traits';
import { inputSystem } from './input/input-system';
import { clearClipFrames, clearClipPeaks, clearMedia, clearPeaks, timelineSystem, TimelineSurface } from './timeline';
import { shortcutSystem } from './input/shortcuts';
import { getSavedPreviewQuality } from './preview-quality';

import type { Rect, RuntimeWorld } from '@plan.video/runtime';
import type { CanvasPointerEvent, PointerEventType } from '@plan.video/runtime';

// Idle loop interval, on a timer rather than animation frames: every pass
// redraws stage and timeline, which costs a lot without hardware acceleration,
// and a pending animation frame alone makes the browser commit a frame.
const IDLE_FRAME_MS = 100;

const ACTIVE_AFTER_MS = 500;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'dragover', 'drop'] as const;

export interface EngineOptions {
	// When omitted, the engine creates and owns one and closes it on dispose().
	audioContext?: AudioContext;
}

class Engine {
	readonly world: RuntimeWorld;

	private canvas: HTMLCanvasElement | null = null;
	private size: { width: number; height: number } | null = null;
	private rafId: number | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private lastTimestamp: number | null = null;
	private readonly reported = new Set<string>();
	private resizeObserver = new ResizeObserver(this.resize.bind(this));

	private readonly audioContext: AudioContext;
	private readonly ownsAudioContext: boolean;

	private unsubscribe: (() => void)[] = [];
	private interactiveDirty = true;

	// A timestamp on the frame clock; Infinity means "from the next frame on".
	private activeUntil = Infinity;
	private lastCamera: readonly number[] = [];

	public running: Accessor<boolean>;
	private setRunning: Setter<boolean>;

	// Ticks once per frame after the systems ran; derived state samples against
	// it (see `useDerived`). A plain Solid signal, so it costs no koota subscription.
	public frame: Accessor<number>;
	private setFrame: Setter<number>;

	public constructor(projectId: string, options: EngineOptions = {}) {
		this.world = createRuntimeWorld(projectId);
		this.world.add(Pointer, Keys, SnapLines, Hud, EditorTheme, DefaultBackground, GeneratingPulse, PointerEvents, AssetSelection, ProjectConfig, TimelineSurface, PreviewQuality({ value: getSavedPreviewQuality() }));

		this.unsubscribe.push(
			this.world.onAdd(ChildOf('*'), () => (this.interactiveDirty = true)),
			this.world.onRemove(ChildOf('*'), () => (this.interactiveDirty = true)),
			// koota reuses entity ids: a removed clip's pictures must go with it, or the
			// next clip given its id inherits them.
			this.world.onRemove(Geometry, (entity) => {
				clearClipPeaks(entity.id());
				clearClipFrames(entity.id());
			}),
			// A frame decoded after a seek shows now, not at the next idle pass.
			onVideoFrame(this.wake),
		);

		[this.running, this.setRunning] = createSignal(false);
		[this.frame, this.setFrame] = createSignal(0);

		this.ownsAudioContext = options.audioContext === undefined;
		this.audioContext = options.audioContext ?? new AudioContext({ latencyHint: 'playback' });
		this.world.set(AudioEngine, { context: this.audioContext });
	}

	private readonly onClick = (event: MouseEvent) => {
		this.addEvent('click', event);
	}

	private readonly onDoubleClick = (event: MouseEvent) => {
		this.addEvent('dblclick', event)
	}

	private readonly onPointerDown = (event: PointerEvent) => {
		this.addEvent('pointerdown', event)
	}

	private readonly onPointerMove = (event: PointerEvent) => {
		this.addEvent('pointermove', event)
	}

	private readonly onPointerUp = (event: PointerEvent) => {
		this.addEvent('pointerup', event)
	}

	private readonly onPointerEnter = () => {
		this.world.set(Pointer, { over: true });
	}

	private readonly onPointerLeave = () => {
		this.world.set(Pointer, { over: false });
	}

	private readonly onBlur = () => {
		// Key-up never arrives when focus leaves mid-hold (⌘-tab, devtools).
		this.world.get(Keys)!.held.clear();
	}

	// Only records; the shortcut system decides once a frame. Whether the browser
	// gets the event cannot wait for the frame: backspace would have navigated.
	private readonly onKeyDown = (event: KeyboardEvent) => {
		if (
			event.target instanceof HTMLInputElement
			|| event.target instanceof HTMLTextAreaElement
			|| (event.target instanceof HTMLElement && event.target.isContentEditable)
		) return;

		const keys = this.world.get(Keys)!;
		const key = event.key.toLowerCase();
		const isMod = event.key === 'Meta' || event.key === 'Control';

		keys.held.add(key);
		if (isMod) keys.held.add('mod');
		if (!event.repeat) {
			keys.pressed.add(key);
			if (isMod) keys.pressed.add('mod');
		}

		event.preventDefault();
	}

	private readonly onKeyUp = (event: KeyboardEvent) => {
		const keys = this.world.get(Keys)!;
		const key = event.key.toLowerCase();
		const isMod = event.key === 'Meta' || event.key === 'Control';

		keys.held.delete(key);
		keys.lifted.add(key);

		if (!isMod) return;

		keys.held.delete('mod');
		keys.lifted.add('mod');

		for (const stale of [...keys.held]) {
			// macOS never delivers the key-up of a key released while ⌘ is held
			if (!MODIFIER_KEYS.has(stale)) keys.held.delete(stale);
		}
	};

	public readonly wake = (): void => {
		this.activeUntil = Infinity;
		this.requestFrame();
	}

	private requestFrame(): void {
		if (!this.running() || this.rafId !== null) return;
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		this.rafId = requestAnimationFrame(this.loop);
	}

	private isActive(timestamp: number): boolean {
		if (this.interactiveDirty || timestamp < this.activeUntil) return true;

		for (const entity of this.world.query(Playback)) {
			if (entity.get(Playback)!.playing) {
				this.activeUntil = timestamp + ACTIVE_AFTER_MS;
				return true;
			}
		}

		return this.world.query(Generating).length > 0;
	}

	private readonly loop = (timestamp: number): void => {
		this.rafId = null;

		// A play started from idle must not jump by the length of the wait.
		const delta = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
		this.lastTimestamp = timestamp;
		this.world.set(Time, { now: timestamp, delta });

		const camera = getCameraMatrix(this.world);
		if (this.activeUntil === Infinity || camera.some((value, index) => value !== this.lastCamera[index])) {
			this.activeUntil = timestamp + ACTIVE_AFTER_MS;
		}

		if (this.interactiveDirty) {
			syncInteractiveState(this.world);
			this.interactiveDirty = false;
		}

		// A frame that throws must not end the loop, or the canvas freezes until
		// reload. The error is still reported once.
		try {
			this.runSystems();
		} catch (error) {
			this.report(error);
		}
		this.setFrame((count) => count + 1);
		this.lastCamera = getCameraMatrix(this.world);

		const keys = this.world.get(Keys);
		keys?.pressed.clear();
		keys?.lifted.clear();

		if (this.isActive(timestamp)) {
			this.rafId = requestAnimationFrame(this.loop);
		} else {
			this.lastTimestamp = null;
			this.idleTimer = setTimeout(() => {
				this.idleTimer = null;
				this.requestFrame();
			}, IDLE_FRAME_MS);
		}
	}

	private report(error: unknown): void {
		const key = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		if (this.reported.has(key)) return;
		this.reported.add(key);
		reportError(error);
	}

	private resize(): void {
		const parent = this.canvas?.parentElement;
		if (!parent || !this.canvas) return;

		const { width, height } = parent.getBoundingClientRect();
		// A detached or hidden canvas measures 0×0; culling against that would release
		// every decoder and restart all audio once it is back.
		if (width === 0 || height === 0) return;
		const dpr = window.devicePixelRatio;

		// The camera offset is from the top-left corner, so on resize move it by half
		// the change to keep the middle in place.
		const previous = this.size;
		this.size = { width, height };
		if (previous && (width !== previous.width || height !== previous.height)) {
			panCamera(this.world, (previous.width - width) / 2, (previous.height - height) / 2);
		}

		const pixelWidth = Math.round(width * dpr);
		const pixelHeight = Math.round(height * dpr);

		if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
			this.canvas.width = pixelWidth;
			this.canvas.height = pixelHeight;
		}
		this.canvas.style.width = `${width}px`;
		this.canvas.style.height = `${height}px`;

		this.world.set(RenderSurface, { resolution: dpr });

		this.runSystems();
		this.wake();
	}

	private addEvent(type: PointerEventType, event: PointerEvent | MouseEvent): void {
		if (!this.canvas) return;
		const rect = this.canvas.getBoundingClientRect();
		const resolution = this.world.get(RenderSurface)?.resolution ?? 1;

		this.world.get(PointerEvents)?.queue.push({
			type,
			clientX: (event.clientX - rect.left) * resolution,
			clientY: (event.clientY - rect.top) * resolution,
			button: event.button,
		} as CanvasPointerEvent);
	};

	private runSystems(): void {
		inputSystem(this.world);
		shortcutSystem(this.world);
		assetSystem(this.world);
		playbackSystem(this.world);
		motionSystem(this.world);
		transformSystem(this.world);
		renderSystem(this.world);
		hudSystem(this.world);
		timelineSystem(this.world);
	}

	public start(): void {
		if (this.running()) return;
		this.setRunning(true);
		this.lastTimestamp = null;
		this.wake();
	}

	public stop(): void {
		this.setRunning(false);
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	public mount(canvas: HTMLCanvasElement): void {
		this.unsubscribeEventListeners();

		this.canvas = canvas;
		this.size = null;
		this.world.set(RenderSurface, { canvas, ctx: canvas.getContext('2d') });

		canvas.addEventListener('click', this.onClick);
		canvas.addEventListener('dblclick', this.onDoubleClick);
		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('pointerenter', this.onPointerEnter);
		canvas.addEventListener('pointerleave', this.onPointerLeave);
		window.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('pointercancel', this.onPointerUp);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);
		for (const type of ACTIVITY_EVENTS) window.addEventListener(type, this.wake, { capture: true, passive: true });

		this.resizeObserver.observe(canvas.parentElement!);
	}

	// `frame` is drawn filling the shot; the view is put back before the next paint.
	public snapshot(frame?: Rect): Promise<Blob | null> {
		const canvas = this.canvas;
		if (!canvas?.width || !canvas.height) return Promise.resolve(null);

		const previous = frame ? getCameraMatrix(this.world) : null;
		if (frame) focusRect(this.world, frame, 0);

		const mode = this.world.get(Mode)?.value ?? 'realtime';
		this.world.set(Mode, { value: 'offline-video' });
		if (frame) transformSystem(this.world);
		renderSystem(this.world);

		// Copied now: `toBlob` encodes later, after the canvas shows the live view again.
		const copy = document.createElement('canvas');
		copy.width = canvas.width;
		copy.height = canvas.height;
		copy.getContext('2d')?.drawImage(canvas, 0, 0);

		if (previous) setCameraMatrix(this.world, previous);
		this.world.set(Mode, { value: mode });
		if (previous) transformSystem(this.world);
		renderSystem(this.world);
		hudSystem(this.world);

		return new Promise((resolve) => copy.toBlob(resolve, 'image/png'));
	}

	public dispose(): void {
		this.stop();
		if (this.ownsAudioContext) {
			this.audioContext.close();
		}

		// Held outside the world, so they go with the engine.
		clearPeaks();
		clearMedia();

		this.unsubscribeEventListeners();
		this.unsubscribe.forEach(unsubscribe => unsubscribe());
		this.unsubscribe.length = 0;
		this.world.get(PointerEvents)?.queue.splice(0);
		this.world.destroy();
	}

	private unsubscribeEventListeners(): void {
		this.canvas?.removeEventListener('click', this.onClick);
		this.canvas?.removeEventListener('dblclick', this.onDoubleClick);
		this.canvas?.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas?.removeEventListener('pointermove', this.onPointerMove);
		this.canvas?.removeEventListener('pointerenter', this.onPointerEnter);
		this.canvas?.removeEventListener('pointerleave', this.onPointerLeave);
		window.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('pointercancel', this.onPointerUp);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, this.wake, { capture: true });
		this.resizeObserver.disconnect();
	}
}

export function createEngine(projectId: string, options: EngineOptions = {}): Engine {
	return new Engine(projectId, options);
}

export type { Engine };
