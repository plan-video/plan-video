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

/**
 * With nothing moving, the loop runs this often instead of every frame, on a
 * timer rather than animation frames. Each pass redraws the stage and the
 * timeline whether or not anything changed, which a browser without hardware
 * acceleration copies on the CPU, and a pending animation frame alone has the
 * browser prepare and commit a frame: an editor left open and still kept a
 * third of the main thread busy on a fast Mac. Anything this misses (an
 * agent's edit) still shows within this long.
 */
const IDLE_FRAME_MS = 100;

/**
 * How long after input or playback the loop keeps running every frame, so a
 * gesture's last moves and the playhead's trail settle smoothly.
 */
const ACTIVE_AFTER_MS = 500;

/** Events that mean someone is using the editor, wherever on the page. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'dragover', 'drop'] as const;

export interface EngineOptions {
	/**
	 * Inject an existing AudioContext (e.g. shared across projects). When
	 * omitted, the engine creates and owns one; it is closed on dispose().
	 */
	audioContext?: AudioContext;
}

class Engine {
	readonly world: RuntimeWorld;

	private canvas: HTMLCanvasElement | null = null;
	/** The canvas's size in CSS pixels when it was last measured, null until it is. */
	private size: { width: number; height: number } | null = null;
	private rafId: number | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private lastTimestamp: number | null = null;
	/** Errors a frame has thrown, by message, so each is reported once rather than every frame. */
	private readonly reported = new Set<string>();
	private resizeObserver = new ResizeObserver(this.resize.bind(this));

	private readonly audioContext: AudioContext;
	private readonly ownsAudioContext: boolean;

	private unsubscribe: (() => void)[] = [];
	private interactiveDirty = true;

	/**
	 * Until when the loop runs every frame, a timestamp on the frame clock;
	 * Infinity for "from the next frame on", set where that clock is not at hand.
	 */
	private activeUntil = Infinity;
	private lastCamera: readonly number[] = [];

	public running: Accessor<boolean>;
	private setRunning: Setter<boolean>;

	/**
	 * Ticks once per frame, after the systems ran. The one signal derived
	 * state is sampled against (see `useDerived`); a plain Solid signal, so
	 * following the tick costs no koota subscription.
	 */
	public frame: Accessor<number>;
	private setFrame: Setter<number>;

	public constructor(projectId: string, options: EngineOptions = {}) {
		this.world = createRuntimeWorld(projectId);
		this.world.add(Pointer, Keys, SnapLines, Hud, EditorTheme, DefaultBackground, GeneratingPulse, PointerEvents, AssetSelection, ProjectConfig, TimelineSurface, PreviewQuality({ value: getSavedPreviewQuality() }));

		this.unsubscribe.push(
			this.world.onAdd(ChildOf('*'), () => (this.interactiveDirty = true)),
			this.world.onRemove(ChildOf('*'), () => (this.interactiveDirty = true)),
			// The timeline keeps a clip's waveform and thumbnails by entity id,
			// and koota hands ids back out: a clip that is gone has to take its
			// pictures with it, or the next clip to be given its id inherits them.
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

	/**
	 * Whether the pointer is on the stage, which a shortcut reads to tell a
	 * press that could start a canvas gesture from one that could not.
	 */
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

	/**
	 * Only records: what a press does is decided once a frame by the shortcut
	 * system. Presses in text fields belong to the field. The one thing
	 * decided here is whether the browser gets the event, since that cannot
	 * wait for the frame — backspace would have navigated by then.
	 */
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

	/**
	 * Runs the next frames in full: someone is using the editor, or something
	 * changed that should not wait for the next idle pass to show.
	 */
	public readonly wake = (): void => {
		this.activeUntil = Infinity;
		this.requestFrame();
	}

	/** Asks for the next frame now, unless one is already coming. */
	private requestFrame(): void {
		if (!this.running() || this.rafId !== null) return;
		if (this.idleTimer !== null) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		this.rafId = requestAnimationFrame(this.loop);
	}

	/**
	 * Whether the frame after this one has anything new to show: someone used
	 * the editor a moment ago, a scene is playing, the camera is moving, or a
	 * fill is shimmering while it generates.
	 */
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

		// The first frame after an idle stretch steps nothing forward: a play
		// started from idle must not jump by the length of the wait.
		const delta = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
		this.lastTimestamp = timestamp;
		this.world.set(Time, { now: timestamp, delta });

		// Moved from outside the loop (a zoom to fit settling): animate it.
		const camera = getCameraMatrix(this.world);
		if (this.activeUntil === Infinity || camera.some((value, index) => value !== this.lastCamera[index])) {
			this.activeUntil = timestamp + ACTIVE_AFTER_MS;
		}

		if (this.interactiveDirty) {
			syncInteractiveState(this.world);
			this.interactiveDirty = false;
		}

		// A frame that throws must not end the loop: the canvas would freeze
		// (or stay half drawn) until the page is reloaded. The error still
		// goes to the console and Sentry, once.
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
		// A detached or hidden canvas measures 0×0. Culling against that would
		// release every decoder and restart all audio once the canvas is back.
		if (width === 0 || height === 0) return;
		const dpr = window.devicePixelRatio;

		// The camera's offset is from the canvas's top-left corner, so a canvas
		// that grows (panels hidden) would leave the stage up and to the left.
		// Moving it by half the change keeps what was in the middle there.
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

	/**
	 * The canvas as a PNG. `frame` is drawn filling the shot — a project cover
	 * wants the scene, not whatever corner the canvas was scrolled to — and
	 * the view is put back before the next paint.
	 */
	public snapshot(frame?: Rect): Promise<Blob | null> {
		const canvas = this.canvas;
		if (!canvas?.width || !canvas.height) return Promise.resolve(null);

		const previous = frame ? getCameraMatrix(this.world) : null;
		if (frame) focusRect(this.world, frame, 0);

		const mode = this.world.get(Mode)?.value ?? 'realtime';
		this.world.set(Mode, { value: 'offline-video' });
		if (frame) transformSystem(this.world);
		renderSystem(this.world);

		// Copied now: `toBlob` encodes later, and the canvas is about to show
		// the live view again.
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

		// The timeline's decoded pictures and peaks are of this project's
		// files, and are held outside the world: they go with the engine.
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
