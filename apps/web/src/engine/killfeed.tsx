/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Animation, ImagePaint, Rect, authoredElement } from '@plan.video/reconciler';
import { Computed, FrameRate, getActiveEntity, getEntityChildren, getNextName, isScene, Library, Source, store } from '@plan.video/runtime';

import { barGame } from '@/lib/bar-killfeed-assets';
import { barKillfeedFileName, renderBarKillfeed, usualBarSpec, type BarSpec } from '@/lib/bar-killfeed';
import { CS2_ENTRY_HEIGHT, CS2_TOP, cs2KillfeedFileName, renderCs2Killfeed, USUAL_CS2_KILLFEED, type Cs2KillfeedSpec } from '@/lib/cs2-killfeed';
import { t } from '@/lib/i18n';
import { KILLFEED_HEIGHT, KILLFEED_SECONDS, killfeedFileName, renderKillfeed, USUAL_KILLFEED, type KillfeedSpec } from '@/lib/killfeed';
import { drawEvenFeed } from '@/lib/killfeed-feed';

import { importFiles } from './asset-actions';
import { KILLFEED_FOLDER, killfeedUnit, PICTURE_SCALE } from './killfeed-picture';
import { getDocumentEditor } from './editor';

import type { Entity, World } from 'koota';

export const KILLFEED_NAME = 'Killfeed';

/** Height of an entry, at unit 1. */
const ENTRY_HEIGHT = 64;
/** Space kept to the frame's edges and between stacked entries, at unit 1. */
const MARGIN = 40;
const TOP = 240;
const STACK_GAP = 8;

/** How a new entry sits with the ones already up. `bottomLeft` is the Call of Duty feed. */
export type KillfeedLayout = "stacked" | "valorant" | "bottomLeft";

/** How a new entry comes in and leaves. */
export type KillfeedAnimation = "none" | "slide" | "fade";

export interface KillfeedPlacement {
	layout: KillfeedLayout;
	animation: KillfeedAnimation;
}

export const DEFAULT_PLACEMENT: KillfeedPlacement = {
	layout: "stacked",
	animation: "slide",
};

/**
 * What a killfeed drag carries: the feed's entries, top to bottom, how they
 * should land, and the seconds between one coming in and the next. A drag
 * from before feeds held one entry as `spec`.
 */
export interface KillfeedDrag<T = KillfeedSpec> {
	specs: T[];
	placement: KillfeedPlacement;
	spacing: number;
}

type RawDrag<T> = { spec?: T; specs?: T[]; placement?: Partial<KillfeedPlacement>; spacing?: number };

function parseDrag<T>(data: RawDrag<T>): KillfeedDrag<T> {
	return {
		specs: data.specs?.length ? data.specs : data.spec ? [data.spec] : [],
		placement: { ...DEFAULT_PLACEMENT, ...data.placement },
		spacing: Math.max(0, Number(data.spacing) || 0),
	};
}

export function parseKillfeedDrag(raw: string): KillfeedDrag {
	const data = JSON.parse(raw) as RawDrag<KillfeedSpec> | KillfeedSpec;
	if (data && typeof data === "object" && ("spec" in data || "specs" in data)) return parseDrag(data as RawDrag<KillfeedSpec>);
	return { specs: [data as KillfeedSpec], placement: DEFAULT_PLACEMENT, spacing: 0 };
}

export interface InsertKillfeedOptions {
	/** The scene to put it on; the active one by default. */
	parent?: Entity;
	/** Where its center goes, in the scene's space; top right, under the entries already up, by default. */
	center?: { x: number; y: number };
	/** How it stacks and how it moves. The panel's current choice, by default. */
	placement?: KillfeedPlacement;
	/** Height of the placed entry at unit 1. Valorant entries are 64 tall. */
	entryHeight?: number;
	/** How far below the frame's top the first entry sits, at unit 1. */
	top?: number;
	/** How far above the frame's bottom the first entry sits, at unit 1. */
	bottom?: number;
	/** Entries with this name stack together. Defaults to Killfeed. */
	stackName?: string;
	/** Seconds from one entry coming in to the next, when several go in at once; 0 puts them up together. */
	spacing?: number;
}

/** What a CS2 killfeed drag carries. */
export type Cs2KillfeedDrag = KillfeedDrag<Cs2KillfeedSpec>;

export function parseCs2KillfeedDrag(raw: string): Cs2KillfeedDrag {
	return parseDrag(JSON.parse(raw) as RawDrag<Cs2KillfeedSpec>);
}

/** What a Call of Duty, PUBG or Rust killfeed drag carries: the game too. */
export interface BarKillfeedDrag extends KillfeedDrag<BarSpec> {
	id: string;
}

export function parseBarKillfeedDrag(raw: string): BarKillfeedDrag {
	const data = JSON.parse(raw) as RawDrag<BarSpec> & { id: string };
	return { id: data.id, ...parseDrag(data) };
}

/**
 * Draws the entry, keeps the picture in the library, and puts it on the scene
 * at the playhead for as long as one stays up in game, selected. Returns null
 * when there is no scene to put it on.
 */
export async function insertKillfeed(world: World, spec: KillfeedSpec, options: InsertKillfeedOptions = {}): Promise<Entity | null> {
	return (await insertKillfeeds(world, [spec], options))[0] ?? null;
}

/**
 * A feed of entries, top to bottom: each comes in `options.spacing` seconds
 * after the one before, from the playhead, stacked the way the layout stacks
 * them, all selected and taken back by one undo. Nothing when there is no
 * scene to put them on.
 */
export async function insertKillfeeds(world: World, specs: KillfeedSpec[], options: InsertKillfeedOptions = {}): Promise<Entity[]> {
	// Valorant's entry is drawn twice the height it is placed at.
	const scale = (PICTURE_SCALE * ENTRY_HEIGHT) / KILLFEED_HEIGHT;
	const drawn = await drawEvenFeed(specs, renderKillfeed, USUAL_KILLFEED, scale, columnRatio(world, options, KILLFEED_NAME));
	return commitKillfeeds(world, drawn.map((picture, index) => ({ drawn: picture, fileName: killfeedFileName(specs[index]!) })), options);
}

/** A Call of Duty, PUBG or Rust notice, at that game's size and corner. */
export async function insertBarKillfeed(world: World, id: string, spec: BarSpec, options: InsertKillfeedOptions = {}): Promise<Entity | null> {
	return (await insertBarKillfeeds(world, id, [spec], options))[0] ?? null;
}

/** A feed of Call of Duty, PUBG or Rust notices, as `insertKillfeeds` puts them. */
export async function insertBarKillfeeds(world: World, id: string, specs: BarSpec[], options: InsertKillfeedOptions = {}): Promise<Entity[]> {
	const game = barGame(id);
	if (!game) return [];
	const draw = (spec: BarSpec, scale: number, width?: number) => renderBarKillfeed(game, spec, scale, width);
	const drawn = await drawEvenFeed(specs, draw, usualBarSpec(game), PICTURE_SCALE, columnRatio(world, options, options.stackName ?? game.stackName));
	const pictures = drawn.map((picture, index) => ({ drawn: picture, fileName: barKillfeedFileName(specs[index]!) }));
	return commitKillfeeds(world, pictures, {
		...options,
		entryHeight: options.entryHeight ?? game.entryHeight,
		top: options.top ?? game.top,
		bottom: options.bottom ?? game.bottom,
		stackName: options.stackName ?? game.stackName,
	});
}

/** A Counter-Strike 2 notice, placed like the others but at the game's size and height. */
export async function insertCs2Killfeed(world: World, spec: Cs2KillfeedSpec, options: InsertKillfeedOptions = {}): Promise<Entity | null> {
	return (await insertCs2Killfeeds(world, [spec], options))[0] ?? null;
}

/** A feed of Counter-Strike 2 notices, as `insertKillfeeds` puts them. */
export async function insertCs2Killfeeds(world: World, specs: Cs2KillfeedSpec[], options: InsertKillfeedOptions = {}): Promise<Entity[]> {
	const drawn = await drawEvenFeed(specs, renderCs2Killfeed, USUAL_CS2_KILLFEED, PICTURE_SCALE, columnRatio(world, options, options.stackName ?? KILLFEED_NAME));
	const pictures = drawn.map((picture, index) => ({ drawn: picture, fileName: cs2KillfeedFileName(specs[index]!) }));
	return commitKillfeeds(world, pictures, {
		...options,
		entryHeight: options.entryHeight ?? CS2_ENTRY_HEIGHT,
		top: options.top ?? CS2_TOP,
	});
}

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * How many times as wide as tall the entries of the stack already up at the
 * playhead are, so new ones come in at their size; none for a dropped feed,
 * which stacks only on itself.
 */
function columnRatio(world: World, options: InsertKillfeedOptions, stackName: string): number | undefined {
	if (options.center) return undefined;
	const parent = options.parent ?? getActiveEntity(world);
	if (!parent || !isScene(parent)) return undefined;
	const time = Math.max(0, store(world, Computed).localTimeInSeconds[parent.id()] ?? 0);
	return stackColumn(world, parent, time, stackName)?.ratio || undefined;
}

/**
 * Keeps each picture in the library, then puts them all on the scene in one
 * go, so they are one step to undo. Each lands where the entry before it
 * would have sent it: under (or, in the bottom-left feed, over) the entries
 * of the same stack still up when it comes in, those already on the scene and
 * those put in just before it.
 */
async function commitKillfeeds(world: World, pictures: { drawn: HTMLCanvasElement; fileName: string }[], options: InsertKillfeedOptions): Promise<Entity[]> {
	const parent = options.parent ?? getActiveEntity(world);
	const library = world.get(Library);
	if (!parent || !isScene(parent) || !parent.get(Source)?.value || !library || !pictures.length) return [];

	const placement = { ...DEFAULT_PLACEMENT, ...options.placement };
	const assets = [];
	// One at a time: two of the same kill share a file name.
	for (const { drawn, fileName } of pictures) {
		const blob = await new Promise<Blob>((resolve, reject) => {
			drawn.toBlob((png) => (png ? resolve(png) : reject(new Error(t('Could not draw the killfeed')))), 'image/png');
		});
		const [asset] = await importFiles(library, [new File([blob], fileName, { type: 'image/png' })], KILLFEED_FOLDER);
		if (!asset) return [];
		assets.push(asset);
	}

	const computed = store(world, Computed);
	const sceneWidth = computed.width[parent.id()] ?? 1080;
	const sceneHeight = computed.height[parent.id()] ?? 1920;
	const unit = killfeedUnit(sceneWidth, sceneHeight);
	const top = (options.top ?? TOP) * unit;
	const bottom = (options.bottom ?? TOP) * unit;
	const stackName = options.stackName ?? KILLFEED_NAME;
	const spacing = Math.max(0, options.spacing ?? 0);
	const first = Math.max(0, computed.localTimeInSeconds[parent.id()] ?? 0);

	const editor = getDocumentEditor(world);
	const animation = placement.animation;
	const placed: { box: Box; start: number; end: number }[] = [];
	const entities: Entity[] = [];

	for (const [index, { drawn }] of pictures.entries()) {
		// Every entry the same size: the pictures are drawn alike, so each is
		// the game's height and as wide as they all are.
		const height = Math.round((options.entryHeight ?? ENTRY_HEIGHT) * unit);
		const width = Math.round((drawn.width * height) / drawn.height);
		const slotWidth = width;

		const start = first + index * spacing;
		const end = start + KILLFEED_SECONDS;

		// The entries put in just now aren't on the scene's clock yet, so
		// those still up are added to the column by hand. A dropped feed
		// stacks only on itself, from where its first entry landed.
		const dropped = options.center ? placed[0]?.box : undefined;
		let stack: Box | null = options.center ? null : stackColumn(world, parent, start, stackName);
		for (const entry of placed) {
			if (start < entry.start || start >= entry.end) continue;
			stack = stack ? union(stack, entry.box) : entry.box;
		}

		let x: number;
		let y: number;
		if (options.center && !dropped) {
			x = options.center.x - width / 2;
			y = options.center.y - height / 2;
		} else if (dropped) {
			// Lined up on the layout's edge, under (or over) the ones still up, else in the first one's place.
			x = placement.layout === "valorant" ? (stack ?? dropped).right - width : (stack ?? dropped).left;
			if (placement.layout === "bottomLeft") y = stack ? stack.top - height - STACK_GAP * unit : dropped.bottom - height;
			else y = stack ? stack.bottom + STACK_GAP * unit : dropped.top;
		} else if (placement.layout === "bottomLeft") {
			x = stack ? stack.left : MARGIN * unit;
			const floor = sceneHeight - bottom - height;
			y = stack ? Math.max(MARGIN * unit, stack.top - height - STACK_GAP * unit) : floor;
		} else if (placement.layout === "valorant") {
			const right = stack ? stack.right : sceneWidth - MARGIN * unit;
			x = Math.max(MARGIN * unit, right - width);
			y = Math.max(top, (stack?.bottom ?? 0) + STACK_GAP * unit);
		} else {
			const marginX = sceneWidth - slotWidth - MARGIN * unit;
			x = stack ? Math.min(stack.left, marginX) : marginX;
			y = Math.max(top, (stack?.bottom ?? 0) + STACK_GAP * unit);
		}

		x = Math.round(x);
		y = Math.round(y);
		const name = getNextName(world, stackName);
		const src = assets[index]!.path;
		const [entity] = editor.insertElement(parent, () => (
			<Rect name={name} keepAspectRatio x={x} y={y} width={width} height={height} start={round(start)} end={round(end)}>
				<ImagePaint src={src} objectFit="fill" />
				{animation === "slide" && <Animation type="slideRight" duration={0.25} />}
				{animation === "fade" && <Animation type="fade" duration={0.25} />}
				{animation !== "none" && <Animation type="fade" phase="out" duration={0.3} />}
			</Rect>
		));
		if (!entity) break;
		entities.push(entity);
		placed.push({ box: { left: x, right: x + width, top: y, bottom: y + height }, start, end });
	}

	if (entities.length) editor.select(entities);
	return entities;
}

const union = (a: Box, b: Box): Box => ({
	left: Math.min(a.left, b.left),
	right: Math.max(a.right, b.right),
	top: Math.min(a.top, b.top),
	bottom: Math.max(a.bottom, b.bottom),
});

/** The column of killfeeds named `stackName` showing at `time`, and how many times as wide as tall the widest of them is. */
function stackColumn(world: World, scene: Entity, time: number, stackName: string): (Box & { ratio: number }) | null {
	const computed = store(world, Computed);
	const fps = world.get(FrameRate)?.value || 30;
	const frame = Math.round(time * fps);
	let left = Infinity;
	let right = 0;
	let top = Infinity;
	let bottom = 0;
	let ratio = 0;
	let found = false;
	for (const child of getEntityChildren(world, scene)) {
		const props = authoredElement(child)?.props;
		if (!props || !String(props.name ?? '').startsWith(stackName)) continue;
		const from = computed.start[child.id()];
		const to = computed.end[child.id()];
		if (from === undefined || to === undefined || frame < from || frame >= to) continue;
		found = true;
		const x = Number(props.x ?? 0);
		const y = Number(props.y ?? 0);
		const width = Number(props.width ?? 0);
		left = Math.min(left, x);
		right = Math.max(right, x + width);
		top = Math.min(top, y);
		const height = Number(props.height ?? 0);
		bottom = Math.max(bottom, y + height);
		if (height > 0) ratio = Math.max(ratio, width / height);
	}
	return found ? { left, right, top, bottom, ratio } : null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
