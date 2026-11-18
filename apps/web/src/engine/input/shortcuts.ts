/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import {
	AdjustmentLayer,
	ChildOf,
	Computed,
	Culled,
	FrameRate,
	Geometry,
	Group,
	Hidden,
	Playback,
	Position,
	Root,
	Selected,
	Time,
	Tool,
	ToolType,
	Workarea,
	getActiveEntity,
	getCameraMatrix,
	getEntityChildren,
	getParentEntity,
	getParentNode,
	getSelection,
	isGroupLike,
	isScene,
	isSequence,
	setPlayhead,
	shuttlePlayback,
	stopPlayback,
	store,
	togglePlayback,
} from '@plan.video/runtime';
import { Not, Or } from 'koota';

import { setSidebarTab } from '@/agent-chat/store';
import { clearCaptionWordClipboard, copyPickedCaptionWords, cutPickedCaptionWords, pasteCaptionWords, removePickedCaptionWords } from '@/lib/caption-transcript';
import { activeBindings, matchesKeys, type KeyCommand } from '@/lib/keymap';
import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from '../camera';
import { getDocumentEditor } from '../editor';
import { groupSelection, ungroupSelection, unwrapSequenceSelection, wrapSelectionInScene, wrapSelectionInSequence } from '../group';
import { getEditHistory } from '../history';
import { setPreviewQuality } from '../preview-quality';
import { splitAtPlayhead } from '../split';
import { Keys, Pointer } from '../traits';
import { nudgeCaptionWords } from '@/lib/caption-word-move';
import { editTransform } from './interactions';

import type { TransformWrite } from './interactions';
import type { CameraMatrix } from '@plan.video/runtime';
import type { Entity, World } from 'koota';

const NODES = Or(Geometry, Group, AdjustmentLayer);

export function undoEdit(world: World): void {
	getEditHistory(world).undo();
}

export function redoEdit(world: World): void {
	getEditHistory(world).redo();
}

export function deleteSelection(world: World): void {
	if (removePickedCaptionWords(world)) return;
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).remove(selected);
	}
};

export function duplicateSelection(world: World): void {
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).duplicate(selected);
	}
}

export function copySelection(world: World): void {
	if (copyPickedCaptionWords(world)) return;
	clearCaptionWordClipboard();
	const selected = [...world.query(Selected)];

	if (selected.length) {
		getDocumentEditor(world).copy(selected);
	}
}

export function cutSelection(world: World): void {
	if (cutPickedCaptionWords(world)) return;
	copySelection(world);
	deleteSelection(world);
}

export function pasteSelection(world: World): void {
	if (pasteCaptionWords(world)) return;
	const editor = getDocumentEditor(world);
	const [selected] = world.query(Selected);

	if (selected === undefined) {
		editor.paste(getActiveEntity(world) ?? world.get(Root)!);
		return;
	}

	if (isGroupLike(selected)) {
		editor.paste(selected);
		return;
	}

	const parent = getParentEntity(selected);
	if (parent === null) return;
	const siblings = getEntityChildren(world, parent);
	editor.paste(parent, siblings[siblings.indexOf(selected) + 1]);
}

const NUDGE = 1;
const NUDGE_FAST = 10;

// Reads the drawn position and writes the position track too, so an
// animated node moves from where its keyframes put it (as `editTransform` does).
export function nudgeSelection(world: World, dx: number, dy: number): void {
	if (nudgeCaptionWords(world, dx, dy)) return;

	const editor = getDocumentEditor(world);
	const computed = store(world, Computed);

	for (const entity of getSelection(world)) {
		if (!entity.has(Position)) continue;
		const eid = entity.id();

		const writes: TransformWrite[] = [];
		if (dx) writes.push(['x', Math.round((computed.positionX[eid] ?? 0) + dx)]);
		if (dy) writes.push(['y', Math.round((computed.positionY[eid] ?? 0) + dy)]);
		editTransform(world, editor, entity, writes);
	}
}

const nudge = (dx: number, dy: number) => (world: World): void => nudgeSelection(world, dx, dy);

const SPACE_HAND_DELAY = 200;

// Null when space is up, or when the press cannot turn into a pan.
let spaceCamera: CameraMatrix | null = null;

let spaceTool: ToolType | null = null;

// Null once the hand has taken over, or once space is up.
let spacePressedAt: number | null = null;

function takeHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool !== null) return;
	spaceTool = world.get(Tool)?.value ?? ToolType.MOVE;
	world.set(Tool, { value: ToolType.HAND });
}

function releaseHandTool(world: World): void {
	spacePressedAt = null;
	if (spaceTool === null) return;
	world.set(Tool, { value: spaceTool });
	spaceTool = null;
}

// Any selected scene playing pauses them all, so the next press starts them in step.
function toggleActivePlayback(world: World): void {
	const scenes = getSelection(world).filter((entity) => isScene(entity) && getParentNode(entity) === null && entity.has(Playback));

	if (scenes.length > 1) {
		const playing = scenes.some((scene) => scene.get(Playback)!.playing);
		for (const scene of scenes) {
			if (scene.get(Playback)!.playing === playing) togglePlayback(world, scene);
		}
		return;
	}

	const scene = getActiveEntity(world);
	if (scene) togglePlayback(world, scene);
}

const shuttle = (direction: 1 | -1) => (world: World): void => {
	const scene = getActiveEntity(world);
	if (scene) shuttlePlayback(world, scene, direction);
};

function stopActivePlayback(world: World): void {
	const scene = getActiveEntity(world);
	if (scene) stopPlayback(world, scene);
}

function onSpacePressed(world: World): void {
	// Over the stage the press could still become a pan, so playback waits for a
	// release that left the camera where it was.
	spacePressedAt = world.get(Time)?.now ?? 0;

	if (world.get(Pointer)?.over) {
		spaceCamera = getCameraMatrix(world);
	} else {
		spaceCamera = null;
		toggleActivePlayback(world);
	}
}

function onSpaceLifted(world: World): void {
	const camera = getCameraMatrix(world);
	if (spaceCamera?.every((value, index) => value === camera[index])) {
		toggleActivePlayback(world);
	}
	spaceCamera = null;
	releaseHandTool(world);
}

// A hold the window loses focus during never sees a release (`held` is
// cleared without a lift), so the borrowed tool goes back on the first frame
// the key is no longer down.
function updateSpaceHold(world: World, held: Set<string>): void {
	if (!held.has(' ')) {
		spaceCamera = null;
		releaseHandTool(world);
		return;
	}

	if (spacePressedAt === null) return;
	if ((world.get(Time)?.now ?? 0) - spacePressedAt >= SPACE_HAND_DELAY) {
		takeHandTool(world);
	}
}

// While space holds the hand, the pick is what the release goes back to.
const selectTool = (value: ToolType) => (world: World): void => {
	if (value === ToolType.SCENE) setSidebarTab("templates");
	if (spaceTool !== null) {
		spaceTool = value;
		return;
	}
	world.set(Tool, { value });
};

export function seekBy(world: World, frames: number): void {
	const scene = getActiveEntity(world);
	if (!scene) return;

	setPlayhead(world, scene, (store(world, Computed).localTime[scene.id()] ?? 0) + frames);
}

const seekFrames = (frames: number) => (world: World): void => seekBy(world, frames);

const seekSeconds = (seconds: number) => (world: World): void =>
	seekBy(world, Math.round(seconds * (world.get(FrameRate)?.value ?? 30)));

// `end` is exclusive, as everywhere else. A selected scene is the editing
// context, not an edge to jump to.
export function seekToSelectionEdge(world: World, edge: 'start' | 'end'): void {
	const scene = getActiveEntity(world);
	if (!scene) return;

	const computed = store(world, Computed);
	const clips = [...world.query(Selected, NODES)].filter(entity => entity !== scene);
	if (!clips.length) return;

	const frames = clips.map(entity => computed[edge][entity.id()] ?? 0);
	setPlayhead(world, scene, edge === 'start' ? Math.min(...frames) : Math.max(...frames));
}

const seekSelectionEdge = (edge: 'start' | 'end') => (world: World): void =>
	seekToSelectionEdge(world, edge);

// While there is a work area its edges are the ends: past them playback
// cannot pick up and the next play would snap back in.
export function seekToTimelineEdge(world: World, edge: 'start' | 'end'): void {
	const scene = getActiveEntity(world);
	if (!scene) return;

	const workarea = scene.has(Workarea) ? scene.get(Workarea) : undefined;

	setPlayhead(world, scene, edge === 'start'
		? workarea?.start ?? 0
		: workarea?.end ?? store(world, Computed).duration[scene.id()] ?? 0);
}

const seekTimelineEdge = (edge: 'start' | 'end') => (world: World): void =>
	seekToTimelineEdge(world, edge);

// Clips inside a sequence are the timeline's real cuts, so the walk opens sequences up.
export function seekToAdjacentCut(world: World, direction: 1 | -1): void {
	const scene = getActiveEntity(world);
	if (scene === null) return;

	const computed = store(world, Computed);
	const here = computed.localTime[scene.id()] ?? 0;
	const cuts: number[] = [];

	const collect = (parent: Entity): void => {
		for (const node of world.query(NODES, ChildOf(parent))) {
			if (isSequence(node)) collect(node);
			else cuts.push(computed.start[node.id()] ?? 0, computed.end[node.id()] ?? 0);
		}
	};
	collect(scene);

	const ahead = cuts.filter(frame => direction > 0 ? frame > here : frame < here);
	if (ahead.length) setPlayhead(world, scene, direction > 0 ? Math.min(...ahead) : Math.max(...ahead));
}

const seekCut = (direction: 1 | -1) => (world: World): void => seekToAdjacentCut(world, direction);

const ZOOM_STEP = 1.25;

const zoom = (factor: number) => (world: World): void => zoomBy(world, factor);

const zoomActualSize = (world: World): void => zoomTo(world, 1);

export function toggleSelectionHidden(world: World): void {
	const editor = getDocumentEditor(world);
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const hide = selected.some(entity => !entity.has(Hidden));
	for (const entity of selected) editor.editProperty(entity, 'hidden', hide);
}

// Whichever node the file lists last is drawn on top, so a restack is a move
// through the document. Moved nodes keep their order among themselves.
export function restackSelection(world: World, target: 'front' | 'back'): void {
	const editor = getDocumentEditor(world);
	const selected = new Set([...world.query(Selected, NODES)]);
	if (!selected.size) return;

	const parents = new Set<Entity>();
	for (const entity of selected) {
		const parent = getParentEntity(entity);
		if (parent !== null) parents.add(parent);
	}

	for (const parent of parents) {
		const siblings = getEntityChildren(world, parent);
		const moving = siblings.filter(entity => selected.has(entity));

		if (target === 'front') {
			for (const entity of moving) editor.reparent(entity, parent);
			continue;
		}

		const anchor = siblings.find(entity => !selected.has(entity));
		if (anchor === undefined) continue;
		for (const entity of moving) editor.reparent(entity, parent, anchor);
	}
}

const restack = (target: 'front' | 'back') => (world: World): void => restackSelection(world, target);

const previewAt = (quality: number) => (world: World): void => setPreviewQuality(world, quality);

export function selectAll(world: World): void {
	const root = world.get(Root);
	if (!root) return;

	const entities = [...world.query(NODES, ChildOf(root), Not(Hidden), Not(Culled))];
	if (entities.length) getDocumentEditor(world).select(entities);
}

// A sequence is drawn by the timeline, not selected on the canvas, so the walk
// goes on through it.
export function selectParents(world: World): void {
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const parents = new Set<Entity>();

	for (const entity of selected) {
		let parent = getParentNode(entity);
		while (parent !== null && isSequence(parent)) {
			parent = getParentNode(parent);
		}
		if (parent !== null) parents.add(parent);
	}

	if (parents.size) getDocumentEditor(world).select([...parents]);
}

export function selectChildren(world: World): void {
	const selected = [...world.query(Selected, NODES)];
	if (!selected.length) return;

	const children = new Set<Entity>();

	const collect = (parent: Entity): void => {
		for (const child of world.query(NODES, ChildOf(parent), Not(Hidden), Not(Culled))) {
			if (isSequence(child)) collect(child);
			else children.add(child);
		}
	};

	for (const entity of selected) collect(entity);

	if (children.size) getDocumentEditor(world).select([...children]);
}

function deselect(world: World): void {
	getDocumentEditor(world).clearSelection();

	const tool = world.get(Tool)?.value ?? ToolType.MOVE;
	if (tool !== ToolType.MOVE && tool !== ToolType.HAND) selectTool(ToolType.MOVE)(world);
}

const ACTIONS: Record<KeyCommand, (world: World) => void> = {
	undo: undoEdit,
	redo: redoEdit,
	delete: deleteSelection,
	duplicate: duplicateSelection,
	group: groupSelection,
	ungroup: ungroupSelection,
	wrapInScene: wrapSelectionInScene,
	wrapInSequence: wrapSelectionInSequence,
	unwrapSequence: unwrapSequenceSelection,
	split: splitAtPlayhead,
	copy: copySelection,
	paste: pasteSelection,
	cut: cutSelection,
	hide: toggleSelectionHidden,
	selectAll,
	zoomIn: zoom(ZOOM_STEP),
	zoomOut: zoom(1 / ZOOM_STEP),
	zoomActual: zoomActualSize,
	zoomFit: zoomToFit,
	zoomSelection: zoomToSelection,
	previewFull: previewAt(1),
	previewHalf: previewAt(0.5),
	moveTool: selectTool(ToolType.MOVE),
	handTool: selectTool(ToolType.HAND),
	frameTool: selectTool(ToolType.SCENE),
	textTool: selectTool(ToolType.TEXT),
	rectTool: selectTool(ToolType.RECT),
	previousFrame: seekFrames(-1),
	nextFrame: seekFrames(1),
	forwardSecond: seekSeconds(1),
	backSecond: seekSeconds(-1),
	previousCut: seekCut(-1),
	nextCut: seekCut(1),
	selectionStart: seekSelectionEdge('start'),
	selectionEnd: seekSelectionEdge('end'),
	timelineStart: seekTimelineEdge('start'),
	timelineEnd: seekTimelineEdge('end'),
	shuttleBack: shuttle(-1),
	stop: stopActivePlayback,
	shuttleForward: shuttle(1),
	bringToFront: restack('front'),
	sendToBack: restack('back'),
	selectParent: selectParents,
	selectChildren,
	deselect,
	nudgeLeft: nudge(-NUDGE, 0),
	nudgeRight: nudge(NUDGE, 0),
	nudgeUp: nudge(0, -NUDGE),
	nudgeDown: nudge(0, NUDGE),
	nudgeFastLeft: nudge(-NUDGE_FAST, 0),
	nudgeFastRight: nudge(NUDGE_FAST, 0),
	nudgeFastUp: nudge(0, -NUDGE_FAST),
	nudgeFastDown: nudge(0, NUDGE_FAST),
	play: onSpacePressed,
};

export function shortcutSystem(world: World): void {
	const keys = world.get(Keys);
	if (!keys) return;

	if (keys.pressed.size) {
		const binding = activeBindings().find(({ keys: combo }) => matchesKeys(combo, keys.pressed, keys.held));
		if (binding) ACTIONS[binding.command](world);
	}

	if (matchesKeys([' '], keys.lifted, keys.held)) onSpaceLifted(world);

	updateSpaceHold(world, keys.held);
}
