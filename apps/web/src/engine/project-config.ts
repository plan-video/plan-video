/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Kept in the `planvideo` field of the project's package.json. Each setting is
// keyed by the scene's JSX `id` (ID_ATTR in @plan.video/jsx), stamped once by
// the compiler and never rewritten, so it is the one durable name an element has.

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

/** `template` is only a label; the export reads the fields. */
export type ExportConfig = {
	template?: string;
	format?: ContainerFormat;
	video?: ExportVideoSettings;
	audio?: ExportAudioSettings;
};

/** Undefined until the compiler has stamped the element. */
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

function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** Anything of the wrong type is left out rather than trusted. */
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

function parseExports(value: unknown): Record<string, ExportConfig> {
	if (!isRecord(value)) return {};
	const exports: Record<string, ExportConfig> = {};
	for (const [key, entry] of Object.entries(value)) {
		const parsed = parseExportConfig(entry);
		if (parsed) exports[key] = parsed;
	}
	return exports;
}

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
 * Setters update the signals first and write the file after, so a panel sees
 * its change at once. Fields the app does not know survive a write untouched.
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

	/** Reads the signal before the key, so a caller asking before the mount stamps the scene still hears when settings land. */
	public exportOf(scene: Entity): ExportConfig | null {
		const exports = this.exports[0]();
		const key = sceneConfigKey(scene);
		return (key && exports[key]) || null;
	}

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

	/** A saved workflow takes the layout from here: the scene only holds the clips it made. */
	public layoutOf(scene: Entity): WorkflowLayout | null {
		const layouts = this.layouts[0]();
		const key = sceneConfigKey(scene);
		return (key && layouts[key]) || null;
	}

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

	public post(): PostTemplate | null {
		return this.posts[0]();
	}

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

	public dispose(): void {
		this.disposed = true;
		if (this.world.get(ProjectConfigTrait) === this) {
			this.world.set(ProjectConfigTrait, null);
		}
	}
}

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

export function attachProjectConfig(world: World, dir: string): ProjectConfig {
	const config = new ProjectConfig(world, dir);
	world.set(ProjectConfigTrait, config);
	void config.load();
	return config;
}

export function isProjectConfigFile(path: string): boolean {
	return path === PROJECT_CONFIG_FILE;
}

export function useProjectConfig(): Accessor<ProjectConfig | undefined> {
	const world = useWorld();
	const attached = useTrait(world, ProjectConfigTrait);
	return () => attached() ?? undefined;
}
