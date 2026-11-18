/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Caption, CaptionType, Chars, ClipDragOrigin, Computed, Hidden, Name, Selected, TrimDragOrigin, fitsChildren, getGeneratingColor, getSourceFailure, isCaption, isGenerating, isGroup, isText, store } from '@plan.video/runtime';

import { msg, t } from '@/lib/i18n';

import { getDocumentEditor } from '../../editor';
import {
	CLIP_CORNER_RADIUS,
	CLIP_FONT,
	CLIP_LABEL_HEIGHT,
	CLIP_LABEL_X,
	RULER_HEIGHT,
	TRIM_HANDLE_WIDTH,
} from '../config';
import { applyClipDrag, applyTrim, beginClipDrag, beginTrim } from '../drag';
import { getRowBody } from '../layout';
import { getClipAsset, getClipFallbackName, getClipStyle } from '../style';
import { truncateText } from '../text';
import { framesToPixels, getResolution, getViewport } from '../view';
import { renderCaptionWords } from './caption';
import { renderGroup } from './group';
import { renderStillThumbnails, renderVideoThumbnails } from './thumbnails';
import { leadingMarkerReach } from './transitions';
import { renderWaveform } from './waveform';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { ClipStyle } from '../style';
import type { RowBody, RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

/**
 * What a clip's name sits on: its plain fill (in the `middle`, or at the `top` over what is drawn
 * below it), a waveform (`tint`, which gives way to the name) or pictures (`picture`, a dark plate).
 */
type LabelLook = 'middle' | 'top' | 'tint' | 'picture';

const LABEL_PLATE_INSET = 4;
const LABEL_PLATE_PADDING = 5;
const LABEL_PLATE_RADIUS = 4;
/** Shorter than this, a clip has no room for a name above its content. */
const MIN_HEIGHT_WITH_PLATE = 26;
/** How far past a name the waveform takes to come back in. */
const LABEL_FADE = 14;

const TRIM_CAP_WIDTH = 7;
const TRIM_GRIP_HEIGHT = 12;

/** The context is already translated to the row's top, so everything is drawn from y = 0. */
export function renderClip(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	row: RowCursor,
): void {
	const { ctx, pointer } = surface;
	if (!ctx || !pointer) return;

	const computed = store(world, Computed);
	const resolution = getResolution(world, scene);

	let left = framesToPixels(computed.start[entity.id()] ?? 0, resolution);
	const width = framesToPixels(computed.end[entity.id()] ?? 0, resolution) - left;

	// Scoped per clip so two clips at the same place on two rows are told apart.
	pointer.scope(String(entity.id()));
	markClip(surface, entity, left, width, row);

	const asset = getClipAsset(world, entity);
	const error = getSourceFailure(entity);
	const style = getClipStyle(surface.colors, entity, asset, !!error?.length);
	const generating = isGenerating(entity);

	if (isCaption(entity) && !generating && !error && renderCaptionWords(world, surface, entity, row, style, resolution)) {
		return;
	}

	handleBody(world, surface, entity, left, width, row, resolution);

	if (entity.has(ClipDragOrigin)) {
		left = framesToPixels(computed.start[entity.id()] ?? 0, resolution);
	}

	const body = getRowBody(row);

	// Everything a clip draws stays inside its rounded body.
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, body.top, width, body.height, CLIP_CORNER_RADIUS);
	ctx.fillStyle = generating ? getGeneratingColor(world) : style.background;
	ctx.fill();
	ctx.clip();

	const look = generating || error ? 'middle' : renderContent(world, scene, surface, entity, asset, style, body);

	{
		let label = entity.get(Name)?.value ?? '';

		if (isCaption(entity)) label = label || t('{preset} Captions', { preset: t(CAPTION_PRESETS[entity.get(Caption)?.type ?? CaptionType.CLASSIC]) });
		else if (isText(entity)) label = entity.get(Chars)?.value ?? label ?? '';
		if (!label) label = getClipFallbackName(world, entity);
		if (generating) label = t('Generating...');
		if (error) label = error;

		const [viewportLeft] = getViewport(world, scene, surface.layout.width);
		const start = left + leadingMarkerReach(world, entity, row);
		renderLabel(surface, label, style, look, Math.max(start, viewportLeft), left + width, body);
	}

	renderOutline(surface, entity, style, left, width, body, generating);
	ctx.restore();

	if (surface.replaceDrop?.includes(entity)) renderReplaceDrop(surface, left, width, body);

	handleTrim(world, surface, entity, left, width, row, resolution);
}

/** `x` is where the clip starts on screen, so the name of a clip scrolled half out of view stays readable. */
function renderLabel(
	surface: TimelineSurfaceState,
	label: string,
	style: ClipStyle,
	look: LabelLook,
	x: number,
	right: number,
	body: RowBody,
): void {
	const ctx = surface.ctx!;

	ctx.save();
	ctx.fontStretch = 'ultra-condensed';
	ctx.font = CLIP_FONT;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';

	const fitted = truncateText(ctx, label, right - x - 2 * CLIP_LABEL_X, CLIP_FONT);
	if (!fitted) {
		ctx.restore();
		return;
	}

	const roomy = body.height >= MIN_HEIGHT_WITH_PLATE;
	const atTop = roomy && (look === 'top' || look === 'picture');
	const y = atTop ? body.top + LABEL_PLATE_INSET + CLIP_LABEL_HEIGHT / 2 : body.top + body.height / 2;
	const width = ctx.measureText(fitted).width;

	if (look === 'picture' && roomy) {
		ctx.beginPath();
		ctx.roundRect(
			x + CLIP_LABEL_X - LABEL_PLATE_PADDING,
			y - CLIP_LABEL_HEIGHT / 2,
			width + LABEL_PLATE_PADDING * 2,
			CLIP_LABEL_HEIGHT,
			LABEL_PLATE_RADIUS,
		);
		ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
		ctx.fill();
	} else if (look === 'tint') {
		// The waveform steps aside for the name and fades back in after it, rather than running through the letters.
		const end = x + CLIP_LABEL_X + width + LABEL_PLATE_PADDING;
		const fade = ctx.createLinearGradient(end, 0, end + LABEL_FADE, 0);
		fade.addColorStop(0, style.background);
		fade.addColorStop(1, seeThrough(style.background));
		ctx.fillStyle = fade;
		ctx.fillRect(x, body.top, end + LABEL_FADE - x, body.height);
	}

	ctx.fillStyle = look === 'picture' && roomy ? 'rgba(255, 255, 255, 0.94)' : style.foreground;
	// Half a pixel down: Geist's capitals sit high on a middle baseline.
	ctx.fillText(fitted, x + CLIP_LABEL_X, y + 0.5);
	ctx.restore();
}

/** The same colour at no opacity, so a fade to it never passes through grey. */
function seeThrough(color: string): string {
	return /^#[0-9a-f]{6}$/i.test(color) ? `${color}00` : 'transparent';
}

/** Drawn last, over the clip's content. A selected clip also shows the ends it can be trimmed by. */
function renderOutline(
	surface: TimelineSurfaceState,
	entity: Entity,
	style: ClipStyle,
	left: number,
	width: number,
	body: RowBody,
	generating: boolean,
): void {
	const ctx = surface.ctx!;

	if (!entity.has(Selected)) {
		ctx.beginPath();
		ctx.roundRect(left + 0.5, body.top + 0.5, Math.max(0, width - 1), body.height - 1, CLIP_CORNER_RADIUS - 0.5);
		ctx.strokeStyle = generating ? surface.colors.border.darker : style.border ?? surface.colors.border.darker;
		ctx.lineWidth = 1;
		ctx.stroke();
		return;
	}

	const ring = surface.colors.border.ring;

	// A container sized by its children has no end of its own to pull.
	if (!fitsChildren(entity) && width >= TRIM_CAP_WIDTH * 4) {
		ctx.fillStyle = ring;
		ctx.fillRect(left, body.top, TRIM_CAP_WIDTH, body.height);
		ctx.fillRect(left + width - TRIM_CAP_WIDTH, body.top, TRIM_CAP_WIDTH, body.height);

		const grip = Math.min(TRIM_GRIP_HEIGHT, body.height - 12);
		if (grip >= 6) {
			ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
			for (const x of [left + TRIM_CAP_WIDTH / 2, left + width - TRIM_CAP_WIDTH / 2]) {
				ctx.beginPath();
				ctx.roundRect(x - 1, body.top + (body.height - grip) / 2, 2, grip, 1);
				ctx.fill();
			}
		}
	}

	ctx.beginPath();
	ctx.roundRect(left + 1, body.top + 1, Math.max(0, width - 2), body.height - 2, CLIP_CORNER_RADIUS - 1);
	ctx.strokeStyle = ring;
	ctx.lineWidth = 2;
	ctx.stroke();
}

function markClip(surface: TimelineSurfaceState, entity: Entity, left: number, width: number, row: RowCursor): void {
	const dpr = window.devicePixelRatio;
	const matrix = surface.ctx!.getTransform();
	const topLeft = matrix.transformPoint(new DOMPoint(left, 0));
	const bottomRight = matrix.transformPoint(new DOMPoint(left + width, row.height));
	surface.clips.push({
		clip: entity,
		left: topLeft.x / dpr,
		top: topLeft.y / dpr,
		right: bottomRight.x / dpr,
		bottom: bottomRight.y / dpr,
	});
}

export function findClipAt(surface: TimelineSurfaceState, x: number, y: number): Entity | null {
	if (y < RULER_HEIGHT) return null;
	const mark = surface.clips.findLast((mark) => x >= mark.left && x < mark.right && y >= mark.top && y < mark.bottom);
	return mark?.clip ?? null;
}

function renderReplaceDrop(surface: TimelineSurfaceState, left: number, width: number, body: RowBody): void {
	const ctx = surface.ctx!;
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, body.top, width, body.height, CLIP_CORNER_RADIUS);
	ctx.fillStyle = surface.colors.border.ring;
	ctx.fill();

	const label = truncateText(ctx, t('Replace'), width - 2 * CLIP_LABEL_X, CLIP_FONT);
	if (label) {
		ctx.font = CLIP_FONT;
		ctx.fillStyle = '#fff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, left + width / 2, body.top + body.height / 2);
	}
	ctx.restore();
}

/**
 * Handles sit inside the edges, a third of the clip at most, so even a narrow clip stays
 * grabbable in the middle.
 */
function handleTrim(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	left: number,
	width: number,
	row: RowCursor,
	resolution: number,
): void {
	// A container sized by its children has no edge of its own; moving one would move a child.
	if (fitsChildren(entity)) return;

	const pointer = surface.pointer!;
	const handle = Math.min(Math.max(width / 3, 3), width / 2, TRIM_HANDLE_WIDTH);

	const inHandle = pointer.region(left, 0, handle, row.height);
	const outHandle = pointer.region(left + width - handle, 0, handle, row.height);

	if (inHandle.hovering || inHandle.dragging) surface.cursor = 'trim-right';
	else if (outHandle.hovering || outHandle.dragging) surface.cursor = 'trim-left';

	const edge = inHandle.dragging ? 'in' : outHandle.dragging ? 'out' : null;
	if (edge === null) return;

	if (!entity.has(TrimDragOrigin)) beginTrim(world, entity);

	applyTrim(world, surface, entity, edge, resolution);
}

/** Returns what was drawn, so the name can be laid over it legibly. */
function renderContent(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset | null,
	style: ClipStyle,
	body: RowBody,
): LabelLook {
	if (isGroup(entity)) {
		renderGroup(world, scene, surface, entity, body);
		return 'top';
	}

	switch (asset?.type) {
		case 'IMAGE':
		case 'SEQUENCE':
			return renderStillThumbnails(world, scene, surface, entity, asset, body) ? 'picture' : 'middle';

		case 'AUDIO':
			renderWaveform(world, scene, surface, entity, {
				asset,
				color: style.primary ?? style.foreground,
				top: body.top,
				height: body.height,
				centred: true,
			});
			return 'tint';

		case 'VIDEO':
			renderVideoThumbnails(world, scene, surface, entity, asset, body, {
				background: style.background,
				waveform: style.primary ?? style.foreground,
			});
			return 'picture';
	}

	return 'middle';
}

/** Click, drag and marquee share one region: asking twice would look like two clips to the pointer. */
function handleBody(
	world: World,
	surface: TimelineSurfaceState,
	entity: Entity,
	left: number,
	width: number,
	row: RowCursor,
	resolution: number,
): void {
	const pointer = surface.pointer!;
	const editor = getDocumentEditor(world);

	const { pressed, clicked, dragging, intersectsMarquee } = pointer.region(left, 0, width, row.height);
	const selected = entity.has(Selected);

	// Selection is decided on press so a drag takes the clip along; an already selected clip waits
	// for release (drag moves the whole selection, click selects only it, Shift/Cmd removes it).
	if (pressed && !surface.marquee) {
		if (selected) {
			surface.press = { clip: entity, onClick: pointer.extending ? 'deselect' : 'select' };
		} else {
			editor.select(entity, { extend: pointer.extending });
			surface.press = { clip: entity, onClick: null };
		}
	}

	if (dragging && !entity.has(ClipDragOrigin) && !entity.has(TrimDragOrigin)) {
		beginClipDrag(world, entity);
	}
	if (entity.has(ClipDragOrigin)) {
		applyClipDrag(world, surface, entity, resolution);
	}

	// Under a marquee, entering selects and leaving deselects, so dragging back undoes it.
	// With Shift/Cmd it only gives back the clips it took.
	if (surface.marquee) {
		if (intersectsMarquee && !selected) editor.select(entity, { extend: true });
		if (!intersectsMarquee && selected && !surface.marqueeBase?.has(entity)) editor.deselect(entity);
		return;
	}

	if (!clicked) return;

	// A click quicker than a frame is released before its press is drawn, so it is handled here.
	const onClick = surface.press?.clip === entity
		? surface.press.onClick
		: pointer.extending ? (selected ? 'deselect' : 'extend') : 'select';

	if (onClick === 'select') editor.select(entity);
	else if (onClick === 'extend') editor.select(entity, { extend: true });
	else if (onClick === 'deselect') editor.deselect(entity);
}


const CAPTION_PRESETS: Record<CaptionType, string> = {
	[CaptionType.CLASSIC]: msg('Classic'),
	[CaptionType.CASCADE]: msg('Cascade'),
	[CaptionType.SPOTLIGHT]: msg('Spotlight'),
	[CaptionType.WHISPER]: msg('Whisper'),
	[CaptionType.PAPER]: msg('Paper'),
	[CaptionType.GUINEA]: msg('Guinea'),
	[CaptionType.STARK]: msg('Stark'),
	[CaptionType.POP]: msg('Pop'),
	[CaptionType.BOX]: msg('Box'),
	[CaptionType.MARKER]: msg('Highlighter'),
	[CaptionType.DEEP]: msg('Deep'),
	[CaptionType.RISE]: msg('Rise'),
	[CaptionType.FOCUS]: msg('Focus'),
};


export function getClipAlpha(entity: Entity): number {
	return entity.has(Hidden) ? 0.5 : 1;
}
