/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The timeline's own canvas, on the world beside the stage's own
 * (`RenderSurface`). A second surface rather than a second world: the
 * timeline shows the same entities the canvas does, only against time
 * instead of space.
 *
 * Interaction here is immediate-mode — a render function asks the pointer
 * about the rectangle it is about to draw and acts on the answer in the same
 * breath (see `./pointer`). That is not how the stage works, where the render
 * pass leaves `HitRegions` behind for the input system to dispatch against;
 * the difference is that a clip's rectangle *is* the drawing, so naming it a
 * second time buys nothing.
 *
 * Held as one mutable object rather than a trait of fields, since a render
 * pass writes to it as it goes (which row it is in, what the cursor should
 * be) and none of it is worth an event.
 */

import { trait } from 'koota';

import { COLORS, type TimelineColors } from './constants';

import type { CursorType } from '@/hooks/use-cursor';
import type { TimelinePointer } from './pointer';
import type { Entity } from 'koota';
import type { ClipEdge } from '../transitions';

/** The drag rectangle, in CSS pixels of the timeline canvas. */
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
	/** The canvas parent's box, which is what everything is laid out in. */
	layout: DOMRect;
	/** Set by whichever render function claims the pointer, each frame. */
	cursor: CursorType;
	/** Collapsed to the ruler alone: the rows are not drawn. */
	minimized: boolean;
	marquee: Marquee | null;
	/**
	 * What was selected when a marquee opened with Shift or Cmd held: the
	 * marquee adds to it rather than starting from nothing. Null otherwise.
	 */
	marqueeBase: Set<Entity> | null;
	/**
	 * The clip a press landed on, and what letting go without moving will do
	 * to the selection: a press can't tell yet whether it is a click or the
	 * start of a drag, and a drag of a selected clip must keep the rest.
	 */
	press: ClipPress | null;
	/** Every clip drawn this frame, in CSS pixels of the canvas, last on top. */
	clips: ClipMark[];
	/** The clips a file dragged in with Option held would replace. */
	replaceDrop: Entity[] | null;
	/** Where the edge being dragged snapped this frame, in timeline pixels. */
	snapX: number | null;
	/** The palette for the editor's theme, swapped when it changes. */
	colors: TimelineColors;
	/** Every clip end drawn this frame, in canvas pixels: where a dragged transition can land. */
	joins: JoinMark[];
	/** The clip end a transition being dragged over the timeline would land on. */
	transitionDrop: TransitionDrop | null;
};

/** What a click on a pressed clip does once the pointer is let go. */
export type ClipPress = {
	clip: Entity;
	/** `select` makes it the only one selected; `deselect` takes it out. */
	onClick: 'select' | 'deselect' | null;
};

/** Where a clip was drawn, for finding the clip under a point. */
export type ClipMark = {
	clip: Entity;
	left: number;
	right: number;
	top: number;
	bottom: number;
};

/** One end of a clip, a cut naming the clip going out of it. */
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

/**
 * The surface itself, on the world: the state is the trait's value, so
 * `world.get(TimelineSurface)` hands back the live object to write to.
 */
export const TimelineSurface = trait(() => createTimelineSurface());
