/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Immediate-mode: a render function asks the pointer about the rectangle it draws and acts on it
 * (see `./pointer`). One mutable object rather than trait fields, since a render pass writes to it
 * as it goes and none of it is worth an event.
 */

import { trait } from 'koota';

import { COLORS, type TimelineColors } from './constants';

import type { CursorType } from '@/hooks/use-cursor';
import type { TimelinePointer } from './pointer';
import type { Entity } from 'koota';
import type { ClipEdge } from '../transitions';

/** In CSS pixels of the timeline canvas. */
export type Marquee = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type TimelineSurfaceState = {
	canvas: HTMLCanvasElement | null;
	ctx: CanvasRenderingContext2D | null;
	pointer: TimelinePointer | null;
	layout: DOMRect;
	/** Set by whichever render function claims the pointer, each frame. */
	cursor: CursorType;
	minimized: boolean;
	marquee: Marquee | null;
	/** The selection when a Shift/Cmd marquee opened, which it adds to; null otherwise. */
	marqueeBase: Set<Entity> | null;
	/** A press can't yet tell a click from a drag, and a drag of a selected clip must keep the rest. */
	press: ClipPress | null;
	/** In CSS pixels of the canvas, last on top. */
	clips: ClipMark[];
	replaceDrop: Entity[] | null;
	/** In timeline pixels. */
	snapX: number | null;
	colors: TimelineColors;
	/** In canvas pixels. */
	joins: JoinMark[];
	transitionDrop: TransitionDrop | null;
};

export type ClipPress = {
	clip: Entity;
	onClick: 'select' | 'deselect' | null;
};

export type ClipMark = {
	clip: Entity;
	left: number;
	right: number;
	top: number;
	bottom: number;
};

export type TransitionDrop = {
	clip: Entity;
	edge: ClipEdge;
};

export type JoinMark = TransitionDrop & {
	x: number;
	top: number;
	bottom: number;
};

export function createTimelineSurface(): TimelineSurfaceState {
	return {
		canvas: null,
		ctx: null,
		pointer: null,
		layout: new DOMRect(),
		cursor: 'default',
		minimized: false,
		marquee: null,
		marqueeBase: null,
		press: null,
		clips: [],
		replaceDrop: null,
		snapX: null,
		colors: COLORS,
		joins: [],
		transitionDrop: null,
	};
}

/** The trait's value is the live state object, written to directly. */
export const TimelineSurface = trait(() => createTimelineSurface());
