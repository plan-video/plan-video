/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign } from '../../constants';
import { Blur, ChildOf, Offset, Opacity, Scale, TextRange, WordTiming } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { store } from '../../world/store';
import { applyWordStyles, clearTextRanges, findActiveGroup, paceGroups, resolveTranscript, retainWordStyles, setChars } from './utils';
import { placeCaption } from './position';

import type { Entity, World } from 'koota';
import type { Asset, TranscriptWord } from '@plan.video/assets';
import type { CaptionType } from '../../constants';
import type { Token } from '../../utils/text';
import type { CaptionDecoder, CaptionPresetStyle } from './types';
import type { CaptionPacing, GroupByOptions } from './utils';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** How far into a motion `seconds` of `length` is, eased out, 0 to 1. */
export function easeOutAt(seconds: number, length: number): number {
	const t = Math.min(1, Math.max(0, seconds / length));
	return 1 - (1 - t) ** 3;
}

/**
 * The common ground of the presets that show a line at a time and treat the
 * word being said apart from the rest: Box, Marker, Deep, Rise and Focus.
 * A line is up from its first word until it has lingered past its last; the
 * spoken word is the latest one said, kept through the breath before the
 * next. Each preset says how it groups, where it sits, and what it does to
 * the spoken word (`markSpoken`), to every word as time passes (`poseWords`)
 * and behind the glyphs (`underlay`).
 */
export abstract class LineCaptionDecoder implements CaptionDecoder {
	public abstract readonly type: CaptionType;
	public groups: ReturnType<typeof paceGroups> = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	protected abstract readonly grouping: GroupByOptions;
	protected abstract readonly size: { width: number; height: number };
	protected abstract readonly textStyle: CaptionPresetStyle;

	/** The caption's own time at the last seek, in seconds. */
	protected time = 0;
	/** When the spoken word began; its motions are timed from here. */
	protected spokenStart = 0;
	/** The range over the spoken word's glyphs, when the preset marks it. */
	protected spoken: Entity | null = null;

	private readonly asset: Asset;
	private groupIndex = -1;
	private wordIndex = -1;
	private loadId = 0;

	constructor(asset: Asset, pacing: CaptionPacing = {}) {
		this.asset = asset;
		this.pacing = pacing;
		this.loaded = this.load();
	}

	/** Re-reads the transcript after its words change. */
	public reload(): Promise<void> {
		return this.load();
	}

	/** Groups the words again for new `words`, `chars` or `linger`. */
	public repace(pacing: CaptionPacing): Promise<void> {
		this.pacing = pacing;
		return this.load();
	}

	private async load(): Promise<void> {
		const loadId = ++this.loadId;
		const transcript = await resolveTranscript(this.asset);
		if (loadId !== this.loadId) return;
		this.groups = paceGroups(transcript, this.pacing, this.grouping);
		this.groupIndex = -1;
		this.wordIndex = -1;
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { ...this.size, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;
		this.decorate(world, entity);
		// Every preset sets its words in one of the bundled web fonts.
		loadWebFont(world, this.textStyle.fontFamily as Parameters<typeof loadWebFont>[1]);
		return true;
	}

	/** Children the preset draws with for as long as it is on, such as a shadow. */
	protected decorate(_world: World, _entity: Entity): void {}

	/** Styles the range over the spoken word of `entity`, made afresh each time the word changes. Null leaves it unmarked. */
	protected markSpoken?(world: World, range: Entity, entity: Entity): void;

	/** Poses each word for this moment, through its range's Opacity, Offset, Blur and Scale. */
	protected poseWords?(world: World, words: WordRange[], time: number): void;

	/** What is drawn behind the glyphs, in the text's coordinates. */
	protected underlay?(world: World, entity: Entity, ctx: Ctx, lines: readonly Token[][]): void;

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		this.time = relativeTime;
		const groupIndex = findActiveGroup(this.groups, relativeTime, this.pacing.linger);

		if (groupIndex === -1) {
			if (this.groupIndex !== -1 || this.wordIndex !== -1) {
				setChars(world, entity, '');
				clearTextRanges(world, entity);
			}
			this.spoken = null;
			this.groupIndex = -1;
			this.wordIndex = -1;
			return;
		}

		const group = this.groups[groupIndex]!;
		const wordIndex = group.findLastIndex((word) => relativeTime >= word.start);
		const text = group.map((word) => word.text).join(' ');

		if (groupIndex !== this.groupIndex || wordIndex !== this.wordIndex) {
			this.groupIndex = groupIndex;
			this.wordIndex = wordIndex;
			this.spokenStart = wordIndex === -1 ? 0 : group[wordIndex]!.start;
			setChars(world, entity, text);
			clearTextRanges(world, entity);
			this.spoken = null;

			if (wordIndex !== -1 && this.markSpoken) {
				const start = group.slice(0, wordIndex).map((word) => word.text).join(' ').length + (wordIndex > 0 ? 1 : 0);
				const range = createEntity(world);
				range.add(TextRange);
				range.set(TextRange, { start, end: start + group[wordIndex]!.text.length });
				appendChild(world, range, entity);
				this.markSpoken(world, range, entity);
				this.spoken = range;
			}

			applyWordStyles(world, entity, text, group);
		} else {
			retainWordStyles(world, entity, text, group);
		}

		if (this.poseWords) this.poseWords(world, wordRanges(world, entity, group), relativeTime);
	}

	public draw(world: World, entity: Entity): void {
		const underlay = this.underlay;
		renderText(world, entity, underlay ? (ctx, lines) => underlay.call(this, world, entity, ctx, lines) : undefined);
	}

	public dispose(): void {
		this.loadId++;
		this.groups = [];
		this.groupIndex = -1;
		this.wordIndex = -1;
		this.spoken = null;
	}
}

/** A word on the line and the range its glyphs are styled through. */
export type WordRange = { range: Entity; word: TranscriptWord };

/** The line's word ranges (see `applyWordStyles`), each with the word it is. */
function wordRanges(world: World, entity: Entity, group: readonly TranscriptWord[]): WordRange[] {
	const out: WordRange[] = [];
	for (const range of world.query(ChildOf(entity), TextRange, WordTiming)) {
		const start = range.get(WordTiming)!.start;
		const word = group.find((candidate) => candidate.start === start);
		if (word) out.push({ range, word });
	}
	return out;
}

/** Sets how opaque a word is, adding the trait the first time. */
export function setWordOpacity(world: World, range: Entity, value: number): void {
	if (!range.has(Opacity)) range.add(Opacity);
	store(world, Opacity).value[range.id()] = value;
}

/** Sets how blurred a word is, in the text's pixels. */
export function setWordBlur(world: World, range: Entity, value: number): void {
	if (!range.has(Blur)) range.add(Blur);
	store(world, Blur).value[range.id()] = value;
}

/** Sets the size a word rests at, about its center. */
export function setWordScale(world: World, range: Entity, value: number): void {
	if (!range.has(Scale)) range.add(Scale);
	const scale = store(world, Scale);
	scale.x[range.id()] = value;
	scale.y[range.id()] = value;
}

/** Moves a word from where it was laid out, on top of the offset its own style gives it. */
export function setWordOffset(world: World, range: Entity, word: TranscriptWord, y: number): void {
	if (!range.has(Offset)) range.add(Offset);
	const offset = store(world, Offset);
	offset.x[range.id()] = word.style?.offsetX ?? 0;
	offset.y[range.id()] = (word.style?.offsetY ?? 0) + y;
}
