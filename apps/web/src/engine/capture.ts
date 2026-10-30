/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The project is rendered again rather than copied: a `<surface>`'s drawing, an `<html>` subtree and
 * `useTicker` values live only in the rendered nodes. The stage is cut down to the one node before
 * any system runs, so nothing outside it is drawn, decoded, mixed or resolved.
 */

import { mount } from '@plan.video/reconciler';
import {
	Ai, ChildOf, FramePromises, FrameRate, Fonts, Hidden, Library, Mode, Project,
	RenderSurface, Root, Source, TranscriptionRequest,
	createRuntimeWorld, disposeDecoders, getParentNode, removeChild, resetCamera,
} from '@plan.video/runtime';

import { loadProjectBundle } from '@/lib/db';
import { compileProject, isDesktop } from '@/projects';
import { liveCompositionBundle } from '@/projects/composition';

import type { RuntimeMode } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

export interface CaptureOptions {
	/** Defaults to the source world's frame rate. */
	frameRate?: number;
	mode?: RuntimeMode;
	/** Compile from this folder; otherwise use the remembered bundle. */
	dir?: string;
}

/**
 * Compile fresh when the folder is known: the editor's own writes skip the watcher, so the
 * remembered bundle may predate an inserted element and the encode would come up empty.
 */
async function bundleFor(source: World, dir?: string): Promise<string> {
	if (dir && isDesktop()) {
		const result = await compileProject(dir);
		if (!result.ok) throw new Error(result.error);
		return result.code;
	}

	if (!isDesktop()) {
		const live = liveCompositionBundle(source);
		if (live) return live;
	}

	const code = await loadProjectBundle(source.get(Project)?.id ?? '');
	if (!code) throw new Error('There is no project to render');
	return code;
}

export interface Capture {
	world: World;
	/** The stage's only child. */
	node: Entity;
	/** Drops the render, the canvas, the decoders it opened, and the world. */
	dispose(): void;
}

export async function createCapture(source: World, node: Entity, options: CaptureOptions = {}): Promise<Capture> {
	const code = await bundleFor(source, options.dir);

	// The stamp, not the entity: the two worlds hand out their own ids.
	const stamp = node.get(Source)?.value;
	if (!stamp) {
		throw new Error('This element is not in the project source yet — save the project and try again.');
	}

	const mode = options.mode ?? 'offline-video';
	const frameRate = options.frameRate ?? source.get(FrameRate)?.value ?? 30;

	// Must exist before the world fills (HTML paints attach to it) and sit inside the viewport:
	// drawElementImage reads the cached paint, which only exists near the viewport (off-screen it
	// throws "no cached paint record"). Only the origin must intersect. Blink skips painting under
	// opacity 0.0004, but will-change:opacity keeps it painted while staying invisible.
	const canvas = document.createElement('canvas');
	canvas.width = 2;
	canvas.height = 2;
	canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:-9999;opacity:0;will-change:opacity;pointer-events:none;';
	document.body.appendChild(canvas);

	// Fonts are already loaded into the document; copying the list only marks them loaded here.
	const world = createRuntimeWorld(source.get(Project)?.id ?? '');
	world.set(Mode, { value: mode });
	world.set(Library, source.get(Library) ?? null);
	world.set(Ai, source.get(Ai) ?? null);
	world.set(Fonts, { list: [...(source.get(Fonts)?.list ?? [])] });
	world.set(RenderSurface, { canvas, ctx: canvas.getContext('2d'), resolution: 1 });
	world.set(FrameRate, { value: frameRate });
	world.set(FramePromises, { list: [] });

	const dispose = (mounted?: { dispose(): void }) => () => {
		mounted?.dispose();
		canvas.remove();
		// koota caps live worlds at 16, so a throwaway one must be destroyed, not dropped.
		disposeDecoders(world, world.get(Root)!);
		world.destroy();
	};

	let mounted: { dispose(): void };
	try {
		mounted = mount(code, world);
	} catch (error) {
		dispose()();
		throw error;
	}

	const rendered = world.query(Source).find((entity) => entity.get(Source)?.value === stamp);

	if (!rendered) {
		dispose(mounted)();
		throw new Error(`The project rendered nothing for "${stamp}"`);
	}

	if (getParentNode(rendered) !== null) {
		removeChild(world, rendered, getParentNode(rendered)!);
		rendered.remove(Hidden);
	}

	// Destroying a root takes its subtree (ChildOf is autoDestroy 'orphan'); DOM they held goes with the canvas.
	for (const root of world.query(ChildOf(world.get(Root)!))) {
		if (root !== rendered) root.destroy();
	}

	// `<stage camera>` is where the editor was last looking, not part of the composition.
	resetCamera(world);

	// A source-less `<captions>` would transcribe this scene through another capture world, recursively.
	if (mode === 'offline-audio') {
		for (const entity of world.query(TranscriptionRequest)) {
			entity.remove(TranscriptionRequest);
		}
	}

	return { world, node: rendered, dispose: dispose(mounted) };
}
