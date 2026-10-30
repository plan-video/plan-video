/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A progress bar: a rect along the top or bottom edge whose `width` is
 * keyframed from nothing to the frame's width over the scene's length, so
 * viewers see how much is left. Adding again replaces the one already there.
 */

import { Keyframe, KeyframeTrack, Rect, authoredElement } from '@plan.video/reconciler';
import { Cache, Computed, FrameRate, getActiveEntity, isScene, store } from '@plan.video/runtime';

import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

export const PROGRESS_BAR_NAME = 'Progress bar';
export const PROGRESS_TRACK_NAME = 'Progress track';

export type ProgressPosition = 'top' | 'bottom';
export type ProgressThickness = 'thin' | 'medium' | 'thick';

export interface ProgressBarOptions {
	position: ProgressPosition;
	thickness: ProgressThickness;
	color: string;
	/** A faint full-width bar under the moving one. */
	track: boolean;
}

export const DEFAULT_PROGRESS_BAR: ProgressBarOptions = { position: 'bottom', thickness: 'medium', color: '#FFFFFF', track: false };

/** Height of the bar on a frame whose short side is 1080. */
const THICKNESS: Record<ProgressThickness, number> = { thin: 6, medium: 10, thick: 16 };
const TRACK_OPACITY = 0.3;

/** Puts the bar on the active scene, across its whole length, selected. Null without a scene. */
export function addProgressBar(world: World, options: ProgressBarOptions): Entity | null {
	const scene = getActiveEntity(world);
	if (!scene || !isScene(scene)) return null;

	const fps = world.get(FrameRate)?.value || 30;
	const computed = store(world, Computed);
	const id = scene.id();
	const width = Math.round(computed.width[id] || 1920);
	const height = Math.round(computed.height[id] || 1080);
	const origin = computed.origin[id] ?? 0;
	const start = round(((computed.start[id] ?? 0) - origin) / fps);
	const end = round(((computed.end[id] ?? 0) - origin) / fps);
	if (end <= start) return null;

	const thickness = Math.max(2, Math.round((THICKNESS[options.thickness] * Math.min(width, height)) / 1080));
	const y = options.position === 'top' ? 0 : height - thickness;

	const editor = getDocumentEditor(world);
	const previous = (scene.get(Cache)?.children ?? []).filter((child) => {
		const name = authoredElement(child)?.props.name;
		return name === PROGRESS_BAR_NAME || name === PROGRESS_TRACK_NAME;
	});
	if (previous.length > 0) editor.remove(previous);

	if (options.track) {
		editor.insertElement(scene, () => (
			<Rect name={PROGRESS_TRACK_NAME} x={0} y={y} width={width} height={thickness} start={start} end={end} fill={options.color} opacity={TRACK_OPACITY} />
		));
	}
	const [bar] = editor.insertElement(scene, () => (
		<Rect name={PROGRESS_BAR_NAME} x={0} y={y} width={0} height={thickness} start={start} end={end} fill={options.color}>
			<KeyframeTrack property="width">
				<Keyframe time={0} value={0} />
				<Keyframe time={round(end - start)} value={width} />
			</KeyframeTrack>
		</Rect>
	));

	if (bar) {
		// Open, so its two keyframes show on the timeline.
		editor.editProperty(bar, 'expanded', true);
		editor.select(bar);
	}
	return bar ?? null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
