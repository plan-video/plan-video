/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetId, Computed, Library, Selected, getSceneAncestor, resolveCaptionDecoder, secondsToFrames, setPlayhead, store } from '@plan.video/runtime';

import { getDocumentEditor } from '../../editor';
import { saveCaptionTranscript } from '@/lib/caption-transcript';
import { addCaptionWord, captionWordSelection, isSoleCaptionWord, setCaptionWordSelection, clearCaptionWordSelection } from '../caption-word-selection';
import { CLIP_CORNER_RADIUS, CLIP_FONT, CLIP_LABEL_X, TRIM_HANDLE_WIDTH } from '../config';
import { truncateText } from '../text';
import { framesToPixels, getFrameRate, pixelsToFrames } from '../view';

import type { TranscriptWord, WordGroup } from '@plan.video/assets';
import type { Entity, World } from 'koota';
import type { ClipStyle } from '../style';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

const MIN_LENGTH = 0.05;

type WordGesture = {
	entity: Entity;
	index: number;
	mode: 'move' | 'in' | 'out';
	originStart: number;
	originEnd: number;
	prevEnd: number;
	nextStart: number;
	dirty: boolean;
};

let gesture: WordGesture | null = null;

/**
 * The caption's words as their own clips on its one row. Returns false when
 * the transcript has no words yet, so the caller can still draw the pending
 * bar.
 */
export function renderCaptionWords(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
	style: ClipStyle,
	resolution: number,
): boolean {
	const ctx = surface.ctx;
	const pointer = surface.pointer;
	if (!ctx || !pointer) return false;

	const groups = resolveCaptionDecoder(world, entity)?.groups;
	const words = groups?.flat() ?? [];
	if (!groups || words.length === 0) return false;

	const computed = store(world, Computed);
	const fps = getFrameRate(world);
	const origin = computed.origin[entity.id()] ?? 0;
	const editor = getDocumentEditor(world);
	const hits: number[] = [];

	for (let index = 0; index < words.length; index++) {
		const word = words[index]!;
		const left = framesToPixels(origin + secondsToFrames(word.start, fps), resolution);
		const right = framesToPixels(origin + secondsToFrames(word.end, fps), resolution);
		const width = right - left - 1;
		if (width < 2) continue;

		const body = pointer.region(left, 0, width, row.height, `word-${index}`);
		if (body.intersectsMarquee) hits.push(index);

		const handle = Math.min(Math.max(width / 3, 3), width / 2, TRIM_HANDLE_WIDTH);
		const trimIn = width > handle * 2
			? pointer.region(left, 0, handle, row.height, `word-${index}-in`)
			: null;
		const trimOut = width > handle * 2
			? pointer.region(left + width - handle, 0, handle, row.height, `word-${index}-out`)
			: null;

		if (trimIn?.hovering || trimIn?.dragging) surface.cursor = 'trim-right';
		else if (trimOut?.hovering || trimOut?.dragging) surface.cursor = 'trim-left';

		if (!surface.marquee) {
			if (body.pressed || trimIn?.pressed || trimOut?.pressed) {
				if (pointer.shiftPressed) {
					addCaptionWord(entity, index);
					if (entity.has(Selected)) editor.deselect(entity);
				} else if (!isSoleCaptionWord(entity, index) || entity.has(Selected)) {
					editor.clearSelection();
					if (setCaptionWordSelection(entity, [index])) showWord(world, entity, origin, word.start, fps);
				}
			}

			const mode = trimIn?.dragging ? 'in' : trimOut?.dragging ? 'out' : body.dragging ? 'move' : null;
			if (mode) {
				beginGesture(entity, index, mode, words);
				applyGesture(surface, words, resolution, fps);
			}
		}

		ctx.save();
		ctx.beginPath();
		ctx.roundRect(left, 0, width, row.height, CLIP_CORNER_RADIUS);
		ctx.fillStyle = style.background;
		ctx.fill();
		ctx.clip();

		ctx.fontStretch = 'ultra-condensed';
		ctx.font = CLIP_FONT;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = style.foreground;
		const text = truncateText(ctx, word.text, width - CLIP_LABEL_X * 2, CLIP_FONT);
		if (text) ctx.fillText(text, left + CLIP_LABEL_X, Math.round(row.height / 2));

		const picked = captionWordSelection();
		const selected = picked?.entity === entity && picked.indices.has(index);
		ctx.strokeStyle = selected ? surface.colors.border.ring : style.border ?? surface.colors.border.darker;
		ctx.lineWidth = selected ? 3 : 2;
		ctx.stroke();
		ctx.restore();
	}

	if (surface.marquee) {
		if (hits.length > 0) {
			setCaptionWordSelection(entity, hits);
			if (entity.has(Selected)) editor.deselect(entity);
		} else if (captionWordSelection()?.entity === entity) {
			clearCaptionWordSelection();
		}
		if (hits.length === 0 && entity.has(Selected)) editor.deselect(entity);
	}

	return true;
}

/** Writes a word drag once the pointer is released. */
export function settleCaptionWordEdits(world: World): void {
	const pending = gesture;
	if (!pending) return;
	gesture = null;
	if (!pending.dirty || !pending.entity.isAlive()) return;

	const groups = resolveCaptionDecoder(world, pending.entity)?.groups;
	const assetId = pending.entity.get(AssetId)?.value;
	const library = world.get(Library);
	if (!groups || !assetId || !library) return;

	const asset = library.get(assetId);
	if (!asset) return;

	void saveCaptionTranscript(world, library, asset, transcriptFromGroups(groups), 'drag');
}

function showWord(world: World, entity: Entity, origin: number, start: number, fps: number): void {
	const scene = getSceneAncestor(entity);
	if (scene) setPlayhead(world, scene, origin + start * fps);
}

function beginGesture(entity: Entity, index: number, mode: WordGesture['mode'], words: TranscriptWord[]): void {
	if (gesture && gesture.entity === entity && gesture.index === index && gesture.mode === mode) return;

	const word = words[index];
	if (!word) return;

	const previous = words[index - 1];
	const next = words[index + 1];
	gesture = {
		entity,
		index,
		mode,
		originStart: word.start,
		originEnd: word.end,
		prevEnd: previous?.end ?? 0,
		nextStart: next?.start ?? Number.POSITIVE_INFINITY,
		dirty: false,
	};
}

function applyGesture(
	surface: TimelineSurfaceState,
	words: TranscriptWord[],
	resolution: number,
	fps: number,
): void {
	if (!gesture) return;
	const word = words[gesture.index];
	if (!word) return;

	const position = surface.pointer?.position;
	const deltaPx = position && position.state !== 'idle' ? position.deltaX : 0;
	const delta = pixelsToFrames(deltaPx, resolution) / fps;
	const duration = gesture.originEnd - gesture.originStart;

	let start = gesture.originStart;
	let end = gesture.originEnd;

	if (gesture.mode === 'move') {
		const minStart = gesture.prevEnd;
		const maxStart = gesture.nextStart - duration;
		if (maxStart >= minStart) {
			start = Math.min(Math.max(minStart, gesture.originStart + delta), maxStart);
			end = start + duration;
		}
	} else if (gesture.mode === 'in') {
		start = Math.min(Math.max(gesture.prevEnd, gesture.originStart + delta), gesture.originEnd - MIN_LENGTH);
	} else {
		end = Math.max(Math.min(gesture.nextStart, gesture.originEnd + delta), gesture.originStart + MIN_LENGTH);
	}

	if (word.start === start && word.end === end) return;
	word.start = start;
	word.end = end;
	gesture.dirty = true;
}

function transcriptFromGroups(groups: WordGroup[]) {
	return groups
		.filter((group) => group.length > 0)
		.map((group) => ({
			text: group.map((word) => word.text).join(' '),
			words: group.map((word) => ({ ...word })),
		}));
}
