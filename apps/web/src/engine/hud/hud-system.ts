/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Not, Or } from 'koota';
import {
	Active, Computed, Culled, Geometry, Group, Hidden,
	HitRegions, Hovering, IsMask, Name, Playback, RenderSurface, Root, Selected,
	Sequential, ChildOf,
	entityQuad, entityWorldMat, getMaskSelection, getSelectionMask, getSourceFailure, selectionSubject,
	invert2D, isGenerating,
	multiply2D, rectToQuad, rotate2D, scale2D, sortByItemIndex, store, transformPoint,
	translate2D,
} from '@plan.video/runtime';

import { t } from '@/lib/i18n';

import { EditorTheme, Hud, Keys, SnapLines } from '../traits';
import {
	handleLabelInteraction, handleMaskInteraction, handlePlayInteraction,
	handleResizeInteraction, handleRotateInteraction,
} from '../input/interactions';
import { getMarqueeQuad } from '../input/snapping';
import { getMountedNameInput } from './name-input';
import { drawTextInput, getEditingText } from './text-input';
import { quadsOverlap } from '../quads';

import type { Entity, World } from 'koota';
import type { Mat2D, Quad } from '@plan.video/runtime';

const ACCENT = '#2f6ff0';
const SNAP_COLOR = '#F43535';
const HEADER_COLORS = {
	dark: {
		label: 'rgba(242, 242, 242, 0.64)',
		selected: '#cce8ff',
		error: '#FF8A8A',
		badge: '#292929',
		selectedBadge: '#17284a',
	},
	light: {
		label: 'rgba(0, 0, 0, 0.55)',
		selected: '#1d4ed8',
		error: '#c81e1e',
		badge: '#e3e3e3',
		selectedBadge: '#dbe6fd',
	},
};
const HEADER_FONT = '500 11px Geist, Inter, sans-serif';
const HEADER_HEIGHT = 22;
const ACTIVE_BADGE_WIDTH = 60;
const MIN_HEADER_WIDTH = 48;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function hudSystem(world: World): void {
	const ctx = world.get(RenderSurface)?.ctx;
	if (!ctx) return;

	const resolution = world.get(RenderSurface)?.resolution ?? 1;

	drawSnapLines(world, ctx, resolution);
	drawHoverOutlines(world, ctx, resolution);

	// Must match the renderer's own paint order, so each header knows which nodes are drawn over it.
	const painted = [...world.query(Or(Geometry, Group), ChildOf(world.get(Root)!), Not(Culled))].sort(sortByItemIndex);
	const quads = painted.map((entity) => (entity.has(Hidden) || entity.has(IsMask) ? null : entityQuad(world, entity)));

	for (const entity of world.query(ChildOf(world.get(Root)!), Not(Culled), Not(Hidden))) {
		const index = painted.indexOf(entity);
		const above = index < 0 ? [] : quads.slice(index + 1).filter((quad): quad is Quad => quad !== null);
		drawHeader(world, ctx, entity, resolution, above);
	}

	const mask = world.get(Hud)?.mode === 'moving' || getEditingText() ? null : getSelectionMask(world);

	if (mask) {
		drawSelectionMask(world, ctx, mask, resolution);
		drawDimensions(world, ctx, mask, resolution);
	}

	drawMarquee(world, ctx, resolution);
	drawTextInput(world, ctx, resolution);
}

function drawSnapLines(world: World, ctx: Ctx2D, resolution: number): void {
	const lines = world.get(SnapLines)?.list ?? [];
	// Mod suspends snapping, so the guides go with it.
	if (lines.length === 0 || world.get(Keys)?.held.has('mod')) return;

	const cross = Math.round(3 * resolution);

	ctx.resetTransform();
	ctx.beginPath();

	for (const line of lines) {
		ctx.moveTo(line.from.x, line.from.y);
		ctx.lineTo(line.to.x, line.to.y);
	}

	ctx.closePath();
	ctx.strokeStyle = SNAP_COLOR;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();

	ctx.beginPath();

	for (const line of lines) {
		for (const point of [line.from, line.to]) {
			ctx.moveTo(point.x - cross, point.y - cross);
			ctx.lineTo(point.x + cross, point.y + cross);
			ctx.moveTo(point.x - cross, point.y + cross);
			ctx.lineTo(point.x + cross, point.y - cross);
		}
	}

	ctx.stroke();
}

function drawHoverOutlines(world: World, ctx: Ctx2D, resolution: number): void {
	for (const entity of world.query(Hovering, Or(Geometry, Group), Not(Sequential), Not(Culled))) {
		ctx.resetTransform();
		traceQuad(ctx, entityQuad(world, entity));
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = Math.round(2 * resolution);
		ctx.stroke();
	}
}

function drawHeader(world: World, ctx: Ctx2D, entity: Entity, resolution: number, above: Quad[]): void {
	const failure = getSourceFailure(entity);
	const label = failure || (isGenerating(entity) ? t('Generating...') : entity.get(Name)?.value);
	if (!label) return;

	const header = getHeaderLayout(world, entity, resolution);
	if (header.width < MIN_HEADER_WIDTH && getMountedNameInput()?.entity !== entity) return;

	// Only nodes over the bar clip it: one clip per later node would be scenes × scenes per frame.
	const bar = rectToQuad(header.mat, header.width, HEADER_HEIGHT);
	above = above.filter((quad) => quadsOverlap(quad, bar));

	const playback = entity.get(Playback);
	const selected = entity.has(Selected);
	const active = entity.has(Active);
	const colors = HEADER_COLORS[world.get(EditorTheme)?.mode ?? 'dark'];
	const foreground = failure ? colors.error : selected ? colors.selected : colors.label;
	const regions = world.get(HitRegions)!.list;
	const pushRegion = (region: (typeof regions)[number]) => {
		const { target } = region;
		if (target.kind === 'hud' && above.some((quad) => quadsOverlap(quad, target.quad))) return;
		regions.push(region);
	};

	ctx.save();
	// Clips intersect, so each one cutting out a single covering node cuts them all out.
	for (const quad of above) {
		ctx.resetTransform();
		ctx.beginPath();
		ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
		// Not traceQuad: it begins a new path, which would drop the rect and invert the clip.
		ctx.moveTo(quad[0].x, quad[0].y);
		ctx.lineTo(quad[1].x, quad[1].y);
		ctx.lineTo(quad[2].x, quad[2].y);
		ctx.lineTo(quad[3].x, quad[3].y);
		ctx.closePath();
		ctx.clip('evenodd');
	}

	ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);

	let labelStart = 0;

	if (playback) {
		ctx.save();
		ctx.fillStyle = foreground;
		if (playback.playing) {
			ctx.translate(4, 3);
			ctx.fill(PAUSE_PATH);
		} else {
			ctx.translate(3, 3);
			ctx.fill(PLAY_PATH);
			// The stroke's outer half lands the flat side on a whole pixel.
			ctx.strokeStyle = foreground;
			ctx.lineWidth = 1;
			ctx.lineJoin = 'round';
			ctx.stroke(PLAY_PATH);
		}
		ctx.restore();
		labelStart = 18;

		pushRegion({
			target: { kind: 'hud', id: 'play', entity, quad: rectToQuad(header.mat, 16, HEADER_HEIGHT) },
			callback: handlePlayInteraction,
		});
	}

	const labelMat = multiply2D(header.mat, translate2D(labelStart, 3));
	ctx.setTransform(labelMat.a, labelMat.b, labelMat.c, labelMat.d, labelMat.e, labelMat.f);
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	ctx.font = HEADER_FONT;

	const badgeWidth = active ? ACTIVE_BADGE_WIDTH : 0;
	const fitted = fitTextToWidth(ctx, label, header.width - labelStart - badgeWidth);
	const showBadge = active && header.width > badgeWidth;
	const badgeText = t('Active');
	const badgeBox = showBadge ? Math.ceil(ctx.measureText(badgeText).width) + 8 : 0;

	if (fitted) {
		ctx.fillStyle = foreground;
		ctx.fillText(fitted.value, 0, 0);

		pushRegion({
			target: {
				kind: 'hud',
				id: 'label',
				entity,
				quad: rectToQuad(multiply2D(header.mat, translate2D(labelStart, 0)), fitted.width + 4 + badgeBox, HEADER_HEIGHT),
			},
			callback: handleLabelInteraction,
		});
	}

	const renaming = getMountedNameInput();
	if (renaming && renaming.entity === entity) {
		const inputMat = multiply2D(header.mat, translate2D(labelStart - 3, 0));
		renaming.input.style.left = `${inputMat.e / resolution}px`;
		renaming.input.style.top = `${inputMat.f / resolution}px`;
		renaming.input.style.transform = `rotate(${header.rotation}deg)`;
		renaming.input.style.width = `${(fitted?.width ?? 40) + 4}px`;
	}

	if (showBadge) {
		ctx.setTransform(header.mat.a, header.mat.b, header.mat.c, header.mat.d, header.mat.e, header.mat.f);
		ctx.translate(Math.round((fitted?.width ?? 0) + labelStart + 4), 0);
		ctx.beginPath();
		ctx.roundRect(0, 0, badgeBox, 16, 2);
		ctx.closePath();
		ctx.fillStyle = selected ? colors.selectedBadge : colors.badge;
		ctx.fill();

		ctx.translate(4, 3);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.font = HEADER_FONT;
		ctx.fillStyle = foreground;
		ctx.fillText(badgeText, 0, 0);
	}

	ctx.restore();
}

function drawSelectionMask(world: World, ctx: Ctx2D, mask: { width: number; height: number; mat: Mat2D }, resolution: number): void {
	const { width, height, mat } = mask;
	const selection = getMaskSelection(world);
	const regions = world.get(HitRegions)!.list;

	ctx.resetTransform();
	ctx.beginPath();

	for (const entity of selection) {
		const quad = entityQuad(world, entity);
		ctx.moveTo(quad[0].x, quad[0].y);
		ctx.lineTo(quad[1].x, quad[1].y);
		ctx.lineTo(quad[2].x, quad[2].y);
		ctx.lineTo(quad[3].x, quad[3].y);
		ctx.lineTo(quad[0].x, quad[0].y);
	}

	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);
	ctx.rect(0, 0, width, height);
	ctx.closePath();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(selection.length === 1 ? 2 : 1 * resolution);
	ctx.stroke();

	regions.push({
		target: { kind: 'hud', id: 'selection', quad: rectToQuad(mat, width, height) },
		callback: handleMaskInteraction,
	});

	const rotate = Math.round(16 * resolution);
	const rotateRegions: Record<string, [x: number, y: number]> = {
		rtl: [-rotate, -rotate],
		rtr: [width, -rotate],
		rbr: [width, height],
		rbl: [-rotate, height],
	};

	for (const [id, [x, y]] of Object.entries(rotateRegions)) {
		regions.push({
			target: { kind: 'hud', id, quad: rectToQuad(multiply2D(mat, translate2D(x, y)), rotate, rotate) },
			callback: handleRotateInteraction,
		});
	}

	const edge = Math.round(6 * resolution);
	const edgeOffset = Math.round(edge / 2);
	const edgeRegions: Record<string, [x: number, y: number, width: number, height: number]> = {
		l: [-edgeOffset, 0, edge, height],
		t: [0, -edgeOffset, width, edge],
		r: [width - edgeOffset, 0, edge, height],
		b: [0, height - edgeOffset, width, edge],
	};

	for (const [id, [x, y, regionWidth, regionHeight]] of Object.entries(edgeRegions)) {
		regions.push({
			target: { kind: 'hud', id, quad: rectToQuad(multiply2D(mat, translate2D(x, y)), regionWidth, regionHeight) },
			callback: handleResizeInteraction,
		});
	}

	ctx.beginPath();

	const handle = Math.round(8 * resolution);
	const handleOffset = Math.round(handle / 2);
	const corners: Record<string, [x: number, y: number]> = {
		tl: [-handleOffset, -handleOffset],
		tr: [width - handleOffset, -handleOffset],
		br: [width - handleOffset, height - handleOffset],
		bl: [-handleOffset, height - handleOffset],
	};

	for (const [id, [x, y]] of Object.entries(corners)) {
		const corner = multiply2D(mat, translate2D(x, y));
		ctx.setTransform(corner.a, corner.b, corner.c, corner.d, corner.e, corner.f);
		ctx.rect(0, 0, handle, handle);

		regions.push({
			target: { kind: 'hud', id, quad: rectToQuad(corner, handle, handle) },
			callback: handleResizeInteraction,
		});
	}

	ctx.closePath();
	ctx.fillStyle = '#FFFFFF';
	ctx.fill();
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();
}

function drawDimensions(world: World, ctx: Ctx2D, mask: { width: number; height: number; mat: Mat2D }, resolution: number): void {
	const selection = getMaskSelection(world);

	let rotation = 0;
	let center = 0;
	let x = 0;
	let y = 0;
	let width = 0;
	let height = 0;
	let offset = -16;

	if (selection.length === 1) {
		const entity = selectionSubject(world, selection[0]!);
		const computed = store(world, Computed);
		const eid = entity.id();

		const top = [...entityQuad(world, entity)]
			.sort((a, b) => a.y - b.y)
			.slice(0, 2)
			.sort((a, b) => a.x - b.x);

		rotation = Math.atan2(top[1]!.y - top[0]!.y, top[1]!.x - top[0]!.x) * 180 / Math.PI;
		center = Math.hypot(top[0]!.x - top[1]!.x, top[0]!.y - top[1]!.y) / 2;
		width = (computed.width[eid] ?? 0) * Math.abs(computed.scaleX[eid] ?? 1);
		height = (computed.height[eid] ?? 0) * Math.abs(computed.scaleY[eid] ?? 1);
		x = top[0]!.x;
		y = top[0]!.y;
		if (hasHeader(world, entity)) {
			offset = (center * 2) / resolution >= 240 ? -HEADER_HEIGHT / 2 - 2.5 : -HEADER_HEIGHT - 12;
		}
	} else {
		// Inverted as a direction, not a point, so the readout is the size in the document.
		const inverse = invert2D(entityWorldMat(world, null));
		inverse.e = 0;
		inverse.f = 0;
		const size = transformPoint(inverse, mask.width, mask.height);

		width = size.x;
		height = size.y;
		x = mask.mat.e;
		y = mask.mat.f;
		center = mask.width / 2;
	}

	ctx.save();

	let mat = translate2D(x, y);
	mat = multiply2D(mat, rotate2D(rotation));
	mat = multiply2D(mat, scale2D(resolution, resolution));
	mat = multiply2D(mat, translate2D(center / resolution, offset));
	ctx.setTransform(mat.a, mat.b, mat.c, mat.d, mat.e, mat.f);

	const text = `${Math.round(width * 100) / 100}x${Math.round(height * 100) / 100}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = '500 11px Geist, Inter, sans-serif';

	const boxWidth = ctx.measureText(text).width + 8;

	ctx.beginPath();
	ctx.roundRect(-boxWidth / 2, -9, boxWidth, 16, 3);
	ctx.closePath();
	ctx.fillStyle = ACCENT;
	ctx.fill();

	ctx.fillStyle = '#FFFFFF';
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

function hasHeader(world: World, entity: Entity): boolean {
	if (!entity.has(ChildOf(world.get(Root)!)) || entity.has(Hidden)) return false;
	return !!(getSourceFailure(entity) || isGenerating(entity) || entity.get(Name)?.value);
}

function drawMarquee(world: World, ctx: Ctx2D, resolution: number): void {
	const marquee = getMarqueeQuad(world);
	if (!marquee) return;

	ctx.resetTransform();
	ctx.beginPath();
	ctx.rect(
		marquee[0].x,
		marquee[0].y,
		marquee[1].x - marquee[0].x,
		marquee[3].y - marquee[0].y,
	);
	ctx.closePath();

	ctx.fillStyle = ACCENT;
	ctx.globalAlpha = 0.15;
	ctx.fill();
	ctx.globalAlpha = 1;
	ctx.strokeStyle = ACCENT;
	ctx.lineWidth = Math.round(resolution);
	ctx.stroke();
}

function traceQuad(ctx: Ctx2D, quad: ReturnType<typeof entityQuad>): void {
	ctx.beginPath();
	ctx.moveTo(quad[0].x, quad[0].y);
	ctx.lineTo(quad[1].x, quad[1].y);
	ctx.lineTo(quad[2].x, quad[2].y);
	ctx.lineTo(quad[3].x, quad[3].y);
	ctx.closePath();
}

function getHeaderLayout(world: World, entity: Entity, resolution: number): { rotation: number; width: number; mat: Mat2D } {
	const top = [...entityQuad(world, entity)]
		.sort((a, b) => a.y - b.y)
		.slice(0, 2)
		.sort((a, b) => a.x - b.x);

	const rotation = Math.atan2(top[1]!.y - top[0]!.y, top[1]!.x - top[0]!.x) * 180 / Math.PI;
	const width = Math.hypot(top[0]!.x - top[1]!.x, top[0]!.y - top[1]!.y) / resolution;
	const radians = rotation * Math.PI / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return {
		rotation,
		width,
		mat: {
			a: cos * resolution,
			b: sin * resolution,
			c: -sin * resolution,
			d: cos * resolution,
			e: Math.round(top[0]!.x - HEADER_HEIGHT * (-sin * resolution)),
			f: Math.round(top[0]!.y - HEADER_HEIGHT * (cos * resolution)),
		},
	};
}

const PLAY_PATH = new Path2D("M0.5 0.5L8.5 5L0.5 9.5Z");
const PAUSE_PATH = new Path2D("M0 0H2V10H0ZM5 0H7V10H5Z");

const TEXT_WIDTHS = new Map<string, number>();

function fitTextToWidth(ctx: Ctx2D, text: string, maxWidth: number): { value: string; width: number } | null {
	const widthOf = (value: string): number => {
		let width = TEXT_WIDTHS.get(value);
		if (width === undefined) {
			width = ctx.measureText(value).width;
			TEXT_WIDTHS.set(value, width);
		}
		return width;
	};

	const width = widthOf(text);
	if (width <= maxWidth) return { value: text, width };

	const available = maxWidth - widthOf('...');
	if (available <= 0) return null;

	let start = 0;
	let end = text.length;
	let best = 0;

	while (start <= end) {
		const mid = Math.floor((start + end) / 2);

		if (widthOf(text.slice(0, mid)) <= available) {
			best = mid;
			start = mid + 1;
		} else {
			end = mid - 1;
		}
	}

	if (best === 0) return null;

	const value = `${text.slice(0, best)}...`;
	return { value, width: widthOf(value) };
}
