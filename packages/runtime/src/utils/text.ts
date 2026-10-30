/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Text layout, measurement, and canvas rendering (was engine/utils/text.ts).

import { store } from '../world/store';
import {
	COMPOSITE_OPERATIONS, PaintType, FontStyle,
	TextAlign, TextBaseline, TextCase,
} from '../constants';
import {
	Size, Hidden, Paint, Color, Blur, Offset, Opacity, BlendMode,
	Chars, TextStyle, TextRange, TextCache, Cache, Computed, Camera,
	RenderSurface, Root, WordTiming,
} from '../traits';
import { buildEffects } from './effects';
import { getPreviewScale } from '../queries/camera';
import { clamp } from '../math/common';
import { colorToHex } from './color';
import { applyStrokeStyle, findWidestStroke } from './stroke';
import { createLinearGradient, createRadialGradient } from '../systems/gradients';

import type { Entity, World } from 'koota';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type TokenOptions = {
	/**
	 * Defines the characters to render
	 */
	chars: string;
	/**
	 * Defines the X offset of the token to the left of the line
	 */
	offset: number;
	/**
	 * Defines the metrics of the token
	 */
	metrics: TextMetrics;
	/**
	 * Defines the style of the token (TextRange sub-entities)
	 */
	ranges: Entity[];
}

export type Line = {
	offsetX: number;
	offsetY: number;
	baseline: number;
	height: number;
};

type RenderSplit = {
	words: string[];
	ranges: Entity[];
};

/** Global offscreen canvas used solely for text measurement. */
let measureCanvas: OffscreenCanvas | null = null;
let measureCtx: OffscreenCanvasRenderingContext2D | null = null;

function getMeasureCtx(): OffscreenCanvasRenderingContext2D {
	if (!measureCtx) {
		measureCanvas = new OffscreenCanvas(1, 1);
		measureCtx = measureCanvas.getContext('2d', { willReadFrequently: true, alpha: true })!;
	}
	return measureCtx;
}

export class Token {
	public offset: number;
	public metrics: TextMetrics;
	public ranges: Entity[];
	public chars: string;
	public width: number;
	public height: number;
	public line = { offsetX: 0, offsetY: 0, baseline: 0, height: 0 };

	constructor(options: TokenOptions) {
		this.offset = options.offset;
		this.metrics = options.metrics;
		this.ranges = options.ranges;
		this.width = options.metrics.width;
		this.height = options.metrics.fontBoundingBoxAscent + options.metrics.fontBoundingBoxDescent;
		this.chars = options.chars;
	}

	public get x(): number {
		return (this.offset + this.line.offsetX) | 0;
	}

	public get y(): number {
		return (this.line.offsetY + this.line.baseline) | 0;
	}

	public get left(): number {
		return (
			this.offset +
			this.line.offsetX -
			this.metrics.actualBoundingBoxLeft
		) | 0;
	}

	public get right(): number {
		return (
			this.offset +
			this.line.offsetX +
			this.metrics.actualBoundingBoxRight
		) | 0;
	}

	public get top(): number {
		return (
			this.line.offsetY +
			this.line.baseline -
			this.metrics.actualBoundingBoxAscent
		) | 0
	}

	public get bottom(): number {
		return (
			this.line.offsetY +
			this.line.baseline +
			this.metrics.actualBoundingBoxDescent
		) | 0
	}

	public setLine(line: Line) {
		this.line = { ...line };
	}
}

function applyFont(ctx: Ctx, world: World, entity: Entity, ranges: Entity[]) {
	const size = getFontSize(world, entity, ranges);
	const family = getFontFamily(world, entity, ranges);
	const weight = getFontWeight(world, entity, ranges);
	const style = getFontStyle(world, entity, ranges);
	const baseline = getTextBaseline(world, entity, ranges);
	const spacing = getLetterSpacing(world, entity, ranges);

	const mappedStyle = FontStyle[style]!.toLowerCase();
	const mappedBaseline = TextBaseline[baseline]!.toLowerCase() as CanvasTextBaseline;

	ctx.font = `${mappedStyle} ${weight.toLowerCase()} ${size}px ${family}`.trim();
	ctx.textBaseline = mappedBaseline;
	ctx.letterSpacing = `${spacing}px`;
}

function shapeTokens(world: World, entity: Entity): void {
	const computed = store(world, Computed);
	const textStyle = store(world, TextStyle);
	const eid = entity.id();
	const lines = store(world, TextCache).tokens[eid];
	const leading = textStyle.leading[eid] ?? 1;
	const textAlign = textStyle.textAlign[eid] ?? TextAlign.LEFT;
	const textBaseline = textStyle.textBaseline[eid] ?? TextBaseline.TOP;
	if (!lines) return;

	// Measure each line's width by summing word widths and spaces
	const lineWidths: number[] = lines.map(line => line.reduce((acc, word) => acc + word.width, 0));
	const lineHeights: number[] = lines.map(line => Math.max(...line.map(word => word.height)));

	// Find the maximum line width
	const maxLineWidth = Math.max(...lineWidths);

	// Calculate total height based on leading
	const totalHeight = lineHeights.reduce((acc, height, i) => acc + height * (i < lineHeights.length - 1 ? leading : 1), 0);

	// When Size is assigned, use Computed for positioning; otherwise set it from text dimensions
	if (!entity.has(Size) || !computed.width[eid] || !computed.height[eid]) {
		computed.width[eid] = Math.ceil(maxLineWidth);
		computed.height[eid] = Math.ceil(totalHeight);
	}

	const containerWidth = computed.width[eid]!;
	const containerHeight = computed.height[eid]!;

	// Calculate initial vertical offset based on text baseline and container height
	let offsetY = 0;
	if (textBaseline === TextBaseline.MIDDLE) {
		offsetY = (containerHeight - totalHeight) / 2;
	} else if (textBaseline === TextBaseline.BOTTOM) {
		offsetY = containerHeight - totalHeight;
	}

	// Calculate coordinates for each word
	const line = {
		offsetX: 0,
		offsetY,
		baseline: 0,
		height: 0,
	};

	for (let l = 0; l < lines.length; l++) {
		line.height = lineHeights[l]!;

		if (textAlign === TextAlign.LEFT) {
			line.offsetX = 0;
		} else if (textAlign === TextAlign.CENTER) {
			line.offsetX = (containerWidth - lineWidths[l]!) / 2;
		} else if (textAlign === TextAlign.RIGHT) {
			line.offsetX = containerWidth - lineWidths[l]!;
		}

		if (textBaseline === TextBaseline.TOP) {
			line.baseline = 0;
		} else if (textBaseline === TextBaseline.MIDDLE) {
			line.baseline = lineHeights[l]! / 2;
		} else if (textBaseline === TextBaseline.BOTTOM) {
			line.baseline = lineHeights[l]!;
		} else if (textBaseline === TextBaseline.ALPHABETIC) {
			const maxAscent = Math.max(...lines[l]!.map(word => word.metrics.fontBoundingBoxAscent));
			line.baseline = maxAscent || lineHeights[l]! * 0.75; // Fallback if no words in line
		}

		for (const word of lines[l]!) {
			word.setLine(line);
		}

		line.offsetY += lineHeights[l]! * leading;
	}
}

function tokenizeText(world: World, entity: Entity) {
	const ctx = getMeasureCtx();

	// Split text into segments based on style overrides first
	const lines: Token[][] = [[]];

	const maxWidth = store(world, Size).width[entity.id()] ?? Number.POSITIVE_INFINITY;

	let offset = 0;
	for (const { words, ranges } of createRenderSplits(world, entity)) {
		applyFont(ctx, world, entity, ranges);

		for (const word of words) {
			const splits = word.split('\n');

			for (let i = 0; i < splits.length; i++) {
				const caseValue = getTextCase(world, entity, ranges);
				const chars = transformText(splits[i]!, caseValue);

				const metrics = ctx.measureText(chars);

				// check if word is too wide for the current line but not the first word
				if (offset + metrics.width > maxWidth && offset > 0) {
					lines.push([]);
					offset = 0;
				}

				// add word to current line
				lines[lines.length - 1]!.push(new Token({ chars, ranges, metrics, offset }));
				offset += metrics.width;

				// add new line if not the last line
				if (i < splits.length - 1) {
					lines.push([]);
					offset = 0;
				}
			}
		}
	}

	if (!entity.has(TextCache)) entity.add(TextCache);
	store(world, TextCache).tokens[entity.id()] = lines;
}

/** Renders text tokens directly to the given canvas context. */
function renderTokens(ctx: Ctx, world: World, entity: Entity): void {
	const eid = entity.id();
	const lines = store(world, TextCache).tokens[eid];
	if (!lines) return;
	const words = lines.flat();

	const computed = store(world, Computed);
	const offsetStore = store(world, Offset);
	const blurStore = store(world, Blur);
	const colorStore = store(world, Color);
	const opacityStore = store(world, Opacity);
	const blendStore = store(world, BlendMode);
	const paintStore = store(world, Paint);

	const savedAlpha = ctx.globalAlpha;
	const poses = new Map<Token, WordPose | null>();
	for (const word of words) poses.set(word, getWordPose(world, word.ranges));

	// Draw all text shadows
	{
		ctx.save();
		ctx.textAlign = 'start';
		ctx.textBaseline = 'top';

		// ctx.shadowBlur/OffsetX/OffsetY are in device-pixel space and are not
		// affected by the current transform, so scale them up to match the
		// content transform (camera * resolution).
		const camera = world.get(Root)!.get(Camera);
		const resolution = (world.get(RenderSurface)?.resolution ?? 1) * getPreviewScale(world);
		const shadowScale = (camera?.a ?? 1) * resolution;

		for (const word of words) {
			applyFont(ctx, world, entity, word.ranges);

			const shadows = getShadows(world, entity, word.ranges);

			// A stroked word's shadow is the widest stroke's silhouette.
			const widest = findWidestStroke(world, getStrokes(world, entity, word.ranges));
			if (widest !== null) {
				applyStrokeStyle(ctx, world, widest);
			}

			// Draw shadows first (if any)
			for (const shadow of shadows) {
				if (shadow.has(Hidden)) continue;
				const sid = shadow.id();

				// Recycled-id safety: optional traits only behind has().
				const hasOffset = shadow.has(Offset);
				ctx.shadowOffsetX = (hasOffset ? offsetStore.x[sid] ?? 0 : 0) * shadowScale;
				ctx.shadowOffsetY = (hasOffset ? offsetStore.y[sid] ?? 0 : 0) * shadowScale;
				ctx.shadowBlur = (shadow.has(Blur) ? blurStore.value[sid] ?? 0 : 0) * shadowScale;
				ctx.shadowColor = colorToHex(colorStore.value[sid] ?? 0x000000);
				ctx.fillStyle = colorToHex(colorStore.value[sid] ?? 0x000000);
				ctx.globalAlpha = savedAlpha * (shadow.has(Opacity) ? opacityStore.value[sid] ?? 1 : 1);

				if (widest !== null) {
					drawWord(ctx, word, poses.get(word), () => ctx.strokeText(word.chars, word.x, word.y));
				} else {
					drawWord(ctx, word, poses.get(word), () => ctx.fillText(word.chars, word.x, word.y));
				}
			}

			// Reset shadow properties if any shadows are applied
			if (shadows.length) {
				ctx.globalAlpha = savedAlpha;
				ctx.shadowColor = 'transparent';
			}
		}
		ctx.restore();
	}

	// Draw all text strokes
	{
		ctx.save();
		ctx.textAlign = 'start';
		ctx.textBaseline = 'top';

		for (const word of words) {
			const strokes = getStrokes(world, entity, word.ranges);
			if (!strokes.length) continue;

			applyFont(ctx, world, entity, word.ranges);

			const w = computed.width[eid]!;
			const h = computed.height[eid]!;

			// Draw strokes (if any)
			for (const stroke of strokes) {
				if (stroke.has(Hidden)) continue;
				const sid = stroke.id();

				// Recycled-id safety: optional traits only behind has().
				const savedCO = ctx.globalCompositeOperation;
				const blendMode = stroke.has(BlendMode) ? blendStore.value[sid] ?? 0 : 0;
				if (blendMode !== 0) {
					ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[blendMode]!;
				}
				ctx.globalAlpha = savedAlpha * (stroke.has(Opacity) ? opacityStore.value[sid] ?? 1 : 1);
				applyStrokeStyle(ctx, world, stroke);

				const paintType = paintStore.value[sid];
				if (paintType === PaintType.LINEAR_GRADIENT) {
					ctx.strokeStyle = createLinearGradient(world, stroke, ctx, w, h);
				} else if (paintType === PaintType.RADIAL_GRADIENT) {
					ctx.strokeStyle = createRadialGradient(world, stroke, ctx, w, h);
				} else {
					ctx.strokeStyle = colorToHex(colorStore.value[sid] ?? 0x000000);
				}
				drawWord(ctx, word, poses.get(word), () => ctx.strokeText(word.chars, word.x, word.y));
				ctx.globalCompositeOperation = savedCO;
			}
		}
		ctx.restore();
	}

	// Draw all text fills
	{
		ctx.save();
		ctx.textAlign = 'start';
		ctx.textBaseline = 'top';

		for (const word of words) {
			// The geometry's own Color is an intrinsic solid fill beneath every
			// paint; a range carrying a Color replaces it over the glyphs it spans.
			const intrinsicFill = getIntrinsicColor(world, entity, word.ranges);
			const fills = getFills(world, entity, word.ranges);
			if (!fills.length && intrinsicFill === null) continue;

			applyFont(ctx, world, entity, word.ranges);

			const w = computed.width[eid]!;
			const h = computed.height[eid]!;

			if (intrinsicFill !== null) {
				ctx.globalAlpha = savedAlpha;
				ctx.fillStyle = intrinsicFill;
				drawWord(ctx, word, poses.get(word), () => ctx.fillText(word.chars, word.x, word.y));
			}

			for (const fill of fills) {
				if (fill.has(Hidden)) continue;
				const fid = fill.id();

				// Store slots outlive destroyed entities and ids are recycled,
				// so an optional trait's slot is only readable behind has().
				const savedCO = ctx.globalCompositeOperation;
				const blendMode = fill.has(BlendMode) ? blendStore.value[fid] ?? 0 : 0;
				if (blendMode !== 0) {
					ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[blendMode]!;
				}
				ctx.globalAlpha = savedAlpha * (fill.has(Opacity) ? opacityStore.value[fid] ?? 1 : 1);

				const paintType = paintStore.value[fid];
				if (paintType === PaintType.LINEAR_GRADIENT) {
					ctx.fillStyle = createLinearGradient(world, fill, ctx, w, h);
				} else if (paintType === PaintType.RADIAL_GRADIENT) {
					ctx.fillStyle = createRadialGradient(world, fill, ctx, w, h);
				} else {
					ctx.fillStyle = colorToHex(colorStore.value[fid] ?? 0x000000);
				}
				drawWord(ctx, word, poses.get(word), () => ctx.fillText(word.chars, word.x, word.y));
				ctx.globalCompositeOperation = savedCO;
			}
		}
		ctx.restore();
	}
}

/** How a caption word with a look of its own is placed and composited. */
type WordPose = {
	hidden: boolean;
	opacity: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	offsetX: number;
	offsetY: number;
	blend: number;
	filter: string | null;
};

/**
 * The pose of the last word range among `ranges` (see `WordTiming`), which
 * `animateCaptionWords` writes into its Computed; null for any other token.
 */
function getWordPose(world: World, ranges: Entity[]): WordPose | null {
	let range: Entity | null = null;
	for (const candidate of ranges) {
		if (candidate.has(WordTiming)) range = candidate;
	}
	if (!range) return null;

	const computed = store(world, Computed);
	const rid = range.id();
	return {
		hidden: range.has(Hidden),
		opacity: computed.opacity[rid] ?? 1,
		scaleX: computed.scaleX[rid] ?? 1,
		scaleY: computed.scaleY[rid] ?? 1,
		rotation: computed.rotation[rid] ?? 0,
		offsetX: computed.offsetX[rid] ?? 0,
		offsetY: computed.offsetY[rid] ?? 0,
		blend: range.has(BlendMode) ? store(world, BlendMode).value[rid] ?? 0 : 0,
		filter: buildEffects(world, range),
	};
}

/**
 * Runs `draw` for one token, in its word's pose: moved, turned and scaled
 * about the word's own center, and faded, blended and filtered on top of
 * whatever the pass set.
 */
function drawWord(ctx: Ctx, word: Token, pose: WordPose | null | undefined, draw: () => void): void {
	if (!pose) {
		draw();
		return;
	}
	if (pose.hidden || pose.opacity <= 0) return;

	ctx.save();
	if (pose.offsetX !== 0 || pose.offsetY !== 0 || pose.rotation !== 0 || pose.scaleX !== 1 || pose.scaleY !== 1) {
		const cx = word.x + word.width / 2;
		const cy = word.y + word.height / 2;
		ctx.translate(cx + pose.offsetX, cy + pose.offsetY);
		ctx.rotate((pose.rotation * Math.PI) / 180);
		ctx.scale(pose.scaleX, pose.scaleY);
		ctx.translate(-cx, -cy);
	}
	ctx.globalAlpha *= pose.opacity;
	if (pose.blend !== 0) {
		ctx.globalCompositeOperation = COMPOSITE_OPERATIONS[pose.blend]!;
	}
	if (pose.filter) {
		const current = ctx.filter;
		ctx.filter = current && current !== 'none' ? `${current} ${pose.filter}` : pose.filter;
	}
	draw();
	ctx.restore();
}

/**
 * Something a caption draws behind its words, such as a box behind the one
 * being said: called once the words are laid out, before any glyph is drawn,
 * in the text's own coordinates.
 */
export type TextUnderlay = (ctx: Ctx, lines: readonly Token[][]) => void;

/** Render text tokens directly to the world's render surface. */
export function renderText(world: World, entity: Entity, underlay?: TextUnderlay) {
	const ctx = world.get(RenderSurface)?.ctx;
	if (!ctx) return;
	tokenizeText(world, entity);
	shapeTokens(world, entity);
	if (underlay) {
		const lines = store(world, TextCache).tokens[entity.id()];
		if (lines) {
			ctx.save();
			underlay(ctx, lines);
			ctx.restore();
		}
	}
	renderTokens(ctx, world, entity);
}

/** A run's box: the ink of its glyphs across, its line's height down. */
export type TextRunBounds = { x: number; y: number; width: number; height: number };

/**
 * Where the glyphs `range` styles were laid out, from the lines an underlay is
 * handed: the left edge of the first to the right edge of the last, over the
 * height of the line they sit on. Null when the range drew nothing.
 */
export function textRangeBounds(lines: readonly Token[][], range: Entity): TextRunBounds | null {
	let bounds: TextRunBounds | null = null;
	for (const line of lines) {
		for (const token of line) {
			if (!token.ranges.includes(range) || !token.chars.trim()) continue;
			const left = token.left;
			const right = token.right;
			if (!bounds) {
				bounds = { x: left, y: token.line.offsetY, width: right - left, height: token.line.height };
				continue;
			}
			const minX = Math.min(bounds.x, left);
			bounds.width = Math.max(bounds.x + bounds.width, right) - minX;
			bounds.x = minX;
		}
	}
	return bounds;
}

/**
 * One laid-out line as a caret sees it, in the text's own coordinates: the
 * characters `start`..`end` of what was laid out, and `stops[i]`, the x a
 * caret stands at before character `start + i` (so one more stop than there
 * are characters). A line break between two lines is between their `end` and
 * the next `start`; a line the width wrapped has none.
 */
export type CaretLine = { start: number; end: number; top: number; height: number; stops: number[] };

/**
 * Where a caret can stand in `entity`'s text as it was last drawn, measured in
 * the fonts each run was drawn in. Empty until the text has been drawn once.
 */
export function textCaretLines(world: World, entity: Entity): CaretLine[] {
	const lines = store(world, TextCache).tokens[entity.id()];
	if (!lines) return [];

	const ctx = getMeasureCtx();
	const chars = store(world, Computed).chars[entity.id()] ?? store(world, Chars).value[entity.id()] ?? '';
	const result: CaretLine[] = [];
	let index = 0;
	let top = 0;

	for (const line of lines) {
		const first = line[0];
		const height = first ? Math.max(...line.map((token) => token.height)) : getFontSize(world, entity, []);
		top = first ? first.line.offsetY : top;
		const stops = [first ? first.line.offsetX + first.offset : 0];
		const start = index;

		for (const token of line) {
			applyFont(ctx, world, entity, token.ranges);
			const left = token.line.offsetX + token.offset;
			for (let k = 1; k <= token.chars.length; k++) {
				stops.push(left + ctx.measureText(token.chars.slice(0, k)).width);
			}
			index += token.chars.length;
		}

		result.push({ start, end: index, top, height, stops });
		if (chars[index] === '\n') index++;
		top += height;
	}

	return result;
}

/**
 * Splits text into segments based on overlapping text range entities.
 * Handles overlapping ranges by merging them.
 * @returns Array of RenderSplit objects with words and contributing ranges
 */
function createRenderSplits(world: World, entity: Entity): RenderSplit[] {
	const eid = entity.id();
	const chars = store(world, Computed).chars[eid] ?? store(world, Chars).value[eid] ?? '';

	const textRanges = store(world, Cache).textRanges[eid] ?? [];

	// Fast path: no styles
	if (textRanges.length === 0) {
		return [{
			words: tokenize(chars),
			ranges: [],
		}];
	}

	// Fast path: empty text
	if (chars.length === 0) {
		return [{
			words: [],
			ranges: [],
		}];
	}

	const rangeStore = store(world, TextRange);

	// Collect all unique boundary points
	const boundaries = new Set<number>();
	boundaries.add(0);
	boundaries.add(chars.length);

	for (const range of textRanges) {
		let start = rangeStore.start[range.id()] ?? 0;
		let end = rangeStore.end[range.id()] ?? chars.length;

		// Clamp boundaries to valid text range
		start = clamp(start, 0, chars.length);
		end = clamp(end, 0, chars.length);

		boundaries.add(start);
		boundaries.add(end);
	}

	// Sort boundaries in ascending order
	const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

	// Create segments between each pair of boundaries
	const segments: RenderSplit[] = [];

	for (let i = 0; i < sortedBoundaries.length - 1; i++) {
		const segStart = sortedBoundaries[i]!;
		const segEnd = sortedBoundaries[i + 1]!;

		// Skip empty segments
		if (segStart >= segEnd) continue;

		// Find all active styles for this segment
		const ranges: Entity[] = [];

		for (const range of textRanges) {
			let start = rangeStore.start[range.id()] ?? 0;
			let end = rangeStore.end[range.id()] ?? chars.length;

			// Clamp boundaries to valid text range
			start = clamp(start, 0, chars.length);
			end = clamp(end, 0, chars.length);

			// A style is active if segment falls within its range [start, end)
			// Using < for end to treat ranges as [start, end)
			if (start <= segStart && end > segStart) {
				ranges.push(range);
			}
		}

		segments.push({
			words: tokenize(chars.slice(segStart, segEnd)),
			ranges: ranges,
		});
	}

	return segments;
}

function tokenize(input: string): string[] {
	// Fast path for inputs without spaces
	if (input.indexOf(' ') === -1) {
		return [input];
	}

	// Use regex to match:
	// 1. Any characters up to and including a space
	// 2. OR any remaining characters to the end
	return input.match(/[^]*? |[^]+$/g) || [input];
}

export function transformText(text: string, textCase?: number): string {
	if (textCase == TextCase.LOWER) {
		return text.toLocaleLowerCase();
	}

	if (textCase == TextCase.UPPER) {
		return text.toUpperCase();
	}

	return text;
}

/**
 * The intrinsic glyph color for a run: the last of `ranges` carrying a Color
 * wins over the text's own, as a hex string; null when neither has one.
 */
function getIntrinsicColor(world: World, entity: Entity, ranges: Entity[]): string | null {
	const computed = store(world, Computed);
	let value: number | undefined = entity.has(Color) ? computed.color[entity.id()] ?? 0 : undefined;

	for (const range of ranges) {
		if (range.has(Color)) {
			value = computed.color[range.id()] ?? store(world, Color).value[range.id()] ?? 0;
		}
	}

	return value === undefined ? null : colorToHex(value);
}

function getFills(world: World, entity: Entity, ranges: Entity[]): Entity[] {
	const cache = store(world, Cache);
	let value = cache.fills[entity.id()] ?? [];

	for (const range of ranges) {
		const rangeValue = cache.fills[range.id()];
		if (rangeValue?.length) {
			value = rangeValue;
		}
	}

	return value;
}

function getStrokes(world: World, entity: Entity, ranges: Entity[]): Entity[] {
	const cache = store(world, Cache);
	let value = cache.strokes[entity.id()] ?? [];

	for (const range of ranges) {
		const rangeValue = cache.strokes[range.id()];
		if (rangeValue?.length) {
			value = rangeValue;
		}
	}

	return value;
}

function getShadows(world: World, entity: Entity, ranges: Entity[]): Entity[] {
	const cache = store(world, Cache);
	let value = cache.shadows[entity.id()] ?? [];

	for (const range of ranges) {
		const rangeValue = cache.shadows[range.id()];
		if (rangeValue?.length) {
			value = rangeValue;
		}
	}

	return value;
}

function getTextCase(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.textCase[entity.id()] ?? 0;

	for (const range of ranges) {
		const rangeValue = textStyle.textCase[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontSize(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontSize[entity.id()] ?? 16;

	for (const range of ranges) {
		const rangeValue = textStyle.fontSize[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontFamily(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontFamily[entity.id()] || 'Inter';

	for (const range of ranges) {
		const rangeValue = textStyle.fontFamily[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontWeight(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontWeight[entity.id()] ?? '400';

	for (const range of ranges) {
		const rangeValue = textStyle.fontWeight[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getFontStyle(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.fontStyle[entity.id()] ?? FontStyle.NORMAL;

	for (const range of ranges) {
		const rangeValue = textStyle.fontStyle[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getTextBaseline(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.textBaseline[entity.id()] ?? TextBaseline.TOP;

	for (const range of ranges) {
		const rangeValue = textStyle.textBaseline[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}

function getLetterSpacing(world: World, entity: Entity, ranges: Entity[]) {
	const textStyle = store(world, TextStyle);
	let value = textStyle.letterSpacing[entity.id()] ?? 0;

	for (const range of ranges) {
		const rangeValue = textStyle.letterSpacing[range.id()];
		if (rangeValue !== undefined) {
			value = rangeValue;
		}
	}

	return value;
}
