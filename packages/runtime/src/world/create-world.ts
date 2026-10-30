/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createWorld } from 'koota';

import { observeWorld } from './observers';
import {
	Stage,
	Root,
	Project,
	Mode,
	Camera,
	Background,
	Time,
	FrameRate,
	RenderSurface,
	AudioEngine,
	Fonts,
	Library,
	Ai,
	Tickers,
	FramePromises,
	HitRegions,
} from '../traits/world';
import { Tool } from '../traits/interaction';

/** The host injects its surfaces after creation (RenderSurface, AudioEngine); the app layers its own world traits on top. */
export function createRuntimeWorld(projectId: string) {
	const world = createWorld(
		Project({ id: projectId }),
		Mode,
		Time,
		FrameRate,
		RenderSurface,
		AudioEngine,
		Fonts,
		Library,
		Ai,
		Tickers,
		FramePromises,
		HitRegions,
		Tool,
		Root,
	);

	world.set(Root, world.spawn(Stage, Camera, Background));

	observeWorld(world);

	return world;
}

export type RuntimeWorld = ReturnType<typeof createRuntimeWorld>;
