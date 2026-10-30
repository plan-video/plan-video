/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The controller never paints: it changes view state on the scene, which the draw pass reads a frame later. */

import { getTimelineView } from '@plan.video/runtime';

import { assert, clamp } from '@/utils';
import { getDocumentEditor } from '@/engine/editor';
import { createPointer } from './pointer';
import { TimelineSurface } from './surface';
import { timelineSystem } from './timeline';
import {
	getResolution,
	getScrollX,
	getScrollY,
	getTimelineScene,
	pixelsToFrames,
	setResolution,
	setScrollX,
	setScrollY,
	updateTimelineTransform,
} from './view';
import {
	SCROLL_X_SENSITIVITY,
	TIMELINE_RESOLUTION_RANGE,
	WHEEL_LINE_HEIGHT,
	WHEEL_PAGE_HEIGHT,
	ZOOM_DELTA_CLAMP,
	ZOOM_SENSITIVITY,
} from './config';
import { getFrameRate } from './view';

import type { Entity, World } from 'koota';

export type TimelineController = ReturnType<typeof createTimelineController>;

export function createTimelineController(world: World) {
	const surface = world.get(TimelineSurface)!;

	const pointer = createPointer({
		get marquee() { return surface.marquee; },
		get canvas() { return surface.canvas; },
		get ctx() { return surface.ctx; },
	});

	let layersEl: HTMLElement | null = null;
	let layersViewportEl: HTMLElement | null = null;
	// Pixels. Same for every scene, so kept on the DOM side rather than the scene's.
	let layerScrollX = 0;

	const withScene = (action: (scene: Entity) => void): void => {
		const scene = getTimelineScene(world);
		if (scene !== null) action(scene);
	};

	/** No `previous`, so a view change never enters the history. */
	const reportView = (scene: Entity): void => {
		const view = getTimelineView(world, scene);
		if (view) getDocumentEditor(world).reportEdit(scene, 'timeline', view);
	};

	const applyResize = (): void => {
		const { canvas } = surface;
		const parent = canvas?.parentElement;
		if (!parent || !canvas) return;

		surface.layout = parent.getBoundingClientRect();
		applyScroll();

		const dpr = window.devicePixelRatio;

		canvas.style.width = `${surface.layout.width}px`;
		canvas.style.height = `${surface.layout.height}px`;

		const width = Math.floor(surface.layout.width * dpr);
		const height = Math.floor(surface.layout.height * dpr);
		if (canvas.width === width && canvas.height === height) return;

		canvas.width = width;
		canvas.height = height;
	};

	const resize = (): void => {
		applyResize();
		withScene((scene) => updateTimelineTransform(world, scene));
		timelineSystem(world);
	};

	const observer = new ResizeObserver(resize);

	const layerObserver = new ResizeObserver(() => {
		applyScroll();
		withScene((scene) => updateTimelineTransform(world, scene));
	});

	/** Labels are DOM, so they are translated to match the canvas scroll. */
	const applyScroll = (): void => {
		if (!layersEl || !layersViewportEl) return;

		withScene((scene) => {
			const scrollY = clamp(getScrollY(world, scene), 0, Math.max(0, layersEl!.scrollHeight - layersViewportEl!.clientHeight));
			setScrollY(world, scene, scrollY);
			layersEl!.style.transform = `translateY(${-scrollY}px)`;
		});

		let maxScrollX = 0;
		for (const label of layersEl.querySelectorAll<HTMLElement>('[data-layer-label]')) {
			maxScrollX = Math.max(maxScrollX, label.scrollWidth - label.clientWidth);
		}
		layerScrollX = clamp(layerScrollX, 0, maxScrollX);
		layersEl.style.setProperty('--layer-x', `${layerScrollX}px`);
	};

	const rowsOverflow = (): boolean => (
		layersEl !== null && layersViewportEl !== null && layersEl.scrollHeight > layersViewportEl.clientHeight
	);

	/**
	 * A mouse wheel only turns one way, so it scrolls sideways with Shift held
	 * (not every browser turns that into a sideways delta itself), and also when
	 * the rows all fit.
	 */
	const handleWheel = (event: WheelEvent): void => {
		event.preventDefault();

		withScene((scene) => {
			let { deltaX, deltaY } = normalizeWheel(event);
			const sideways = event.shiftKey || !rowsOverflow();
			if (sideways && !event.ctrlKey && !event.metaKey && deltaX === 0) {
				deltaX = deltaY;
				deltaY = 0;
			}
			const resolution = getResolution(world, scene);
			const scrollX = getScrollX(world, scene);

			if (event.ctrlKey || event.metaKey) {
				const rect = surface.canvas?.getBoundingClientRect();
				const anchor = event.clientX - (rect?.left ?? 0);

				const delta = clamp(deltaY, -ZOOM_DELTA_CLAMP, ZOOM_DELTA_CLAMP);
				const next = clamp(
					resolution * Math.exp(-delta * ZOOM_SENSITIVITY),
					1 / TIMELINE_RESOLUTION_RANGE[1],
					1 / TIMELINE_RESOLUTION_RANGE[0],
				);

				// Keep the frame under the pointer still while the scale changes.
				setResolution(world, scene, next);
				setScrollX(world, scene, scrollX + anchor / resolution - anchor / next);
			} else if (Math.abs(deltaX) > Math.abs(deltaY)) {
				setScrollX(world, scene, scrollX + (deltaX * SCROLL_X_SENSITIVITY) / resolution);
			} else {
				setScrollY(world, scene, getScrollY(world, scene) + deltaY);
				applyScroll();
			}

			updateTimelineTransform(world, scene);
			reportView(scene);
		});
	};

	const scroll = (event: WheelEvent): void => {
		event.preventDefault();

		withScene((scene) => {
			const { deltaX, deltaY } = normalizeWheel(event);

			if (Math.abs(deltaX) > Math.abs(deltaY)) {
				layerScrollX += deltaX;
			} else {
				setScrollY(world, scene, getScrollY(world, scene) + deltaY);
			}

			applyScroll();
			updateTimelineTransform(world, scene);
			reportView(scene);
		});
	};

	const scrollBy = (deltaY: number): void => {
		withScene((scene) => {
			setScrollY(world, scene, getScrollY(world, scene) + deltaY);
			applyScroll();
			updateTimelineTransform(world, scene);
			reportView(scene);
		});
	};

	const clientToFrame = (clientX: number): number => {
		const scene = getTimelineScene(world);
		if (scene === null) return 0;

		const resolution = getResolution(world, scene);
		const rect = surface.canvas?.getBoundingClientRect();

		return pixelsToFrames(clientX - (rect?.left ?? 0) + getScrollX(world, scene) * resolution, resolution);
	};

	const clientToTime = (clientX: number): number => clientToFrame(clientX) / getFrameRate(world);

	const setMinimized = (minimized: boolean): void => {
		surface.minimized = minimized;
	};

	const attachCanvas = (): void => {
		const canvas = document.getElementById('timeline-canvas') as HTMLCanvasElement | null;
		assert(canvas, 'Timeline canvas must be defined');

		const parent = canvas.parentElement;
		assert(parent, 'Timeline canvas must have a parent element');

		surface.canvas = canvas;
		surface.ctx = canvas.getContext('2d');
		surface.layout = parent.getBoundingClientRect();

		observer.observe(parent);

		canvas.addEventListener('wheel', handleWheel);
		canvas.addEventListener('pointerdown', pointer.down, { passive: true });

		applyResize();
	};

	const detachCanvas = (): void => {
		observer.disconnect();

		surface.canvas?.removeEventListener('wheel', handleWheel);
		surface.canvas?.removeEventListener('pointerdown', pointer.down);

		// Dropped rather than kept stale: the draw pass no-ops until another
		// canvas is attached.
		surface.canvas = null;
		surface.ctx = null;
	};

	/** These outlive the canvas, so the timeline can be collapsed and reopened. */
	const mount = (): void => {
		const layers = document.querySelector<HTMLElement>('[data-timeline-layers]');
		assert(layers, 'Timeline layers element must be defined');

		const viewport = document.querySelector<HTMLElement>('[data-timeline-layers-viewport]');
		assert(viewport, 'Timeline layers viewport element must be defined');

		layersEl = layers;
		layersViewportEl = viewport;
		surface.pointer = pointer;

		layerObserver.observe(layers);

		// On the body, so a drag that leaves the canvas still finishes.
		document.body.addEventListener('pointermove', pointer.move, { passive: true });
		document.body.addEventListener('pointerup', pointer.up, { passive: true });
	};

	const unmount = (): void => {
		layerObserver.disconnect();
		surface.pointer = null;

		document.body.removeEventListener('pointermove', pointer.move);
		document.body.removeEventListener('pointerup', pointer.up);
	};

	return {
		mount,
		unmount,
		attachCanvas,
		detachCanvas,
		scroll,
		scrollBy,
		clientToFrame,
		clientToTime,
		setMinimized,
	};
}

/** A line or a page delta is whatever the platform decides; pixels are the only comparable unit. */
function normalizeWheel(event: WheelEvent): { deltaX: number; deltaY: number } {
	const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
		? WHEEL_LINE_HEIGHT
		: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
			? WHEEL_PAGE_HEIGHT
			: 1;

	return { deltaX: event.deltaX * scale, deltaY: event.deltaY * scale };
}
