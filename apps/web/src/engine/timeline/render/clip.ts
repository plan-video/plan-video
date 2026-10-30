/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Caption, CaptionType, Chars, ClipDragOrigin, Computed, Hidden, Name, Selected, TrimDragOrigin, fitsChildren, getGeneratingColor, getSourceFailure, isCaption, isGenerating, isGroup, isText, store } from '@plan.video/runtime';

import { msg, t } from '@/lib/i18n';

import { getDocumentEditor } from '../../editor';
import {
	CLIP_BREAKPOINTS,
	CLIP_CORNER_RADIUS,
	CLIP_FONT,
	CLIP_LABEL_X,
	CLIP_LABEL_Y,
	CLIP_LABEL_HEIGHT,
	RULER_HEIGHT,
	TRIM_HANDLE_WIDTH,
} from '../config';
import { applyClipDrag, applyTrim, beginClipDrag, beginTrim } from '../drag';
import { getClipAsset, getClipFallbackName, getClipStyle } from '../style';
import { truncateText } from '../text';
import { framesToPixels, getResolution, getViewport } from '../view';
import { renderCaptionWords } from './caption';
import { renderGroup } from './group';
import { renderStillThumbnails, renderVideoThumbnails } from './thumbnails';
import { renderWaveform } from './waveform';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { ClipStyle } from '../style';
import type { RowCursor } from '../layout';
import type { TimelineSurfaceState } from '../surface';

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

	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, 0, width, row.height, CLIP_CORNER_RADIUS);
	ctx.fillStyle = generating ? getGeneratingColor(world) : style.background;
	ctx.fill();
	ctx.restore();

	if (!generating && !error) {
		renderContent(world, scene, surface, entity, asset, style, row);
	}


	{
		let label = entity.get(Name)?.value ?? '';

		if (isCaption(entity)) label = label || t('{preset} Captions', { preset: t(CAPTION_PRESETS[entity.get(Caption)?.type ?? CaptionType.CLASSIC]) });
		else if (isText(entity)) label = entity.get(Chars)?.value ?? label ?? '';
		if (!label) label = getClipFallbackName(world, entity);
		if (generating) label = t('Generating...');
		if (error) label = error;

		const [viewportLeft] = getViewport(world, scene, surface.layout.width);
		const x = Math.max(left, viewportLeft);
		const maxWidth = left + width - x - 2 * CLIP_LABEL_X;

		ctx.save();
		ctx.translate(x, 0);

		ctx.fillStyle = style.foreground;
		ctx.fontStretch = 'ultra-condensed';
		ctx.font = CLIP_FONT;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';

		const fitted = truncateText(ctx, label, maxWidth, CLIP_FONT);
		if (fitted) {
			ctx.fillText(fitted, CLIP_LABEL_X, row.height >= CLIP_BREAKPOINTS.xs ? CLIP_LABEL_Y : row.height / 2);
		}

		ctx.restore();
	}

	// Drawn last so it sits over the clip's content.
	const selected = entity.has(Selected);

	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, 0, width, row.height, CLIP_CORNER_RADIUS);
	ctx.clip();
	ctx.strokeStyle = selected ? surface.colors.border.ring : generating ? surface.colors.border.darker : style.border ?? surface.colors.border.darker;
	ctx.lineWidth = selected ? 3 : 2;
	ctx.stroke();
	ctx.restore();

	if (surface.replaceDrop?.includes(entity)) renderReplaceDrop(surface, left, width, row);

	handleTrim(world, surface, entity, left, width, row, resolution);
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

function renderReplaceDrop(surface: TimelineSurfaceState, left: number, width: number, row: RowCursor): void {
	const ctx = surface.ctx!;
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(left, 0, width, row.height, CLIP_CORNER_RADIUS);
	ctx.fillStyle = surface.colors.border.ring;
	ctx.fill();

	const label = truncateText(ctx, t('Replace'), width - 2 * CLIP_LABEL_X, CLIP_FONT);
	if (label) {
		ctx.font = CLIP_FONT;
		ctx.fillStyle = '#fff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, left + width / 2, row.height / 2);
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

function renderContent(
	world: World,
	scene: Entity,
	surface: TimelineSurfaceState,
	entity: Entity,
	asset: Asset | null,
	style: ClipStyle,
	row: RowCursor,
): void {
	if (isGroup(entity)) {
		renderGroup(world, scene, surface, entity, row);
		return;
	}

	const tall = row.height > CLIP_BREAKPOINTS.sm;

	switch (asset?.type) {
		case 'IMAGE':
		case 'SEQUENCE':
			renderStillThumbnails(world, scene, surface, entity, asset, row);
			return;

		case 'AUDIO':
			renderWaveform(world, scene, surface, entity, row, {
				asset,
				color: style.primary ?? style.foreground,
				offsetY: tall ? CLIP_LABEL_HEIGHT : 2,
				padding: 4,
			});
			return;

		case 'VIDEO':
			renderVideoThumbnails(world, scene, surface, entity, asset, row, style.primary ?? style.foreground);
			return;
	}
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
