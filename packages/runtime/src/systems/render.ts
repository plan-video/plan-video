/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Render system (was systems/render.ts): draws the document tree onto the
// world's RenderSurface. Runs identically against the editor and capture
// canvases; without a surface it is a no-op. Hit
// regions are pushed callback-less (see HitRegions); the app's input layer
// attaches its handlers.

import { Not, Or } from 'koota';

import { store } from '../world/store';
import {
	COMPOSITE_OPERATIONS, GeometryType, PaintType, ScaleModeType,
	TransitionDirection, TransitionEasing, TransitionType,
} from '../constants';
import {
	ChildOf, Hidden, Culled, Interactive, IsMask,
	ClipsContent, Geometry, Group, Paint, Color, Caption, MediaCrop, ScaleMode, Shader,
	BlendMode, Transition, TransitionIn, MixedCornerRadius,
	LocalTransform, WorldTransform, Computed, Cache,
	Host,
	Mode, FrameRate, Camera, Background, DefaultBackground, DEFAULT_BACKGROUND, RenderSurface,
	HitRegions,
	Root,
} from '../traits';
import { getParentNode } from '../queries/hierarchy';
import { getPreviewScale, getViewMatrix } from '../queries/camera';
import { colorToHex } from '../utils/color';
import { sortByItemIndex } from '../utils/sort';
import { FAILED_COLOR, getGeneratingColor, getSourceFailure, isGenerating } from '../utils/generating';
import { applyStrokeStyle } from '../utils/stroke';
import { renderText } from '../utils/text';
import { getEdgeTransition, getTransitionPartner, getTransitionWindow } from '../utils/transition';
import { buildEffects } from '../utils/effects';
import { gradeFilter } from '../utils/grade';
import { getIntrinsicPaint } from '../utils/time';
import { createLinearGradient, createRadialGradient } from './gradients';
import {
	resolveImageDecoder, resolveVideoDecoder,
	resolveCaptionDecoder, resolveShaderHost, resolveWaveformPeaks,
} from '../media';

import type { Entity, World } from 'koota';
import type { Quad } from '../math/aabb';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MISSING_ASSET_COLOR = '#5C2828';

function getCtx(world: World): Ctx2D {
	return world.get(RenderSurface)!.ctx!;
}

export function drawRectPath(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	const hasMixed = entity.has(MixedCornerRadius);
	let tl = hasMixed ? computed.cornerRadiusTopLeft[eid]! : computed.cornerRadius[eid]!;
	let tr = hasMixed ? computed.cornerRadiusTopRight[eid]! : tl;
	let br = hasMixed ? computed.cornerRadiusBottomRight[eid]! : tl;
	let bl = hasMixed ? computed.cornerRadiusBottomLeft[eid]! : tl;

	ctx.beginPath();

	if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
		ctx.rect(0, 0, w, h);
	} else if (tl === tr && tr === br && br === bl) {
		ctx.roundRect(0, 0, w, h, tl);
	} else {
		// Clamp radii so adjacent corners don't exceed the edge length (CSS spec algorithm)
		const scale = Math.min(
			w / (tl + tr || 1),
			h / (tr + br || 1),
			w / (br + bl || 1),
			h / (bl + tl || 1),
			1,
		);
		if (scale < 1) {
			tl *= scale;
			tr *= scale;
			br *= scale;
			bl *= scale;
		}

		ctx.moveTo(tl, 0);
		ctx.lineTo(w - tr, 0);
		if (tr > 0) ctx.arcTo(w, 0, w, tr, tr);
		else ctx.lineTo(w, 0);
		ctx.lineTo(w, h - br);
		if (br > 0) ctx.arcTo(w, h, w - br, h, br);
		else ctx.lineTo(w, h);
		ctx.lineTo(bl, h);
		if (bl > 0) ctx.arcTo(0, h, 0, h - bl, bl);
		else ctx.lineTo(0, h);
		ctx.lineTo(0, tl);
		if (tl > 0) ctx.arcTo(0, 0, tl, 0, tl);
		else ctx.lineTo(0, 0);
	}

	ctx.closePath();
}

function getScaledImageProps(
	mode: number,
	imgW: number,
	imgH: number,
	targetW: number,
	targetH: number,
): [dx: number, dy: number, sw: number, sh: number] {
	if (mode === ScaleModeType.FILL) {
		return [0, 0, targetW, targetH];
	}
	if (mode === ScaleModeType.FIT) {
		const scale = Math.min(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	if (mode === ScaleModeType.COVER) {
		const scale = Math.max(targetW / imgW, targetH / imgH);
		const sw = imgW * scale;
		const sh = imgH * scale;
		return [(targetW - sw) / 2, (targetH - sh) / 2, sw, sh];
	}
	// ScaleModeType.NONE — original size
	return [0, 0, imgW, imgH];
}

/** The source rectangle a media crop names, in the frame's pixels. The whole frame when there is no crop. */
function mediaCropPixels(world: World, source: Entity, frameWidth: number, frameHeight: number): { x: number; y: number; width: number; height: number } {
	const full = { x: 0, y: 0, width: frameWidth, height: frameHeight };
	if (!source.has(MediaCrop) || frameWidth <= 0 || frameHeight <= 0) return full;

	const crop = store(world, MediaCrop);
	const id = source.id();
	const x = (crop.x[id] ?? 0) * frameWidth;
	const y = (crop.y[id] ?? 0) * frameHeight;
	const width = (crop.width[id] ?? 1) * frameWidth;
	const height = (crop.height[id] ?? 1) * frameHeight;
	if (width <= 0 || height <= 0) return full;

	const sx = Math.max(0, Math.min(frameWidth, x));
	const sy = Math.max(0, Math.min(frameHeight, y));
	const sw = Math.max(0, Math.min(frameWidth - sx, width));
	const sh = Math.max(0, Math.min(frameHeight - sy, height));
	if (sw < 1 || sh < 1) return full;
	return { x: sx, y: sy, width: sw, height: sh };
}

/**
 * The geometry's intrinsic fill: its own Color trait (a solid, read from
 * Computed.color so it animates) and its own Paint trait (see
 * `getIntrinsicPaint`), if any, in that order. Drawn into the current path
 * before the Paint sub-entities so it always sits at the bottom of the fill
 * stack. A shader paint first in the stack takes an intrinsic image/video as
 * its input instead (see `renderShaderFill`), in which case the media is not
 * drawn here. Media paints and the surface paint (a `<surface>`, whose host
 * lives on the geometry) are intrinsic; a waveform (an audio clip's) has no
 * picture on the canvas.
 */
export function renderIntrinsicFill(world: World, entity: Entity): void {
	if (entity.has(Color)) {
		const ctx = getCtx(world);
		const computed = store(world, Computed);
		const eid = entity.id();
		ctx.fillStyle = colorToHex(computed.color[eid] ?? 0);
		ctx.fill();
	}

	const intrinsic = getIntrinsicPaint(entity);
	if (intrinsic === PaintType.SURFACE) {
		const canvas = entity.get(Host)?.element;
		if (canvas instanceof HTMLCanvasElement) {
			const ctx = getCtx(world);
			const computed = store(world, Computed);
			const eid = entity.id();
			ctx.save();
			ctx.clip();
			ctx.drawImage(canvas, 0, 0, computed.width[eid]!, computed.height[eid]!);
			ctx.restore();
		}
		return;
	}
	if (intrinsic === PaintType.HTML) {
		renderHtmlFill(world, entity, entity);
		return;
	}

	const kind = mediaKind(intrinsic);
	if (kind === null) return;
	if (shaderInput(world, entity, store(world, Cache).fills[entity.id()] ?? [], 0) === entity) return;
	renderMedia(world, entity, entity, kind);
}

type MediaKind = 'IMAGE' | 'VIDEO';

function mediaKind(paint: PaintType | undefined): MediaKind | null {
	if (paint === PaintType.IMAGE) return 'IMAGE';
	if (paint === PaintType.VIDEO) return 'VIDEO';
	return null;
}

/** What the image and video decoders hand out to draw. */
type MediaFrame = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

// html-in-canvas (https://github.com/WICG/html-in-canvas). Chromium only,
// behind chrome://flags/#canvas-draw-element; the API surface is still
// moving, so every touchpoint is typed and isolated here.
type DrawElementContext = Ctx2D & {
	drawElementImage(source: Element | unknown, dx: number, dy: number, dw: number, dh: number): DOMMatrix;
};


// Roots whose last drawElementImage threw, so a persistent failure logs once
// rather than flooding the console; drawing again clears the entry.
const failedHtmlRoots = new WeakSet<HTMLElement>();

function renderHtmlFill(world: World, entity: Entity, source: Entity): void {
	const root = source.get(Host)?.element;
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	if (!(ctx instanceof CanvasRenderingContext2D)) return;
	if (!(root instanceof HTMLElement)) return;

	const computed = store(world, Computed);
	const eid = entity.id();

	ctx.save();
	ctx.clip();

	const width = computed.width[eid]!;
	const height = computed.height[eid]!;
	root.style.width = `${width}px`;
	root.style.height = `${height}px`;

	try {
		(ctx as DrawElementContext).drawElementImage(root, 0, 0, width, height);
	} catch (error) {
		if (!failedHtmlRoots.has(root)) {
			failedHtmlRoots.add(root);
			console.error(`Error drawing <HtmlPaint> content: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
		}
	}

	ctx.restore();
}

/**
 * Draws the current frame of `source` (an image or video paint, or the
 * geometry itself for intrinsic media) into `entity`'s box, fitted by the
 * source's ScaleMode; a failed decoder paints the missing-asset color.
 */
function renderMedia(world: World, entity: Entity, source: Entity, kind: MediaKind): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	let frame: MediaFrame | null | undefined;
	let failed = false;
	if (kind === 'IMAGE') {
		const decoder = resolveImageDecoder(world, source)?.decoder;
		frame = decoder?.getBitmap(w, h);
		failed = decoder?.failed ?? false;
	} else {
		const decoder = resolveVideoDecoder(world, source);
		frame = decoder?.toBitmap();
		failed = decoder?.errored ?? false;
	}

	if (frame) {
		ctx.save();
		ctx.clip();

		const mode = store(world, ScaleMode).value[source.id()] ?? 0;
		const crop = mediaCropPixels(world, source, frame.width, frame.height);
		const [dx, dy, sw, sh] = getScaledImageProps(mode, crop.width, crop.height, w, h);
		if (crop.x === 0 && crop.y === 0 && crop.width === frame.width && crop.height === frame.height) {
			ctx.drawImage(frame, dx, dy, sw, sh);
		} else {
			ctx.drawImage(frame, crop.x, crop.y, crop.width, crop.height, dx, dy, sw, sh);
		}

		ctx.restore();
	} else if (failed) {
		ctx.fillStyle = MISSING_ASSET_COLOR;
		ctx.fill();
	}
}

export function renderFills(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const paintStore = store(world, Paint);
	const blendMode = store(world, BlendMode);
	const eid = entity.id();
	const fills = store(world, Cache).fills[eid] ?? [];

	for (let index = 0; index < fills.length; index++) {
		const fill = fills[index]!;
		if (fill.has(Hidden) || shaderConsumesFill(world, entity, fills, index)) continue;
		const fid = fill.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = blendMode.value[fid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		ctx.globalAlpha = savedAlpha * computed.opacity[fid]!;

		const paint = paintStore.value[fid];
		if (paint === PaintType.IMAGE) {
			renderMedia(world, entity, fill, 'IMAGE');
		} else if (paint === PaintType.VIDEO) {
			renderMedia(world, entity, fill, 'VIDEO');
		} else if (paint === PaintType.HTML) {
			renderHtmlFill(world, entity, fill);
		} else if (paint === PaintType.SURFACE) {
			const canvas = fill.get(Host)?.element;
			if (canvas instanceof HTMLCanvasElement) {
				ctx.save();
				ctx.clip();
				ctx.drawImage(canvas, 0, 0, computed.width[eid]!, computed.height[eid]!);
				ctx.restore();
			}
		} else if (paint === PaintType.SOLID) {
			ctx.fillStyle = colorToHex(computed.color[fid]!);
			ctx.fill();
		} else if (paint === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createLinearGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.fillStyle = createRadialGradient(world, fill, ctx, w, h);
			ctx.fill();
		} else if (paint === PaintType.WAVEFORM) {
			renderWaveform(world, entity, fill);
		} else if (paint === PaintType.SHADER) {
			renderShaderFill(world, entity, fills, index);
		}

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * Whether `source` is a picture a shader can sample: an image/video paint,
 * be it a paint sub-entity or the geometry's own intrinsic paint.
 */
function shaderMediaKind(world: World, source: Entity): 'IMAGE' | 'VIDEO' | null {
	if (!source.has(Paint)) return null;
	const paint = store(world, Paint).value[source.id()];
	if (paint === PaintType.IMAGE) return 'IMAGE';
	if (paint === PaintType.VIDEO) return 'VIDEO';
	return null;
}

/** The current frame of a video/image source, as a GPU-uploadable source. */
function shaderSourceBitmap(
	world: World,
	source: Entity,
	w: number,
	h: number,
): { source: GPUCopyExternalImageSource; width: number; height: number } | null {
	const kind = shaderMediaKind(world, source);

	if (kind === 'IMAGE') {
		const bitmap = resolveImageDecoder(world, source)?.decoder?.getBitmap(w, h);
		return bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : null;
	}
	if (kind === 'VIDEO') {
		const frame = resolveVideoDecoder(world, source)?.toBitmap();
		return frame ? { source: frame, width: frame.width, height: frame.height } : null;
	}
	return null;
}

/**
 * The media directly below the fill at `index`, if it is one a shader could
 * take as input: the visible image/video paint right before it, or, for the
 * first fill, the geometry's own intrinsic image/video. Only the immediate
 * neighbor counts (a hidden paint in between decouples the pair).
 */
function mediaBelow(world: World, entity: Entity, fills: Entity[], index: number): Entity | null {
	const source = index === 0 ? entity : fills[index - 1]!;
	if (source.has(Hidden)) return null;
	return shaderMediaKind(world, source) === null ? null : source;
}

/**
 * The media the shader paint at `index` will sample this frame, or null when
 * it has none to (there is no shader there, it is not ready, nothing samplable
 * sits below it, or that has no frame yet). Whatever it returns is drawn by
 * the shader and not on its own — a consumed media that the shader then fails
 * to draw would blank the element, so this checks pipeline readiness and frame
 * availability, and `renderShaderFill` draws exactly what it says.
 */
function shaderInput(world: World, entity: Entity, fills: Entity[], index: number): Entity | null {
	const shader = fills[index];
	if (shader === undefined || store(world, Paint).value[shader.id()] !== PaintType.SHADER) return null;
	if (shader.has(Hidden)) return null;
	if (!resolveShaderHost(world, shader)?.ready) return null;

	const media = mediaBelow(world, entity, fills, index);
	if (media === null) return null;

	const computed = store(world, Computed);
	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;
	return shaderSourceBitmap(world, media, w, h) === null ? null : media;
}

/**
 * Whether the fill at `index` is the input of a ready shader paint directly
 * above it (see `shaderInput`).
 */
function shaderConsumesFill(world: World, entity: Entity, fills: Entity[], index: number): boolean {
	return shaderInput(world, entity, fills, index + 1) === fills[index];
}

/**
 * Draws a shader paint: the media directly below it — the image/video paint
 * before it in the fill stack, or the geometry's intrinsic media under the
 * first fill — is sampled as the shader's `source` texture and its output
 * lands in the parent's box in the media's place. Without media below the
 * shader runs procedurally over a transparent source; before the pipeline is
 * ready it draws nothing and the media, if any, draws normally.
 */
function renderShaderFill(world: World, entity: Entity, fills: Entity[], index: number): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const host = resolveShaderHost(world, fills[index]!);
	if (!host?.ready) return;

	const eid = entity.id();
	const w = computed.width[eid]!;
	const h = computed.height[eid]!;

	// Anything but samplable media below (no fill below, a hidden one, a
	// solid/gradient) runs the shader procedurally over a transparent source,
	// stacking like a normal paint.
	const media = mediaBelow(world, entity, fills, index);
	let input: ReturnType<typeof shaderSourceBitmap> = null;
	if (media !== null) {
		input = shaderSourceBitmap(world, media, w, h);
		if (!input) return;
	}

	const fit = input
		? getScaledImageProps(store(world, ScaleMode).value[media!.id()] ?? 0, input.width, input.height, w, h)
		: [0, 0, w, h] as [number, number, number, number];
	const fps = world.get(FrameRate)?.value ?? 30;
	const time = (computed.localTime[eid] ?? 0) / fps;

	ctx.save();
	ctx.clip();
	host.draw(ctx, w, h, input?.source ?? null, input?.width ?? 1, input?.height ?? 1, fit, time, store(world, Shader).uniforms[fills[index]!.id()] ?? null);
	ctx.restore();
}

function renderShadows(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const shadows = store(world, Cache).shadows[entity.id()];
	if (!shadows) return;

	ctx.save();
	const savedAlpha = ctx.globalAlpha;

	// ctx.shadowBlur/OffsetX/OffsetY are in device-pixel space and are not
	// affected by the current transform, so scale them up to match the
	// content transform (camera * resolution).
	const camera = world.get(Root)!.get(Camera);
	const resolution = (world.get(RenderSurface)?.resolution ?? 1) * getPreviewScale(world);
	const shadowScale = (camera?.a ?? 1) * resolution;

	for (const shadow of shadows) {
		if (shadow.has(Hidden)) continue;
		const sid = shadow.id();
		const color = colorToHex(computed.color[sid]!);
		ctx.shadowColor = color;
		ctx.fillStyle = color;
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;
		ctx.shadowBlur = computed.blur[sid]! * shadowScale;
		ctx.shadowOffsetX = computed.offsetX[sid]! * shadowScale;
		ctx.shadowOffsetY = computed.offsetY[sid]! * shadowScale;
		ctx.fill();
	}

	ctx.restore();
}

function renderStrokes(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const eid = entity.id();
	const strokes = store(world, Cache).strokes[eid];
	if (!strokes) return;

	const computed = store(world, Computed);
	const blendMode = store(world, BlendMode);
	const paintStore = store(world, Paint);

	for (const stroke of strokes) {
		if (stroke.has(Hidden)) continue;
		const sid = stroke.id();
		const savedAlpha = ctx.globalAlpha;
		const savedCO = ctx.globalCompositeOperation;
		const bi = blendMode.value[sid] ?? 0;

		if (bi !== 0) {
			ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;
		}

		applyStrokeStyle(ctx, world, stroke);
		ctx.globalAlpha = savedAlpha * computed.opacity[sid]!;

		const paintType = paintStore.value[sid];
		if (paintType === PaintType.LINEAR_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createLinearGradient(world, stroke, ctx, w, h);
		} else if (paintType === PaintType.RADIAL_GRADIENT) {
			const w = computed.width[eid]!;
			const h = computed.height[eid]!;
			ctx.strokeStyle = createRadialGradient(world, stroke, ctx, w, h);
		} else {
			ctx.strokeStyle = colorToHex(computed.color[sid]!);
		}
		ctx.stroke();

		ctx.globalCompositeOperation = savedCO;
		ctx.globalAlpha = savedAlpha;
	}
}

/**
 * The pulse a node waiting on a generation is filled with
 */
function renderGenerating(world: World, entity: Entity): void {
	const errored = getSourceFailure(entity) !== undefined;
	if (!errored && !isGenerating(entity)) return;

	const ctx = getCtx(world);
	ctx.fillStyle = errored ? FAILED_COLOR : getGeneratingColor(world);
	ctx.fill();
}

// ── WAVEFORM paint ─────────────────────────────────────
//
// Renders an audio asset's pre-computed peaks as a bar chart inside the
// parent geometry's bounds. Sourced from the paint's own AssetId — the paint
// carries its asset reference, exactly like IMAGE and VIDEO paints.

const WAVEFORM_BAR_WIDTH = 6;
const WAVEFORM_BAR_GAP = 6;
const WAVEFORM_BAR_RADIUS = WAVEFORM_BAR_WIDTH / 2;
const WAVEFORM_MIN_BAR_HEIGHT = 4;
const WAVEFORM_PADDING = 12;
const WAVEFORM_BG_COLOR = '#202020';
const WAVEFORM_BG_RADIUS = 12;

function renderWaveform(world: World, entity: Entity, fill: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const peaks = resolveWaveformPeaks(world, fill);
	if (!peaks || peaks.length === 0) return;

	const w = computed.width[entity.id()]!;
	const h = computed.height[entity.id()]!;

	ctx.save();
	ctx.clip();

	// Background
	ctx.fillStyle = WAVEFORM_BG_COLOR;
	ctx.beginPath();
	ctx.roundRect(0, 0, w, h, WAVEFORM_BG_RADIUS);
	ctx.fill();

	// Bars
	const step = WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP;
	const availableWidth = w - WAVEFORM_PADDING * 2;
	const barCount = Math.floor(availableWidth / step);
	const maxBarHeight = h - WAVEFORM_PADDING * 2;
	if (barCount <= 0 || maxBarHeight <= 0) {
		ctx.restore();
		return;
	}

	const startX = WAVEFORM_PADDING + (availableWidth - barCount * step + WAVEFORM_BAR_GAP) / 2;

	ctx.fillStyle = '#ffffff';

	for (let i = 0; i < barCount; i++) {
		const peakIndex = Math.floor((i / barCount) * peaks.length);
		const value = (peaks[peakIndex] ?? 0) / 255;
		const barHeight = Math.max(value * maxBarHeight, WAVEFORM_MIN_BAR_HEIGHT);
		const x = startX + i * step;
		const y = (h - barHeight) / 2;

		ctx.beginPath();
		ctx.roundRect(x, y, WAVEFORM_BAR_WIDTH, barHeight, WAVEFORM_BAR_RADIUS);
		ctx.fill();
	}

	ctx.restore();
}

function renderShapeNode(world: World, entity: Entity): void {
	drawRectPath(world, entity);
	renderShadows(world, entity);
	renderIntrinsicFill(world, entity);
	renderFills(world, entity);
	renderGenerating(world, entity);
	renderStrokes(world, entity);
}

function renderTextNode(world: World, entity: Entity): void {
	renderText(world, entity);
}

function renderCaptionNode(world: World, entity: Entity): void {
	resolveCaptionDecoder(world, entity)?.draw(world, entity);
}

// ── Transition rendering ─────────────────────────────────────

function renderTransition(world: World, scene: Entity, left: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);

	const currentTime = computed.localTime[scene.id()]!;

	const right = getTransitionPartner(world, left);
	if (!right) return;

	const win = getTransitionWindow(world, left, right);

	if (currentTime < win.start || currentTime >= win.end) return;

	// we are transitioning
	const duration = win.end - win.start;
	const completion = (currentTime - win.start) / duration;

	const settings = transitionSettings(world, Transition, left);
	const { type } = settings;

	const parent = getParentNode(left);
	if (parent === null) return;
	const width = computed.width[parent.id()]!;
	const height = computed.height[parent.id()]!;

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT:
		case TransitionType.SLIDE_FROM_LEFT: {
			// The next shot comes in over the first, slowing as it lands.
			const p = settings.ease(completion, (t) => 1 - (1 - t) ** 2);
			const [ux, uy] = transitionDirection(settings.direction, type === TransitionType.SLIDE_FROM_RIGHT ? 'left' : 'right');
			renderNode(world, left);
			ctx.save();
			ctx.translate((-ux * (1 - p) * width) | 0, (-uy * (1 - p) * height) | 0);
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.FADE_TO_BLACK:
		case TransitionType.FADE_TO_WHITE: {
			const p = settings.ease(completion, linear);
			renderNode(world, p < 0.5 ? left : right);
			ctx.save();
			ctx.beginPath();
			ctx.rect(0, 0, width, height);
			ctx.closePath();
			ctx.fillStyle = settings.color(type === TransitionType.FADE_TO_BLACK ? '#000000' : '#FFFFFF');
			ctx.globalAlpha = p < 0.5 ? 2 * p : 2 * (1 - p);
			ctx.fill();
			ctx.restore();
			break;
		}
		case TransitionType.PUSH_LEFT:
		case TransitionType.PUSH_UP:
		case TransitionType.ZOOM_IN:
		case TransitionType.ZOOM_OUT:
		case TransitionType.CROSS_ZOOM:
		case TransitionType.SPIN:
		case TransitionType.WHIP:
		case TransitionType.FLASH:
		case TransitionType.BLUR:
		case TransitionType.WIPE:
		case TransitionType.IRIS: {
			renderMotionTransition(world, settings, left, right, completion);
			break;
		}
		default: {
			// Dissolve (default)
			renderNode(world, left);
			ctx.save();
			ctx.globalAlpha = settings.ease(completion, linear);
			renderNode(world, right);
			ctx.restore();
			break;
		}
	}

	// Mark both partners as already drawn this frame so the parent's
	// children loop skips its plain renderNode pass for them.
	computed.visibility[left.id()] = 0;
	computed.visibility[right.id()] = 0;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * The box two clips share in their parent's space: the union of their own
 * boxes, through each one's local transform. What a transition moves, wipes
 * and zooms about, so a clip that is not at the parent's origin still turns
 * about its own middle.
 */
function transitionBox(world: World, ...clips: Entity[]): Box {
	const computed = store(world, Computed);
	const local = store(world, LocalTransform);
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const clip of clips) {
		const id = clip.id();
		const w = computed.width[id] ?? 0;
		const h = computed.height[id] ?? 0;
		const a = local.a[id] ?? 1, b = local.b[id] ?? 0, c = local.c[id] ?? 0;
		const d = local.d[id] ?? 1, e = local.e[id] ?? 0, f = local.f[id] ?? 0;
		for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
			const x = a * px + c * py + e;
			const y = b * px + d * py + f;
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}
	if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const linear = (t: number) => t;

const EASINGS: Record<TransitionEasing, ((t: number) => number) | null> = {
	[TransitionEasing.AUTO]: null,
	[TransitionEasing.LINEAR]: linear,
	[TransitionEasing.EASE_IN]: easeInCubic,
	[TransitionEasing.EASE_OUT]: easeOutCubic,
	[TransitionEasing.EASE_IN_OUT]: easeInOutCubic,
};

type Way = 'left' | 'right' | 'up' | 'down';

const WAYS: Record<Way, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

const DIRECTIONS: Record<TransitionDirection, Way | null> = {
	[TransitionDirection.AUTO]: null,
	[TransitionDirection.LEFT]: 'left',
	[TransitionDirection.RIGHT]: 'right',
	[TransitionDirection.UP]: 'up',
	[TransitionDirection.DOWN]: 'down',
};

/** The way what moves goes, as a unit vector: the one set, else the style's own. */
function transitionDirection(direction: TransitionDirection, own: Way): [number, number] {
	return WAYS[DIRECTIONS[direction] ?? own];
}

type TransitionSettings = {
	type: TransitionType;
	direction: TransitionDirection;
	/**
	 * How far along `t` (0 → 1) is: through the style's own curve, or with
	 * an easing set, through that instead, so Linear really is linear.
	 */
	ease: (t: number, own: (t: number) => number) => number;
	/** The colour a fade or flash goes through: the one set, else the style's own. */
	color: (own: string) => string;
};

function transitionSettings(world: World, trait: typeof Transition | typeof TransitionIn, clip: Entity): TransitionSettings {
	const traits = store(world, trait);
	const id = clip.id();
	const set = EASINGS[(traits.easing[id] ?? TransitionEasing.AUTO) as TransitionEasing] ?? null;
	const color = traits.color[id] ?? -1;
	return {
		type: traits.type[id] ?? TransitionType.DISSOLVE,
		direction: traits.direction[id] ?? TransitionDirection.AUTO,
		ease: (t, own) => (set ?? own)(clamp01(t)),
		color: (own) => (color >= 0 ? colorToHex(color) : own),
	};
}

/**
 * The part of `box` a wipe going `way` shows, `fraction` of it: from the
 * side it sets off from, or with `leading`, at the side it heads for.
 */
function wipeRect(ctx: Ctx2D, box: Box, [ux, uy]: [number, number], fraction: number, leading: boolean): void {
	const w = ux ? box.width * fraction : box.width;
	const h = uy ? box.height * fraction : box.height;
	// Anchored at the far edge when it heads that way and leads, or sets off from it.
	const far = (u: number) => (u > 0) === leading;
	const x = ux && far(ux) ? box.x + box.width - w : box.x;
	const y = uy && far(uy) ? box.y + box.height - h : box.y;
	ctx.rect(x, y, w, h);
}

/**
 * Adds a blur of `pixels` (in the parent's units) to whatever filter the
 * context already has. A canvas filter's lengths ignore the transform, so
 * the radius is scaled by it to look the same in a small preview as in an
 * export.
 */
function addBlur(ctx: Ctx2D, pixels: number): void {
	if (pixels < 0.25) return;
	const m = ctx.getTransform();
	const radius = pixels * Math.hypot(m.a, m.b);
	const current = ctx.filter;
	ctx.filter = current && current !== 'none' ? `${current} blur(${radius.toFixed(2)}px)` : `blur(${radius.toFixed(2)}px)`;
}

/** Draws `clip` scaled and turned about `cx`, `cy`, at `alpha`, blurred by `blur`. */
function drawPosed(
	world: World,
	clip: Entity,
	pose: { cx: number; cy: number; scale?: number; rotate?: number; dx?: number; dy?: number; alpha?: number; blur?: number },
): void {
	const ctx = getCtx(world);
	const alpha = pose.alpha ?? 1;
	if (alpha <= 0) return;
	ctx.save();
	ctx.translate(pose.cx + (pose.dx ?? 0), pose.cy + (pose.dy ?? 0));
	if (pose.rotate) ctx.rotate(pose.rotate);
	if (pose.scale !== undefined && pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
	ctx.translate(-pose.cx, -pose.cy);
	ctx.globalAlpha *= alpha;
	if (pose.blur) addBlur(ctx, pose.blur);
	renderNode(world, clip);
	ctx.restore();
}

/**
 * The transitions that move, zoom, blur, flash or cut a shape out of the two
 * clips, drawn about the box they share. `completion` runs 0 → 1 across the
 * window; each one eases it its own way.
 */
function renderMotionTransition(world: World, settings: TransitionSettings, left: Entity, right: Entity, completion: number): void {
	const ctx = getCtx(world);
	const { type } = settings;
	const box = transitionBox(world, left, right);
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	// How far along: as it plays, or along the easing set (see `TransitionSettings`).
	const p = settings.ease(completion, linear);
	const e = settings.ease(completion, easeInOutCubic);
	// How far the blurs reach: a share of the frame, so they read the same at any size.
	const blurReach = Math.max(box.width, box.height) * 0.02;

	switch (type) {
		case TransitionType.PUSH_LEFT:
		case TransitionType.PUSH_UP:
		case TransitionType.WHIP: {
			const whip = type === TransitionType.WHIP;
			const q = whip ? settings.ease(completion, easeInOutQuint) : e;
			const [ux, uy] = transitionDirection(settings.direction, type === TransitionType.PUSH_UP ? 'up' : 'left');
			const distance = ux ? box.width : box.height;
			const shift = Math.round(q * distance);
			const blur = whip ? Math.sin(Math.PI * p) * blurReach * 1.5 : 0;
			drawPosed(world, left, { cx, cy, dx: ux * shift, dy: uy * shift, blur });
			drawPosed(world, right, { cx, cy, dx: ux * (shift - distance), dy: uy * (shift - distance), blur });
			break;
		}
		case TransitionType.ZOOM_IN: {
			// The next clip settles from a little larger, so no edge shows round it.
			drawPosed(world, right, { cx, cy, scale: 1.15 - 0.15 * e, alpha: smoothstep(clamp01((p - 0.15) / 0.6)) });
			drawPosed(world, left, { cx, cy, scale: 1 + 0.6 * e, alpha: 1 - smoothstep(clamp01(p / 0.75)) });
			break;
		}
		case TransitionType.ZOOM_OUT: {
			drawPosed(world, left, { cx, cy, scale: 1 - 0.25 * e, alpha: 1 - smoothstep(clamp01((p - 0.1) / 0.65)) });
			drawPosed(world, right, { cx, cy, scale: 1.45 - 0.45 * e, alpha: smoothstep(clamp01(p / 0.7)) });
			break;
		}
		case TransitionType.CROSS_ZOOM: {
			// In on the first clip, blurring as it goes; out of the second, sharpening.
			if (p < 0.5) {
				const q = easeInCubic(p * 2);
				drawPosed(world, left, { cx, cy, scale: 1 + 1.2 * q, blur: q * blurReach * 2 });
				// A brief overlap either side of the cut, so it does not pop.
				if (p > 0.42) drawPosed(world, right, { cx, cy, scale: 2.2, blur: blurReach * 2, alpha: (p - 0.42) / 0.16 });
			} else {
				const q = easeOutCubic((p - 0.5) * 2);
				if (p < 0.58) drawPosed(world, left, { cx, cy, scale: 2.2, blur: blurReach * 2 });
				drawPosed(world, right, { cx, cy, scale: 2.2 - 1.2 * q, blur: (1 - q) * blurReach * 2, alpha: p < 0.58 ? 0.5 + (p - 0.5) / 0.16 : 1 });
			}
			break;
		}
		case TransitionType.SPIN: {
			drawPosed(world, left, { cx, cy, scale: 1 + 0.15 * e, alpha: 1 - smoothstep(clamp01((p - 0.35) / 0.5)) });
			drawPosed(world, right, { cx, cy, scale: e, rotate: (1 - e) * -Math.PI, alpha: smoothstep(clamp01(p / 0.3)) });
			break;
		}
		case TransitionType.FLASH: {
			// A cut at the middle under a flash that comes up quickly and fades slower.
			renderNode(world, p < 0.5 ? left : right);
			const alpha = p < 0.5 ? smoothstep(clamp01(p / 0.5)) : 1 - smoothstep(clamp01((p - 0.5) / 0.5));
			ctx.save();
			ctx.globalAlpha *= alpha;
			ctx.fillStyle = settings.color('#FFFFFF');
			ctx.fillRect(box.x, box.y, box.width, box.height);
			ctx.restore();
			break;
		}
		case TransitionType.BLUR: {
			drawPosed(world, left, { cx, cy, blur: e * blurReach * 2 });
			drawPosed(world, right, { cx, cy, alpha: e, blur: (1 - e) * blurReach * 2 });
			break;
		}
		case TransitionType.WIPE: {
			renderNode(world, left);
			ctx.save();
			ctx.beginPath();
			wipeRect(ctx, box, transitionDirection(settings.direction, 'right'), e, false);
			ctx.clip();
			renderNode(world, right);
			ctx.restore();
			break;
		}
		case TransitionType.IRIS: {
			renderNode(world, left);
			ctx.save();
			ctx.beginPath();
			ctx.arc(cx, cy, (e * Math.hypot(box.width, box.height)) / 2, 0, Math.PI * 2);
			ctx.clip();
			renderNode(world, right);
			ctx.restore();
			break;
		}
	}
}

/**
 * A clip playing in from its start or out to its end on its own, over
 * whatever is under it (see `getEdgeTransition`). Each style plays as its
 * half of a cut would with nothing on the other side: what moves comes in
 * from one side and leaves by the other, what fades fades through nothing.
 */
function renderEdgeTransition(world: World, parent: Entity, clip: Entity): void {
	const computed = store(world, Computed);
	if (computed.visibility[clip.id()] === 0 || clip.has(Culled) || clip.has(Hidden) || clip.has(IsMask)) return;

	const playing = getEdgeTransition(world, clip, computed.localTime[parent.id()] ?? 0);
	if (!playing) return;

	const ctx = getCtx(world);
	const settings = transitionSettings(world, playing.edge === 'in' ? TransitionIn : Transition, clip);
	const { type } = settings;
	const box = transitionBox(world, clip);
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	// How much shows: as it plays, or along the easing set (see `TransitionSettings`).
	const s = settings.ease(playing.shown, linear);
	const e = settings.ease(playing.shown, easeInOutCubic);
	// Coming in, a clip arrives from the right (or below); going out it leaves by the left (or top).
	const side = playing.edge === 'in' ? 1 : -1;
	const blurReach = Math.max(box.width, box.height) * 0.02;

	/**
	 * Where a clip that moves sits, `away` (0 → 1) of the way off: coming in
	 * it arrives going `way`, going out it leaves going `way`.
	 */
	const offset = (own: Way, away: number) => {
		const [ux, uy] = transitionDirection(settings.direction, own);
		const sign = playing.edge === 'in' ? -1 : 1;
		return { dx: Math.round(sign * ux * away * box.width), dy: Math.round(sign * uy * away * box.height) };
	};

	const fadeThrough = (color: string) => {
		// Up to the colour over the clip, then the two go together.
		ctx.save();
		ctx.globalAlpha *= clamp01(s / 0.4);
		renderNode(world, clip);
		ctx.globalAlpha *= smoothstep(clamp01((1 - s) / 0.6));
		ctx.fillStyle = color;
		ctx.fillRect(box.x, box.y, box.width, box.height);
		ctx.restore();
	};

	switch (type) {
		case TransitionType.SLIDE_FROM_RIGHT:
		case TransitionType.SLIDE_FROM_LEFT: {
			const q = settings.ease(playing.shown, (t) => 1 - (1 - t) ** 2);
			drawPosed(world, clip, { cx, cy, ...offset(type === TransitionType.SLIDE_FROM_RIGHT ? 'left' : 'right', 1 - q) });
			break;
		}
		case TransitionType.PUSH_LEFT:
			drawPosed(world, clip, { cx, cy, ...offset('left', 1 - e) });
			break;
		case TransitionType.PUSH_UP:
			drawPosed(world, clip, { cx, cy, ...offset('up', 1 - e) });
			break;
		case TransitionType.WHIP: {
			const q = settings.ease(playing.shown, easeInOutQuint);
			drawPosed(world, clip, { cx, cy, ...offset('left', 1 - q), blur: Math.sin((Math.PI * (1 - s)) / 2) * blurReach * 1.5 });
			break;
		}
		case TransitionType.FADE_TO_BLACK:
			fadeThrough(settings.color('#000000'));
			break;
		case TransitionType.FADE_TO_WHITE:
			fadeThrough(settings.color('#FFFFFF'));
			break;
		case TransitionType.ZOOM_IN:
			// Larger as it goes: settling from a little larger, or growing away.
			drawPosed(world, clip, {
				cx,
				cy,
				scale: playing.edge === 'in' ? 1.15 - 0.15 * e : 1 + 0.6 * (1 - e),
				alpha: smoothstep(clamp01(s / 0.6)),
			});
			break;
		case TransitionType.ZOOM_OUT:
			drawPosed(world, clip, { cx, cy, scale: 0.75 + 0.25 * e, alpha: smoothstep(clamp01(s / 0.6)) });
			break;
		case TransitionType.CROSS_ZOOM: {
			// How far into the zoom: easing out of it coming in, into it going out.
			const q = playing.edge === 'in' ? 1 - easeOutCubic(s) : easeInCubic(1 - s);
			drawPosed(world, clip, { cx, cy, scale: 1 + 1.2 * q, blur: q * blurReach * 2, alpha: clamp01(s / 0.3) });
			break;
		}
		case TransitionType.SPIN:
			drawPosed(world, clip, { cx, cy, scale: e, rotate: (1 - e) * -side * Math.PI, alpha: smoothstep(clamp01(s / 0.3)) });
			break;
		case TransitionType.FLASH: {
			// The clip is there for its half of the flash, which peaks as it appears or goes.
			if (s >= 0.5) renderNode(world, clip);
			ctx.save();
			ctx.globalAlpha *= s >= 0.5 ? smoothstep(clamp01((1 - s) / 0.5)) : smoothstep(clamp01(s / 0.5));
			ctx.fillStyle = settings.color('#FFFFFF');
			ctx.fillRect(box.x, box.y, box.width, box.height);
			ctx.restore();
			break;
		}
		case TransitionType.BLUR:
			drawPosed(world, clip, { cx, cy, alpha: e, blur: (1 - e) * blurReach * 2 });
			break;
		case TransitionType.WIPE: {
			// The edge travels its way across: revealing the clip, or taking it away.
			ctx.save();
			ctx.beginPath();
			wipeRect(ctx, box, transitionDirection(settings.direction, 'right'), e, playing.edge === 'out');
			ctx.clip();
			renderNode(world, clip);
			ctx.restore();
			break;
		}
		case TransitionType.IRIS: {
			ctx.save();
			ctx.beginPath();
			ctx.arc(cx, cy, (e * Math.hypot(box.width, box.height)) / 2, 0, Math.PI * 2);
			ctx.clip();
			renderNode(world, clip);
			ctx.restore();
			break;
		}
		default:
			// Dissolve
			drawPosed(world, clip, { cx, cy, alpha: s });
			break;
	}

	computed.visibility[clip.id()] = 0;
}

export function renderNode(world: World, entity: Entity): void {
	const ctx = getCtx(world);
	const computed = store(world, Computed);
	const eid = entity.id();

	if (computed.visibility[eid] === 0 || entity.has(Culled)) return;

	if (entity.has(Interactive)) {
		world.get(HitRegions)?.list.push({
			target: { kind: 'entity', id: entity },
		});
	}

	if (entity.has(IsMask) || entity.has(Hidden)) return;

	ctx.save();

	const local = store(world, LocalTransform);
	ctx.transform(
		local.a[eid]!,
		local.b[eid]!,
		local.c[eid]!,
		local.d[eid]!,
		local.e[eid]!,
		local.f[eid]!,
	);

	// WorldTransform is in full-surface device pixels; a reduced preview draws
	// everything else through a view already scaled down to match.
	const worldTransform = store(world, WorldTransform);
	const scale = getPreviewScale(world);
	for (const mask of store(world, Cache).masks[eid] ?? []) {
		if (computed.visibility[mask.id()] === 0) continue;
		ctx.save();
		ctx.setTransform(
			worldTransform.a[mask.id()]! * scale,
			worldTransform.b[mask.id()]! * scale,
			worldTransform.c[mask.id()]! * scale,
			worldTransform.d[mask.id()]! * scale,
			worldTransform.e[mask.id()]! * scale,
			worldTransform.f[mask.id()]! * scale,
		);
		drawRectPath(world, mask);
		ctx.restore();
		ctx.clip();
	}

	// Opacity and blend mode. The store slot may hold a destroyed entity's
	// value (ids are recycled), so it is only readable behind has().
	ctx.globalAlpha *= computed.opacity[eid]!;
	const bi = entity.has(BlendMode) ? store(world, BlendMode).value[eid] ?? 0 : 0;
	if (bi !== 0) ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[bi]!;

	// The node's own grade and effects, then whatever a scene or group around
	// it set: a clip's grade goes under its scene's. The restore below puts
	// the filter back with the rest of the state.
	const grade = gradeFilter(world, entity);
	const effects = buildEffects(world, entity);

	if (grade !== null || effects !== null) {
		const inherited = ctx.filter;
		ctx.filter = [grade, effects, inherited === 'none' ? null : inherited].filter(Boolean).join(' ');
	}


	// A group has no Geometry, and the slot a recycled id left behind would
	// otherwise draw it as the text or rect that last had its id (and size it
	// to that text's empty glyphs).
	const geometry = entity.has(Geometry) ? store(world, Geometry).value[eid] : undefined;
	if (entity.has(Caption)) {
		renderCaptionNode(world, entity);
	} else if (geometry === GeometryType.TEXT) {
		renderTextNode(world, entity);
	} else if (geometry === GeometryType.RECT) {
		renderShapeNode(world, entity);
	}

	// Clip and render children
	const children = store(world, Cache).children[eid] ?? [];
	if (children.length) {
		if (entity.has(ClipsContent)) {
			ctx.save();
			ctx.clip();
		}

		for (const child of children) {
			// A child playing a transition is drawn by its handler, which hides
			// it (and a partner) from the plain pass below for this frame.
			if (child.has(Transition)) renderTransition(world, entity, child);
			if (child.has(Transition) || child.has(TransitionIn)) renderEdgeTransition(world, entity, child);

			renderNode(world, child);
		}

		if (entity.has(ClipsContent)) {
			ctx.restore();
		}
	}

	ctx.restore();
}

/**
 * Render system entry point. Call after transformSystem.
 *
 * Reads camera, background, and canvas size from world state and applies
 * DPR * Camera as the base canvas transform before drawing top-level nodes.
 * Without a render surface (headless world) this is a no-op.
 */
export function renderSystem(world: World): void {
	const surface = world.get(RenderSurface);
	const ctx = surface?.ctx;
	const canvas = surface?.canvas;
	if (!ctx || !canvas) return;

	const cw = canvas.width;
	const ch = canvas.height;

	// Clear + background (identity transform for full-canvas clear)
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, cw, ch);

	// The stage background is a preview-only affordance; offline encoding
	// renders just the scene onto a transparent canvas (the scene paints its
	// own fill if it has one).
	if (world.get(Mode)?.value === 'realtime') {
		const background = world.get(Root)!.get(Background)?.value ?? 0;
		ctx.fillStyle = colorToHex(background === DEFAULT_BACKGROUND ? world.get(DefaultBackground)?.value ?? background : background);
		ctx.fillRect(0, 0, cw, ch);
		world.get(HitRegions)?.list.push({
			target: { kind: 'hud', id: 'canvas', quad: getCanvasQuad(cw, ch) },
		});
	}

	// A reduced preview draws the scene into the top-left corner at its share
	// of the size, then stretches that corner over the whole canvas. The same
	// canvas rather than a buffer, so HTML paints (which only draw onto the
	// canvas that holds them) still draw.
	const scale = getPreviewScale(world);
	const width = scale < 1 ? Math.min(cw, Math.ceil(cw * scale)) : cw;
	const height = scale < 1 ? Math.min(ch, Math.ceil(ch * scale)) : ch;

	if (scale < 1) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, width, height);
		ctx.clip();
	}

	// Apply camera transform: DPR * Camera
	const view = getViewMatrix(world);
	ctx.setTransform(view.a * scale, view.b * scale, view.c * scale, view.d * scale, view.e * scale, view.f * scale);

	// Render top-level nodes, back to front by their place in the document.
	// The query alone is no order: a node coming back into view (Culled
	// removed) rejoins it at the end, which would paint it over the rest.
	const stage = world.get(Root)!;
	for (const entity of [...world.query(Or(Geometry, Group), ChildOf(stage), Not(Culled))].sort(sortByItemIndex)) {
		renderNode(world, entity);
	}

	if (scale < 1) {
		ctx.restore();
		ctx.save();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalCompositeOperation = 'copy';
		ctx.imageSmoothingEnabled = true;
		ctx.drawImage(canvas, 0, 0, width, height, 0, 0, width / scale, height / scale);
		ctx.restore();
	}
}

function getCanvasQuad(width: number, height: number): Quad {
	return [
		{ x: 0, y: 0 },
		{ x: width, y: 0 },
		{ x: width, y: height },
		{ x: 0, y: height },
	];
}
