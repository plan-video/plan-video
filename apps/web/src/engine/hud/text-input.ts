/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The canvas cannot take text input, so a hidden <textarea> holds the text and
// caret (keyboard, clipboard, IME and undo all work on it). The caret is drawn
// from where the renderer put the glyphs (`textCaretLines`), the only layout
// sure to match them.

import {
	Chars, Computed, HitRegions, RenderSurface,
	entityQuad, entityWorldMat, invert2D, isCaption, isText, multiply2D, pointInQuad, rectToQuad, store,
	textCaretLines, transformPoint, translate2D,
} from '@plan.video/runtime';

import { t } from '@/lib/i18n';

import { getDocumentEditor } from '../editor';
import { getToolCursor, updateCursor } from '../input/cursor';

import type { Entity, World } from 'koota';
import type { CaretLine, DispatchedPointerEvent, Point, Quad } from '@plan.video/runtime';

const ACCENT = '#2f6ff0';
const SELECTION = 'rgba(47, 111, 240, 0.32)';
const BLINK = 530;

const INPUT_STYLE = {
	position: 'absolute',
	width: '1px',
	height: '1px',
	padding: '0',
	border: '0',
	margin: '0',
	opacity: '0',
	resize: 'none',
	overflow: 'hidden',
	whiteSpace: 'pre',
	pointerEvents: 'none',
};

type Editing = {
	world: World;
	entity: Entity;
	input: HTMLTextAreaElement;
	// Last caret move or keystroke, so the caret shows solid while in use.
	since: number;
	anchor: number;
	close: () => void;
};

let editing: Editing | null = null;

// A caption's words come from its transcript, so it is not editable here.
export function isEditableText(entity: Entity): boolean {
	return entity.isAlive() && isText(entity) && !isCaption(entity);
}

export function getEditingText(): Entity | null {
	return editing?.entity ?? null;
}

export function mountTextInput(world: World, entity: Entity, point?: Point): void {
	if (!isEditableText(entity)) return;
	const canvas = world.get(RenderSurface)?.canvas;
	if (!(canvas instanceof HTMLCanvasElement) || !canvas.parentElement) return;
	const container = canvas.parentElement;

	unmountTextInput();

	const editor = getDocumentEditor(world);
	const input = document.createElement('textarea');
	input.value = entity.get(Chars)?.value ?? '';
	input.spellcheck = false;
	input.setAttribute('autocomplete', 'off');
	input.setAttribute('aria-label', t('Text'));
	Object.assign(input.style, INPUT_STYLE);

	const restart = () => {
		if (editing?.input === input) editing.since = performance.now();
	};

	input.addEventListener('input', () => {
		if (!entity.isAlive()) return;
		editor.editText(entity, input.value);
		restart();
	});

	input.addEventListener('keydown', (event) => {
		// The canvas shortcuts listen on the window; typing here is not for them.
		event.stopPropagation();
		restart();

		if (event.key === 'Escape') {
			event.preventDefault();
			input.blur();
		}
	});

	input.addEventListener('blur', () => {
		if (document.hasFocus()) close();
	});

	// A press inside the text keeps the focus here; anywhere else focus leaves and the editor closes.
	const keepFocus = (event: MouseEvent) => {
		if (event.button !== 0) return;
		const rect = canvas.getBoundingClientRect();
		const resolution = world.get(RenderSurface)?.resolution ?? 1;
		const x = (event.clientX - rect.left) * resolution;
		const y = (event.clientY - rect.top) * resolution;
		if (entity.isAlive() && pointInQuad(x, y, textArea(world, entity))) event.preventDefault();
	};
	canvas.addEventListener('mousedown', keepFocus);

	const close = () => {
		canvas.removeEventListener('mousedown', keepFocus);
		input.remove();
		if (editing?.input === input) {
			editing = null;
			updateCursor(world, getToolCursor(world));
		}
	};

	editing = { world, entity, input, since: performance.now(), anchor: 0, close };
	container.appendChild(input);
	input.focus({ preventScroll: true });

	const index = point ? indexAt(world, entity, point) : null;
	if (index === null) input.select();
	else input.setSelectionRange(index, index);
	editing.anchor = index ?? 0;
}

export function unmountTextInput(): void {
	editing?.close();
}

// The box plus any lines that run out of it, which a box too small for its text allows.
function textArea(world: World, entity: Entity): Quad {
	const computed = store(world, Computed);
	let [left, top] = [0, 0];
	let right = computed.width[entity.id()] ?? 0;
	let bottom = computed.height[entity.id()] ?? 0;

	for (const line of textCaretLines(world, entity)) {
		left = Math.min(left, line.stops[0]!);
		right = Math.max(right, line.stops[line.stops.length - 1]!);
		top = Math.min(top, line.top);
		bottom = Math.max(bottom, line.top + line.height);
	}

	return rectToQuad(multiply2D(entityWorldMat(world, entity), translate2D(left, top)), right - left, bottom - top);
}

// At a wrap, the character belongs to the line it begins.
function lineOf(lines: CaretLine[], index: number): CaretLine | undefined {
	return lines.find((line, i) => index >= line.start && (index < line.end || index === line.end && lines[i + 1]?.start !== index))
		?? lines[lines.length - 1];
}

function stopAt(line: CaretLine, index: number): number {
	return line.stops[Math.min(Math.max(index - line.start, 0), line.stops.length - 1)]!;
}

function indexAt(world: World, entity: Entity, point: Point): number | null {
	const lines = textCaretLines(world, entity);
	if (!lines.length) return null;

	const local = transformPoint(invert2D(entityWorldMat(world, entity)), point.x, point.y);
	const line = lines.find((candidate) => local.y < candidate.top + candidate.height) ?? lines[lines.length - 1]!;

	let best = 0;
	for (let i = 1; i < line.stops.length; i++) {
		if (Math.abs(line.stops[i]! - local.x) < Math.abs(line.stops[best]! - local.x)) best = i;
	}
	return line.start + best;
}

const WORD = /[\p{L}\p{N}_'’]/u;

function wordAt(text: string, index: number): [number, number] {
	const at = Math.min(index, Math.max(text.length - 1, 0));
	const inWord = WORD.test(text[at] ?? '');
	const same = (char: string) => char !== '\n' && WORD.test(char) === inWord;
	let start = at;
	let end = at;
	while (start > 0 && same(text[start - 1]!)) start--;
	while (end < text.length && same(text[end]!)) end++;
	return [start, end];
}

function select(input: HTMLTextAreaElement, anchor: number, focus: number): void {
	input.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), focus < anchor ? 'backward' : 'forward');
}

function handleTextInputInteraction(world: World, event: DispatchedPointerEvent): void {
	if (!editing || editing.world !== world) return;
	const { entity, input } = editing;
	if (!entity.isAlive()) return;

	const point = { x: event.clientX, y: event.clientY };

	if (event.type === 'pointerenter' || event.type === 'pointermove') updateCursor(world, 'text');
	if (event.type === 'pointerleave') updateCursor(world, getToolCursor(world));

	if (event.type === 'dragstart') {
		const index = indexAt(world, entity, point);
		if (index === null) return;
		editing.anchor = index;
		input.setSelectionRange(index, index);
		editing.since = performance.now();
	}

	if (event.type === 'drag') {
		const index = indexAt(world, entity, point);
		if (index === null) return;
		select(input, editing.anchor, index);
		editing.since = performance.now();
	}

	if (event.type === 'dblclick') {
		const index = indexAt(world, entity, point);
		if (index === null) return;
		const [start, end] = wordAt(input.value, index);
		input.setSelectionRange(start, end);
	}

	if (input !== document.activeElement) input.focus({ preventScroll: true });
}

export function drawTextInput(world: World, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, resolution: number): void {
	if (!editing || editing.world !== world) return;
	const { entity, input } = editing;
	if (!isEditableText(entity)) {
		unmountTextInput();
		return;
	}

	world.get(HitRegions)!.list.push({
		target: { kind: 'hud', id: 'text-input', quad: textArea(world, entity), entity },
		callback: handleTextInputInteraction,
	});

	const quad = entityQuad(world, entity);

	ctx.resetTransform();
	ctx.beginPath();
	ctx.moveTo(quad[0].x, quad[0].y);
	for (const corner of [quad[1], quad[2], quad[3]]) ctx.lineTo(corner.x, corner.y);
	ctx.closePath();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();

	const lines = textCaretLines(world, entity);
	if (!lines.length) return;

	const mat = entityWorldMat(world, entity);
	const start = Math.min(input.selectionStart, input.selectionEnd);
	const end = Math.max(input.selectionStart, input.selectionEnd);

	if (start !== end) {
		ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
		ctx.fillStyle = SELECTION;
		for (const line of lines) {
			if (end < line.start || start > line.end) continue;
			const from = stopAt(line, Math.max(start, line.start));
			const to = stopAt(line, Math.min(end, line.end)) + (end > line.end ? line.height * 0.25 : 0);
			if (to > from) ctx.fillRect(from, line.top, to - from, line.height);
		}
	}

	const focus = input.selectionDirection === 'backward' ? start : end;
	const line = lineOf(lines, focus);
	if (!line) return;

	const x = stopAt(line, focus);
	const top = transformPoint(mat, x, line.top);
	const bottom = transformPoint(mat, x, line.top + line.height);

	input.style.left = `${top.x / resolution}px`;
	input.style.top = `${bottom.y / resolution}px`;

	const lit = ((performance.now() - editing.since) % (BLINK * 2)) < BLINK;
	if (start !== end || !lit || document.activeElement !== input) return;

	ctx.resetTransform();
	ctx.beginPath();
	ctx.moveTo(top.x, top.y);
	ctx.lineTo(bottom.x, bottom.y);
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.max(1, Math.round(1.5 * resolution));
	ctx.stroke();
}
