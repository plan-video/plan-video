/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../../world/store';
import { ChildOf, TextRange, Cache, Chars, Offset, WordTiming } from '../../traits';
import { PaintType } from '../../constants';
import { createEntity, deleteEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { getAssetFile } from '../../actions/assets';
import { cloneFromRecords } from '../../world/serialize';
import { parseSubtitles } from './subtitles';

import type { Entity, World } from 'koota';
import type { Asset, Transcript, TranscriptWord, TranscriptWordStyle, WordGroup } from '@plan.video/assets';
import type { EntityRecord } from '../../world/serialize';

export type TextRangeOverride = {
	start: number;
	end: number;
};


/** Where a line breaks: past this many seconds spoken, characters (not counting spaces), or words. */
export type GroupByOptions = {
	duration?: number;
	length?: number;
	words?: number;
};

/** What is left unset is the preset's own. */
export type CaptionPacing = {
	words?: number;
	chars?: number;
	linger?: number;
};

const groupsOwn = (pacing: CaptionPacing): boolean => pacing.words !== undefined || pacing.chars !== undefined;

export function paceGroups(transcript: Transcript, pacing: CaptionPacing, preset: GroupByOptions): WordGroup[] {
	return groupBy(transcript, groupsOwn(pacing) ? { words: pacing.words, length: pacing.chars } : preset);
}

/**
 * What a one-word preset shows at `time`: the word being said or, when the
 * author asked for more than one word at a time, the whole group it is in.
 */
export function shownWordsAt(groups: WordGroup[], time: number, pacing: CaptionPacing): WordGroup | null {
	if (!groupsOwn(pacing) || pacing.words === 1) {
		const word = spokenWordAt(groups, time, pacing.linger);
		return word ? [word] : null;
	}
	const index = findActiveGroup(groups, time, pacing.linger);
	return index === -1 ? null : groups[index]!;
}

const ENDING_PUNCTUATION = ['.', '!', '?', ',', ';'];

/** A gap this long is a pause, not a breath inside a phrase. */
const PAUSE_SECONDS = 0.35;

/** So a breath before the next word doesn't blink the caption off; a longer pause still clears it. */
const LINGER_SECONDS = 0.3;

/**
 * The word being spoken at `time`. Later words win, so a word never appears
 * before it is said, and it is held only across the short gap that follows it.
 */
export function spokenWord(groups: WordGroup[], time: number): string {
	return spokenWordAt(groups, time)?.text ?? '';
}

export function spokenWordAt(groups: WordGroup[], time: number, linger = LINGER_SECONDS): TranscriptWord | null {
	let spoken: TranscriptWord | null = null;
	for (const group of groups) {
		for (const word of group) {
			if (time >= word.start && time <= word.end + linger) spoken = word;
		}
	}
	return spoken;
}

const WORD_LAYERS = ['fills', 'strokes', 'shadows', 'effects', 'animations'] as const;

/**
 * What an empty paint list is drawn as: one hidden paint of that kind. A
 * range with no paints of a kind shows the caption's, and a word that has
 * none must not. Effects and animations are never the caption's to show.
 */
const NO_LAYER: Partial<Record<typeof WORD_LAYERS[number], Omit<EntityRecord, 'id' | 'eid'>>> = {
	fills: { Paint: PaintType.SOLID, Color: 0, Hidden: true },
	strokes: { Stroke: {}, Paint: PaintType.SOLID, Color: 0, Hidden: true },
	shadows: { Shadow: {}, Color: 0, Hidden: true },
};

export function isStyledWord(style: TranscriptWordStyle | undefined): style is TranscriptWordStyle {
	if (!style) return false;
	return (style.text !== undefined && Object.keys(style.text).length > 0)
		|| style.color !== undefined
		|| style.opacity !== undefined
		|| style.blendMode !== undefined
		|| style.hidden === true
		|| style.offsetX !== undefined
		|| style.offsetY !== undefined
		|| WORD_LAYERS.some(kind => style[kind] !== undefined);
}

/** The range itself is eid 0; every paint, effect and animation under it is numbered apart. */
export function wordStyleRecords(style: TranscriptWordStyle): EntityRecord[] {
	const records: EntityRecord[] = [{
		id: '0',
		eid: 0,
		...(style.text && Object.keys(style.text).length > 0 ? { TextStyle: { ...style.text } } : {}),
		...(style.color !== undefined ? { Color: style.color } : {}),
		...(style.opacity !== undefined ? { Opacity: style.opacity } : {}),
		...(style.blendMode !== undefined ? { BlendMode: style.blendMode } : {}),
		...(style.hidden ? { Hidden: true } : {}),
		...(style.offsetX !== undefined || style.offsetY !== undefined
			? { Offset: { x: style.offsetX ?? 0, y: style.offsetY ?? 0 } }
			: {}),
	}];

	let next = 1;
	for (const kind of WORD_LAYERS) {
		const layers = style[kind];
		if (!layers) continue;
		if (layers.length === 0) {
			const none = NO_LAYER[kind];
			if (none) records.push({ ...none, id: String(next), eid: next++, ChildOf: 0 });
			continue;
		}
		const ids = new Map<number, number>([[0, 0]]);
		for (const layer of layers) ids.set(layer.eid, next++);
		for (const layer of layers) {
			const eid = ids.get(layer.eid)!;
			records.push({
				...(layer as unknown as EntityRecord),
				id: String(eid),
				eid,
				ChildOf: ids.get(layer.ChildOf ?? 0) ?? 0,
			});
		}
	}
	return records;
}

/**
 * One range per shown word, added last so a word's own look wins. Styled
 * words bring their paints and animations; every word gets `WordTiming` so
 * a pop on the caption can play on that word instead of the whole layer.
 */
export function applyWordStyles(world: World, entity: Entity, text: string, words: readonly TranscriptWord[]): void {
	let cursor = 0;
	for (const word of words) {
		const at = text.indexOf(word.text, cursor);
		if (at === -1) continue;
		cursor = at + word.text.length;

		const range = isStyledWord(word.style)
			? cloneFromRecords(world, wordStyleRecords(word.style)).get(0)
			: createEntity(world);
		if (!range) continue;
		range.add(TextRange);
		range.set(TextRange, { start: at, end: cursor });
		range.add(WordTiming);
		range.set(WordTiming, { start: word.start, end: word.end });
		if (word.style?.offsetX !== undefined || word.style?.offsetY !== undefined) {
			range.add(Offset);
			range.set(Offset, { x: word.style.offsetX ?? 0, y: word.style.offsetY ?? 0 });
		}
		appendChild(world, range, entity);
	}
}

export function hasWordTiming(entity: Entity): boolean {
	return (entity.get(Cache)?.textRanges ?? []).some((range) => range.has(WordTiming));
}

/** Adds word timings if the last seek left none, so a later pop can play. */
export function retainWordStyles(
	world: World,
	entity: Entity,
	text: string,
	words: readonly TranscriptWord[],
): void {
	if (!text || words.length === 0 || hasWordTiming(entity)) return;
	applyWordStyles(world, entity, text, words);
}

export function groupBy(transcript: Transcript, options: GroupByOptions): WordGroup[] {
	const groups: WordGroup[] = [[]];

	for (const segment of transcript) {
		// Segment boundaries are sentence boundaries — never merge across them.
		if (groups[groups.length - 1]!.length > 0) {
			groups.push([]);
		}

		for (const word of segment.words) {
			let last = groups[groups.length - 1]!;
			const previous = last[last.length - 1];
			// A pause belongs to neither phrase. Without this, the line stays
			// up from the word before the silence through the word after it.
			if (previous && word.start - previous.end > PAUSE_SECONDS) {
				groups.push([]);
				last = groups[groups.length - 1]!;
			}

			const charCount = last.reduce((acc, w) => acc + w.text.length, 0);
			const duration = last.reduce((acc, w) => acc + (w.end - w.start), 0);

			if (last.length > 0 && (
				(options.duration !== undefined && duration + (word.end - word.start) > options.duration)
				|| (options.length !== undefined && charCount + word.text.length > options.length)
				|| (options.words !== undefined && last.length >= options.words)
			)) {
				groups.push([]);
			}

			groups.at(-1)?.push(word);

			if (ENDING_PUNCTUATION.some(p => word.text.endsWith(p))) {
				groups.push([]);
			}
		}
	}

	return groups.filter(g => g.length > 0);
}

/**
 * The line showing at `relativeTime`, or -1 for none. Like a word, a line
 * stays a moment after it ends and gives way as soon as the next one starts.
 */
export function findActiveGroup(groups: WordGroup[], relativeTime: number, linger = LINGER_SECONDS): number {
	let active = -1;
	groups.forEach((group, index) => {
		if (relativeTime >= group[0]!.start && relativeTime <= (group.at(-1)?.end ?? 0) + linger) active = index;
	});
	return active;
}

/**
 * Playhead-driven caption text: a raw store write, no change events, so the
 * app never persists per-frame caption content.
 */
export function setChars(_world: World, entity: Entity, text: string) {
	// A set, not a store write, so the words reach Computed (see the Chars mirror).
	if (!entity.has(Chars)) entity.add(Chars);
	entity.set(Chars, { value: text });
}

export function clearTextRanges(world: World, parent: Entity) {
	for (const range of world.query(ChildOf(parent), TextRange)) {
		deleteEntity(world, range);
	}

	if (parent.has(Cache)) {
		store(world, Cache).textRanges[parent.id()] = [];
	}
}

/** Splits at the word boundary nearest the midpoint of the joined text. */
export function splitSequence(sequence: WordGroup): [WordGroup, WordGroup] {
	const text = sequence.map(w => w.text).join(' ');
	const midPoint = Math.ceil(text.length / 2);

	let index = text.length;
	for (let i = midPoint, j = midPoint; i > 0 && j < text.length - 1; i--, j++) {
		if (text[i] === ' ') {
			index = i;
			break;
		}
		if (text[j] === ' ') {
			index = j;
			break;
		}
	}

	const leftText = text.slice(0, index).trim();
	const splitAt = leftText.split(/ /).length;

	return [sequence.slice(0, splitAt), sequence.slice(splitAt)];
}


// Transcript lengths already read, by asset id — a content hash, so an entry
// can never go stale. Timing recomputes are synchronous while reading a
// transcript is not; this is the seam between the two (see the caption
// branches in actions/timing.ts).
const transcriptDurations = new Map<string, number>();

/** Its last word's end; null until `primeTranscriptDuration` has read the asset, and for a transcript with no words. */
export function getTranscriptDuration(asset: Asset): number | null {
	const duration = transcriptDurations.get(asset.id);
	return duration === undefined || duration <= 0 ? null : duration;
}

export function setTranscriptDuration(asset: Asset, seconds: number): void {
	transcriptDurations.set(asset.id, seconds);
}

/** So `getTranscriptDuration` can answer synchronously from then on. */
export async function primeTranscriptDuration(asset: Asset): Promise<void> {
	if (transcriptDurations.has(asset.id)) return;

	const transcript = await resolveTranscript(asset);
	let end = 0;
	for (const segment of transcript) {
		for (const word of segment.words) {
			if (word.end > end) end = word.end;
		}
	}
	transcriptDurations.set(asset.id, end);
}

export async function resolveTranscript(asset: Asset): Promise<Transcript> {
	if (asset.type === 'TRANSCRIPT') {
		const file = await getAssetFile(asset);
		const text = await file.text();
		if (asset.mimeType === 'application/x-subrip' || asset.mimeType === 'text/vtt') {
			return parseSubtitles(text);
		}
		return JSON.parse(text);
	}

	if ((asset.type === 'AUDIO' || asset.type === 'VIDEO') && asset.transcript) {
		return asset.transcript;
	}

	return [];
}
