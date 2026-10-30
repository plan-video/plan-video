/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The project's config in the app: what is about the project rather than the
// composition (how its scenes are exported, for a start), kept in the
// `planvideo` field of its package.json — the project record — rather than
// in the JSX, which says what the composition is. Attached to the world for
// the project on disk, like the library: the world holds the handle, the
// handle holds the values as signals for the panels to read, and writes go
// to the file. Nothing here is the runtime's business (a headless world is
// not exported by its own settings; the encoder is handed its config), so no
// trait.
//
// Each setting is a map keyed by the scene's `id` in the JSX (see ID_ATTR in
// @plan.video/jsx): stamped once by the compiler where the author wrote
// none and never rewritten, so it is the one durable name every element has.
// A scene with no entry has nothing set up.
//
//   { "export": { "intro": { "format": "mp4", ... } } }

import { createSignal } from 'solid-js';
import { Source } from '@plan.video/runtime';
import { parseSource } from '@plan.video/jsx';
import { useTrait, useWorld } from '@plan.video/koota-solid';

import { readPostTemplate, type PostTemplate } from '@/lib/post-templates';
import { readLayout, type WorkflowLayout } from '@/lib/workflows';
import { readProjectConfig, writeProjectConfig } from '@/projects/host';
import { ProjectConfig as ProjectConfigTrait } from './traits';

import type { VideoCodec, AudioCodec } from 'mediabunny';
import type { Entity, World } from 'koota';
import type { Accessor } from 'solid-js';

/** The file the config lives in, relative to the project. */
export const PROJECT_CONFIG_FILE = 'package.json';

export type ContainerFormat = 'mp4' | 'webm' | 'ogg' | 'mov';

export type ExportVideoSettings = {
	enabled?: boolean;
	codec?: VideoCodec;
	bitrate?: number;
	fps?: number;
	resolution?: number;
};

export type ExportAudioSettings = {
	enabled?: boolean;
	codec?: AudioCodec;
	sampleRate?: number;
	bitrate?: number;
};

/**
 * How a scene is exported, in the shape the encoder takes its config
 * (format + video + audio), so the value goes to it as it is. `template`
 * names the editor preset the values came from — only a label, the fields
 * are what the export reads.
 */
export type ExportConfig = {
	template?: string;
	format?: ContainerFormat;
	video?: ExportVideoSettings;
	audio?: ExportAudioSettings;
};

/**
 * The key a scene's config sits under: its `id` in the JSX, read off the
 * source stamp (`<file>:<id>`). Undefined before it has one (nothing
 * mounted, or an element the compiler has yet to stamp).
 */
export function sceneConfigKey(scene: Entity): string | undefined {
	const source = scene.get(Source)?.value;
	const locator = source ? parseSource(source)?.locator : undefined;
	return typeof locator === 'string' ? locator : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const string = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const boolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/** An object without its `undefined` entries, so the file does not spell them. */
function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The export field as read from the file: the same shape, with anything of
 * the wrong type left out rather than trusted. Undefined when it is not an
 * object, i.e. no export is set up.
 */
export function parseExportConfig(value: unknown): ExportConfig | undefined {
	if (!isRecord(value)) return undefined;

	let video: ExportVideoSettings | undefined;
	if (isRecord(value.video)) {
		video = compact({
			enabled: boolean(value.video.enabled),
			codec: string(value.video.codec) as ExportVideoSettings['codec'],
			bitrate: number(value.video.bitrate),
			fps: number(value.video.fps),
			resolution: number(value.video.resolution),
		});
	}

	let audio: ExportAudioSettings | undefined;
	if (isRecord(value.audio)) {
		audio = compact({
			enabled: boolean(value.audio.enabled),
			codec: string(value.audio.codec) as ExportAudioSettings['codec'],
			sampleRate: number(value.audio.sampleRate),
			bitrate: number(value.audio.bitrate),
		});
	}

	return compact({
		template: string(value.template),
		format: string(value.format) as ContainerFormat | undefined,
		video,
		audio,
	});
}

/** The `export` field as read from the file: one entry per scene id, anything malformed left out. */
function parseExports(value: unknown): Record<string, ExportConfig> {
	if (!isRecord(value)) return {};
	const exports: Record<string, ExportConfig> = {};
	for (const [key, entry] of Object.entries(value)) {
		const parsed = parseExportConfig(entry);
		if (parsed) exports[key] = parsed;
	}
	return exports;
}

/** The `streamLayouts` field as read from the file: the layout each scene was last given. */
function parseLayouts(value: unknown): Record<string, WorkflowLayout> {
	if (!isRecord(value)) return {};
	const layouts: Record<string, WorkflowLayout> = {};
	for (const [key, entry] of Object.entries(value)) {
		const parsed = readLayout(entry);
		if (parsed) layouts[key] = parsed;
	}
	return layouts;
}

/**
 * The config of the project at `dir`. `load` reads the file; the setters
 * update the signals first and write the file after, so a panel sees its
 * change at once. Fields the app does not know are carried through a write
 * untouched.
 */
export class ProjectConfig {
	private readonly world: World;
	private readonly dir: string;
	private raw: Record<string, unknown> = {};
	private disposed = false;
	private readonly exports = createSignal<Record<string, ExportConfig>>({});
	private readonly layouts = createSignal<Record<string, WorkflowLayout>>({});
	private readonly posts = createSignal<PostTemplate | null>(null);

	public constructor(world: World, dir: string) {
		this.world = world;
		this.dir = dir;
	}

	/** Reads the config from the project. */
	public async load(): Promise<void> {
		let value: unknown = null;
		try {
			value = await readProjectConfig(this.dir);
		} catch (error) {
			console.warn('Failed to read the project config', error);
		}
		if (this.disposed) return;

		this.raw = isRecord(value) ? value : {};
		this.exports[1](parseExports(this.raw.export));
		this.layouts[1](parseLayouts(this.raw.streamLayouts));
		this.posts[1](readPostTemplate(this.raw.post));
	}

	/**
	 * How `scene` is exported, or null until it is set up. Reactive: the
	 * signal is read before the key, so a caller reading this for a scene the
	 * mount has yet to stamp still hears about the settings when they land.
	 */
	public exportOf(scene: Entity): ExportConfig | null {
		const exports = this.exports[0]();
		const key = sceneConfigKey(scene);
		return (key && exports[key]) || null;
	}

	/**
	 * Sets how `scene` is exported (null for none): here now, in the file
	 * after. No-op for a scene without an id (nothing mounted).
	 */
	public async setExport(scene: Entity, settings: ExportConfig | null): Promise<void> {
		const key = sceneConfigKey(scene);
		if (!key) {
			console.warn('Cannot write export settings for a scene without an id');
			return;
		}

		const exports = isRecord(this.raw.export) ? { ...this.raw.export } : {};
		if (settings) exports[key] = exportToJson(settings);
		else delete exports[key];

		const next = { ...this.raw };
		if (Object.keys(exports).length) next.export = exports;
		else delete next.export;
		this.exports[1](parseExports(next.export));
		await this.write(next);
	}

	/**
	 * The stream layout `scene` was last given, with its crops, or null. A
	 * workflow saved from the project takes it from here: the scene itself
	 * only holds the clips it made.
	 */
	public layoutOf(scene: Entity): WorkflowLayout | null {
		const layouts = this.layouts[0]();
		const key = sceneConfigKey(scene);
		return (key && layouts[key]) || null;
	}

	/** Remembers the stream layout `scene` was given (null to forget it). */
	public async setLayout(scene: Entity, layout: WorkflowLayout | null): Promise<void> {
		const key = sceneConfigKey(scene);
		if (!key) return;
		const layouts = isRecord(this.raw.streamLayouts) ? { ...this.raw.streamLayouts } : {};
		if (layout) layouts[key] = layout;
		else delete layouts[key];

		const next = { ...this.raw };
		if (Object.keys(layouts).length) next.streamLayouts = layouts;
		else delete next.streamLayouts;
		this.layouts[1](parseLayouts(next.streamLayouts));
		await this.write(next);
	}

	/** The post a workflow set this project up to go out as, or null. Reactive. */
	public post(): PostTemplate | null {
		return this.posts[0]();
	}

	/** Sets the post the project goes out as (null for none). */
	public async setPost(post: PostTemplate | null): Promise<void> {
		const next = { ...this.raw };
		if (post) next.post = post;
		else delete next.post;
		this.posts[1](post ? readPostTemplate(post) : null);
		await this.write(next);
	}

	private async write(next: Record<string, unknown>): Promise<void> {
		this.raw = next;
		try {
			await writeProjectConfig(this.dir, Object.keys(next).length ? next : null);
		} catch (error) {
			console.warn('Failed to write the project config', error);
		}
	}

	/** Detaches the config from the world. */
	public dispose(): void {
		this.disposed = true;
		if (this.world.get(ProjectConfigTrait) === this) {
			this.world.set(ProjectConfigTrait, null);
		}
	}
}

/** The export settings as they are spelled in the file: no `undefined`s, no empty sections. */
function exportToJson(settings: ExportConfig): ExportConfig {
	const video = settings.video && compact({ ...settings.video });
	const audio = settings.audio && compact({ ...settings.audio });
	return compact({
		template: settings.template,
		format: settings.format,
		video: video && Object.keys(video).length ? video : undefined,
		audio: audio && Object.keys(audio).length ? audio : undefined,
	});
}

/**
 * Creates the config of the project at `dir`, attaches it to the world and
 * starts loading it. Returns it; `dispose` detaches it.
 */
export function attachProjectConfig(world: World, dir: string): ProjectConfig {
	const config = new ProjectConfig(world, dir);
	world.set(ProjectConfigTrait, config);
	void config.load();
	return config;
}

/** Whether a changed project file holds the config. */
export function isProjectConfigFile(path: string): boolean {
	return path === PROJECT_CONFIG_FILE;
}

/** The world's project config, or undefined until a project attaches one. */
export function useProjectConfig(): Accessor<ProjectConfig | undefined> {
	const world = useWorld();
	const attached = useTrait(world, ProjectConfigTrait);
	return () => attached() ?? undefined;
}
