/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A step that can't be done says why and the run goes on; only Stop ends it early.

import { createSignal } from 'solid-js';
import { Captions, Grade as GradeElement } from '@plan.video/reconciler';
import {
	AssetId,
	Cache,
	Caption,
	Computed,
	Generating,
	Library,
	Muted,
	PendingSource,
	SourceError,
	findGeometryAsset,
	getEntityChildren,
	getEntityTree,
	isGroup,
	isMask,
	isRect,
	isScene,
	isSequence,
	resolveTranscript,
	store,
} from '@plan.video/runtime';

import { applyCaptionLook } from '@/lib/caption-look';
import { addEmoji, hasEmoji, highlightWords, pickKeywords } from '@/lib/caption-tools';
import { saveCaptionTranscript } from '@/lib/caption-transcript';
import { t } from '@/lib/i18n';
import { activeSteps, type Workflow, type WorkflowStepId } from '@/lib/workflows';

import { addAutoZoom } from './auto-zoom';
import { zoomToFitWhenSettled } from './camera';
import { getDocumentEditor } from './editor';
import { getEditHistory } from './history';
import { insertAssetsInNewScene, type NewSceneOptions } from './new-scene';
import { addProgressBar } from './progress-bar';
import { resizeScene } from './scene-size';
import {
	applyStreamLayout,
	activeLayout,
	closeStreamLayout,
	lastAppliedLayout,
	layoutTarget,
	openStreamLayout,
	setLayoutSetup,
} from './stream-layout';
import { ProjectConfig } from './traits';

import type { Asset, Transcript } from '@plan.video/assets';
import type { GradeProps } from '@plan.video/jsx';
import type { PostTemplate } from '@/lib/post-templates';
import type { Entity, World } from 'koota';

export type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'skipped' | 'failed';

export type RunStep = { id: WorkflowStepId; status: StepStatus; note?: string };

export type WorkflowRun = {
	workflowId: string;
	name: string;
	steps: RunStep[];
	state: 'running' | 'done' | 'stopped';
	post?: PostTemplate;
};

export type RunOptions = {
	// Captions and the tools on their words need an account.
	signedIn: boolean;
};

const [run, setRun] = createSignal<WorkflowRun | null>(null);
export { run as workflowRun };

// Bumped by every start and stop: a run that sees another number has been stopped.
let current = 0;

const CLIP_TIMEOUT_MS = 30_000;
// Transcribing a long clip on a busy server can take minutes.
const CAPTION_TIMEOUT_MS = 15 * 60_000;

class Stopped extends Error {}
class Skip extends Error {}

export function stopWorkflow(): void {
	if (run()?.state !== 'running') return;
	current++;
	if (layoutTarget()) closeStreamLayout();
	markStopped();
}

function markStopped(): void {
	setRun((value) =>
		value && {
			...value,
			state: 'stopped',
			steps: value.steps.map((step) => (step.status === 'done' || step.status === 'failed' || step.status === 'skipped' ? step : { ...step, status: 'skipped' as const, note: undefined })),
		},
	);
}

export function clearWorkflowRun(): void {
	if (run()?.state === 'running') return;
	setRun(null);
}

export function runWorkflowOnAssets(
	world: World,
	workflow: Workflow,
	assets: ReadonlyArray<Asset>,
	options: RunOptions,
	sceneOptions: NewSceneOptions = {},
): boolean {
	const scene = insertAssetsInNewScene(world, assets, sceneOptions);
	if (!scene) return false;
	void runWorkflow(world, workflow, scene, options);
	return true;
}

export async function runWorkflow(world: World, workflow: Workflow, scene: Entity, options: RunOptions): Promise<void> {
	stopWorkflow();
	const token = ++current;
	const ids = activeSteps(workflow);
	setRun({ workflowId: workflow.id, name: workflow.name, steps: ids.map((id) => ({ id, status: 'pending' })), state: 'running' });

	const alive = () => {
		if (token !== current || !scene.isAlive()) throw new Stopped();
	};
	const mark = (id: WorkflowStepId, status: StepStatus, note?: string) => {
		if (token !== current) return;
		setRun((value) => value && { ...value, steps: value.steps.map((step) => (step.id === id ? { id, status, note } : step)) });
	};

	const editor = getDocumentEditor(world);
	const failed = new Set<WorkflowStepId>();

	try {
		const clip = await readyClip(world, scene, alive);

		for (const id of ids) {
			alive();
			if ((id === 'keywords' || id === 'emoji') && failed.has('captions')) {
				mark(id, 'skipped', t('Left out: no captions to work on'));
				continue;
			}
			mark(id, 'running');
			try {
				const note = await doStep(world, workflow, id, { scene, clip, options, alive, mark });
				alive();
				mark(id, 'done', note);
			} catch (error) {
				if (error instanceof Stopped) throw error;
				if (error instanceof Skip) {
					failed.add(id);
					mark(id, 'skipped', error.message);
					continue;
				}
				failed.add(id);
				mark(id, 'failed', error instanceof Error ? error.message : undefined);
			}
		}

		alive();
		if (workflow.steps.post && ids.includes('post')) setRun((value) => value && { ...value, post: workflow.steps.post });
		setRun((value) => value && { ...value, state: 'done' });
		editor.activate(scene);
		editor.select(scene);
		// The scene's new size reaches its bounds a frame or two later.
		await frames(3);
		zoomToFitWhenSettled(world);
	} catch (error) {
		if (error instanceof Stopped) {
			// Its scene went (deleted, or the project closed) rather than Stop being pressed.
			if (token === current) {
				current++;
				if (layoutTarget()) closeStreamLayout();
				markStopped();
			}
			return;
		}
		setRun((value) =>
			value && {
				...value,
				state: 'done',
				steps: value.steps.map((step) => (step.status === 'pending' || step.status === 'running' ? { ...step, status: 'failed' as const, note: (error as Error).message } : step)),
			},
		);
	}
}

type StepContext = {
	scene: Entity;
	clip: Entity;
	options: RunOptions;
	alive: () => void;
	mark: (id: WorkflowStepId, status: StepStatus, note?: string) => void;
};

async function doStep(world: World, workflow: Workflow, id: WorkflowStepId, context: StepContext): Promise<string | undefined> {
	const { scene, clip, options, alive, mark } = context;
	const steps = workflow.steps;
	const editor = getDocumentEditor(world);

	switch (id) {
		case 'size': {
			const size = steps.size!;
			const computed = store(world, Computed);
			const width = Math.round(computed.width[scene.id()] ?? 0);
			const height = Math.round(computed.height[scene.id()] ?? 0);
			if (width !== size.width || height !== size.height) {
				resizeScene(world, scene, size.width, size.height);
				zoomToFitWhenSettled(world);
			}
			return;
		}

		case 'layout': {
			const layout = steps.layout!;
			editor.activate(scene);
			editor.select(clip);
			openStreamLayout(world, layout.id);
			if (!layoutTarget()) throw new Error(t('No video to lay out'));
			const before = lastAppliedLayout();
			const needed = activeLayout().crops.map((spec) => spec.id);
			if (layout.crops && needed.every((crop) => layout.crops?.[crop])) {
				setLayoutSetup(layout);
				applyStreamLayout(world);
			} else {
				mark(id, 'waiting', t('Place the crops on the canvas, then Apply layout'));
				await until(() => !layoutTarget(), alive);
			}
			if (lastAppliedLayout() === before) throw new Skip(t('Left out: the layout was cancelled'));
			return;
		}

		case 'grade': {
			const props = steps.grade! as GradeProps;
			for (const target of videoClips(world, scene)) {
				const old = target.get(Cache)?.grades ?? [];
				if (old.length) editor.remove([...old]);
				editor.insertElement(target, () => <GradeElement {...props} />);
			}
			return;
		}

		case 'autoZoom': {
			const result = await addAutoZoom(world, clip, { ...steps.autoZoom! });
			if (!result.ok) {
				if (result.reason === 'nothing-found') throw new Skip(t('Nothing to zoom on in this clip'));
				throw new Error(t('No clip to zoom on'));
			}
			return result.followedVoice ? undefined : t('No voice heard, so it keeps a steady beat');
		}

		case 'captions': {
			if (!options.signedIn) throw new Error(t('Sign in to add captions'));
			const existing = getEntityTree(world, scene).find((entity) => entity !== scene && entity.has(Caption));
			// Captions that already have words only take the look: no second transcription.
			if (existing && existing.get(AssetId)?.value) {
				applyCaptionLook(world, editor, existing, steps.captions!.look);
				return;
			}
			const [caption] = editor.insertElement(scene, () => <Captions seed={Date.now()} />);
			if (!caption) throw new Error(t('Could not add captions'));
			applyCaptionLook(world, editor, caption, steps.captions!.look);
			mark(id, 'running', t('Listening to the clip'));
			await until(() => captionDone(caption), alive, CAPTION_TIMEOUT_MS);
			const error = caption.get(SourceError)?.value;
			if (error) throw new Error(error);
			return;
		}

		case 'keywords': {
			const color = steps.keywords!.color;
			await rewriteWords(world, scene, async (words) => highlightWords(words, await pickKeywords(words), color, color));
			return;
		}

		case 'emoji': {
			await rewriteWords(world, scene, async (words) => (hasEmoji(words) ? words : addEmoji(words)));
			return;
		}

		case 'progressBar': {
			editor.activate(scene);
			if (!addProgressBar(world, { ...steps.progressBar! })) throw new Error(t('The scene has no length yet'));
			return;
		}

		case 'post': {
			const post = steps.post!;
			await world.get(ProjectConfig)?.setPost(post);
			return post.name;
		}
	}
}

async function readyClip(world: World, scene: Entity, alive: () => void): Promise<Entity> {
	let clip: Entity | null = null;
	await until(() => {
		clip = mainClip(world, scene);
		if (!clip) return false;
		const asset = findGeometryAsset(world, clip);
		const computed = store(world, Computed);
		return !!asset && 'width' in asset && asset.width > 0 && (computed.end[clip.id()] ?? 0) > (computed.start[clip.id()] ?? 0);
	}, alive, CLIP_TIMEOUT_MS, t('The clip did not load'));
	return clip!;
}

const captionDone = (caption: Entity) =>
	!caption.isAlive() || caption.has(SourceError) || (!!caption.get(AssetId)?.value && !caption.has(PendingSource) && !caption.has(Generating));

async function rewriteWords(world: World, scene: Entity, work: (words: Transcript) => Promise<Transcript>): Promise<void> {
	const caption = getEntityTree(world, scene).find((entity) => entity !== scene && entity.has(Caption));
	const library = world.get(Library);
	const assetId = caption?.get(AssetId)?.value;
	const asset = assetId ? library?.get(assetId) : undefined;
	if (!library || !asset || asset.type !== 'TRANSCRIPT') throw new Error(t('No captions to work on'));
	const words = await resolveTranscript(asset);
	if (!words.some((segment) => segment.words.length > 0)) throw new Error(t('No words were heard'));
	const next = await work(words);
	if (next === words) return;
	getEditHistory(world).recordTranscript(asset.id, words, next);
	await saveCaptionTranscript(world, library, asset, next);
}

const frames = async (count: number) => {
	for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

async function until(done: () => boolean, alive: () => void, timeout = Infinity, message = t('This took too long')): Promise<void> {
	const started = performance.now();
	for (;;) {
		alive();
		if (done()) return;
		if (performance.now() - started > timeout) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

export function videoClips(world: World, scene: Entity): Entity[] {
	const found: Entity[] = [];
	const visit = (parent: Entity) => {
		for (const child of getEntityChildren(world, parent)) {
			if (isMask(child) || isScene(child)) continue;
			if (isSequence(child)) {
				visit(child);
				continue;
			}
			if (isRect(child)) {
				const asset = findGeometryAsset(world, child);
				if (asset?.type === 'VIDEO' || asset?.type === 'SEQUENCE') found.push(child);
			}
			if (isGroup(child)) visit(child);
		}
	};
	visit(scene);
	return found;
}

export function mainClip(world: World, scene: Entity): Entity | null {
	const clips = videoClips(world, scene);
	const pool = clips.filter((clip) => !clip.has(Muted));
	const computed = store(world, Computed);
	let best: Entity | null = null;
	let bestArea = -1;
	for (const clip of pool.length ? pool : clips) {
		const area = (computed.width[clip.id()] ?? 0) * (computed.height[clip.id()] ?? 0);
		if (area > bestArea) {
			best = clip;
			bestArea = area;
		}
	}
	return best;
}
