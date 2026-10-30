/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Reading a project back as workflow steps: the settings its scene was given
 * (size, stream layout, grade, auto zoom, captions and what is on their
 * words, progress bar, the post it was set up for), each found the way the
 * editor's own panels find it. Nothing of the footage or the words is kept.
 */

import { authoredElement } from '@plan.video/reconciler';
import {
	AssetId,
	Cache,
	Caption,
	Computed,
	Grade,
	Library,
	Root,
	getActiveEntity,
	getEntityChildren,
	getEntityTree,
	getSceneAncestor,
	getViewport,
	isScene,
	resolveTranscript,
	store,
} from '@plan.video/runtime';

import { readCaptionLook } from '@/lib/caption-look';
import { hasEmoji } from '@/lib/caption-tools';
import { definedGrade } from '@/lib/grade-presets';
import { LAYOUT_HEIGHT, LAYOUT_WIDTH } from '@/lib/stream-layouts';

import { coverRect } from './camera';
import { effectOf } from './effects';
import { PROGRESS_BAR_NAME, PROGRESS_TRACK_NAME, type ProgressBarOptions, type ProgressThickness } from './progress-bar';
import { ProjectConfig } from './traits';
import { videoClips } from './workflow-run';

import type { GradeValues, Rect } from '@plan.video/runtime';
import type { WorkflowSteps } from '@/lib/workflows';
import type { Entity, World } from 'koota';

/** The scene a workflow is saved from or run on: the active one, else the first. */
export function workflowScene(world: World): Entity | null {
	const active = getActiveEntity(world);
	if (active) {
		const scene = isScene(active) ? active : getSceneAncestor(active);
		if (scene) return scene;
	}
	const root = world.get(Root);
	return root ? (getEntityChildren(world, root).find(isScene) ?? null) : null;
}

/** What `scene` was set up with, as workflow steps. */
export async function readSceneSteps(world: World, scene: Entity): Promise<WorkflowSteps> {
	const steps: WorkflowSteps = {};
	const computed = store(world, Computed);
	const width = Math.round(computed.width[scene.id()] ?? 0);
	const height = Math.round(computed.height[scene.id()] ?? 0);
	if (width > 0 && height > 0) steps.size = { width, height };

	// A layout counts while the scene still has the layout's size.
	const layout = world.get(ProjectConfig)?.layoutOf(scene);
	if (layout && width === LAYOUT_WIDTH && height === LAYOUT_HEIGHT) steps.layout = layout;

	const clips = videoClips(world, scene);
	const graded = [...clips, scene].map((node) => node.get(Cache)?.grades?.at(-1)).find((grade) => grade?.has(Grade));
	if (graded) {
		const grade = definedGrade(graded.get(Grade) as GradeValues);
		if (Object.keys(grade).length) steps.grade = grade;
	}

	const tree = getEntityTree(world, scene);
	for (const entity of tree) {
		const effect = effectOf(world, entity);
		if (effect?.kind === 'autoZoom') {
			steps.autoZoom = { ...effect.options };
			break;
		}
	}

	const caption = tree.find((entity) => entity !== scene && entity.has(Caption));
	const look = caption ? readCaptionLook(world, caption) : null;
	if (caption && look) {
		steps.captions = { look };
		const words = await captionWords(world, caption);
		const color = commonColor(words);
		if (color !== undefined) steps.keywords = { color };
		if (words && hasEmoji(words)) steps.emoji = { on: true };
	}

	const bar = progressBarOf(world, scene, width, height);
	if (bar) steps.progressBar = bar;

	const post = world.get(ProjectConfig)?.post();
	if (post) steps.post = post;
	return steps;
}

async function captionWords(world: World, caption: Entity) {
	const id = caption.get(AssetId)?.value;
	const asset = id ? world.get(Library)?.get(id) : undefined;
	if (!asset || asset.type !== 'TRANSCRIPT') return undefined;
	try {
		return await resolveTranscript(asset);
	} catch {
		return undefined;
	}
}

/** The colour most of the coloured words wear: the keyword highlight, when there is one. */
function commonColor(words: Awaited<ReturnType<typeof captionWords>>): number | undefined {
	const counts = new Map<number, number>();
	for (const segment of words ?? []) {
		for (const word of segment.words) {
			const color = word.style?.color;
			if (typeof color === 'number') counts.set(color, (counts.get(color) ?? 0) + 1);
		}
	}
	let best: number | undefined;
	let most = 0;
	for (const [color, count] of counts) {
		if (count > most) {
			best = color;
			most = count;
		}
	}
	return best;
}

const THICKNESS: Record<ProgressThickness, number> = { thin: 6, medium: 10, thick: 16 };

function progressBarOf(world: World, scene: Entity, width: number, height: number): ProgressBarOptions | null {
	const children = scene.get(Cache)?.children ?? getEntityChildren(world, scene);
	const named = (name: string) => children.find((child) => authoredElement(child)?.props.name === name);
	const bar = named(PROGRESS_BAR_NAME);
	if (!bar) return null;
	const props = authoredElement(bar)!.props;
	const fill = typeof props.fill === 'string' && /^#[0-9a-f]{6}$/i.test(props.fill) ? props.fill.toUpperCase() : '#FFFFFF';
	const barHeight = Number(props.height) || 10;
	const scaled = (barHeight * 1080) / Math.max(1, Math.min(width, height));
	const thickness = (Object.keys(THICKNESS) as ProgressThickness[]).reduce((best, key) =>
		Math.abs(THICKNESS[key] - scaled) < Math.abs(THICKNESS[best] - scaled) ? key : best,
	);
	return { position: Number(props.y) <= 0 ? 'top' : 'bottom', thickness, color: fill, track: !!named(PROGRESS_TRACK_NAME) };
}

/**
 * A small still of `scene` at the playhead for the workflow's card, as a
 * WebP data URL, or undefined when the canvas can't give one.
 */
export async function sceneStill(world: World, snapshot: (rect?: Rect) => Promise<Blob | null>): Promise<string | undefined> {
	const rect = coverRect(world) ?? undefined;
	const viewport = getViewport(world);
	const blob = await snapshot(rect).catch(() => null);
	if (!blob) return undefined;
	try {
		const bitmap = await createImageBitmap(blob);
		// The shot is the whole canvas with the scene fitted in its middle, as `focusRect` frames it.
		let crop = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
		if (rect && viewport?.width && viewport.height) {
			const ratio = bitmap.width / viewport.width;
			const fit = Math.min(1, viewport.width / rect.width, viewport.height / rect.height) * ratio;
			const width = Math.min(bitmap.width, rect.width * fit);
			const height = Math.min(bitmap.height, rect.height * fit);
			crop = { x: (bitmap.width - width) / 2, y: (bitmap.height - height) / 2, width, height };
		}
		const scale = Math.min(1, 144 / crop.width, 256 / crop.height);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(crop.width * scale));
		canvas.height = Math.max(1, Math.round(crop.height * scale));
		const context = canvas.getContext('2d');
		if (!context) return undefined;
		context.imageSmoothingQuality = 'high';
		context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
		bitmap.close();
		for (const quality of [0.72, 0.5, 0.3]) {
			const url = canvas.toDataURL('image/webp', quality);
			if (url.length <= 24_000) return url;
		}
	} catch {
		// No still: the card shows the steps' icon instead.
	}
	return undefined;
}
