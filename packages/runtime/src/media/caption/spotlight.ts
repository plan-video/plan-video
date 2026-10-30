/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../../world/store';
import { CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, Caption, TextRange } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { applyWordStyles, paceGroups, findActiveGroup, clearTextRanges, resolveTranscript, retainWordStyles, setChars } from './utils';
import type { CaptionPacing } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';


const WIDTH = 700;
const HEIGHT = 100;
const HIGHLIGHT_COLOR = 0x24D5FF;

export const SPOTLIGHT_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '800',
	fontStyle: FontStyle.NORMAL,
	fontSize: 70,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class SpotlightCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.SPOTLIGHT;
	public groups: ReturnType<typeof paceGroups> = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	private readonly asset: Asset;
	private currentGroupIndex = -1;
	private currentWordIndex = -1;
	private fill: Entity | null = null;
	private loadId = 0;

	constructor(asset: Asset, pacing: CaptionPacing = {}) {
		this.asset = asset;
		this.pacing = pacing;
		this.loaded = this.load();
	}

	public reload(): Promise<void> {
		return this.load();
	}

	public repace(pacing: CaptionPacing): Promise<void> {
		this.pacing = pacing;
		return this.load();
	}

	private async load(): Promise<void> {
		const loadId = ++this.loadId;
		const transcript = await resolveTranscript(this.asset);
		if (loadId !== this.loadId) return;
		this.groups = paceGroups(transcript, this.pacing, { length: 10 });
		this.currentGroupIndex = -1;
		this.currentWordIndex = -1;
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, SPOTLIGHT_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime, this.pacing.linger);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			clearTextRanges(world, entity);
			this.fill = null;
			this.currentGroupIndex = -1;
			this.currentWordIndex = -1;
			return;
		}

		const group = this.groups[groupIndex]!;

		// The latest word said stays lit through the breath before the next.
		const wordIndex = group.findLastIndex(word => relativeTime >= word.start);

		const text = group.map(w => w.text).join(' ');

		if (groupIndex !== this.currentGroupIndex || wordIndex !== this.currentWordIndex) {
			this.currentGroupIndex = groupIndex;
			this.currentWordIndex = wordIndex;
			setChars(world, entity, text);

			clearTextRanges(world, entity);
			this.fill = null;

			if (group.length > 1 && wordIndex !== -1) {
				const start = group.slice(0, wordIndex).map(w => w.text).join(' ').length;
				const end = group.slice(0, wordIndex + 1).map(w => w.text).join(' ').length;
				const range = createEntity(world);
				range.add(TextRange);
				range.set(TextRange, { start, end });
				appendChild(world, range, entity);

				const fill = createEntity(world);
				fill.add(Paint);
				fill.set(Paint, { value: PaintType.SOLID });
				fill.add(Color);
				fill.set(Color, { value: HIGHLIGHT_COLOR });
				appendChild(world, fill, range);
				this.fill = fill;
			}

			applyWordStyles(world, entity, text, group);
		} else {
			retainWordStyles(world, entity, text, group);
		}
	}

	public draw(world: World, entity: Entity): void {
		const highlightColor = entity.get(Caption)?.colors?.[0] ?? HIGHLIGHT_COLOR;

		if (this.fill) {
			store(world, Color).value[this.fill.id()] = highlightColor;
		}

		renderText(world, entity);
	}

	public dispose(): void {
		this.loadId++;
		this.groups = [];
		this.currentGroupIndex = -1;
		this.currentWordIndex = -1;
	}
}
