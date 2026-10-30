/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { BlendModeType, CaptionAlign, CaptionType, PaintType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Paint, Color, BlendMode } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { applyWordStyles, clearTextRanges, paceGroups, resolveTranscript, retainWordStyles, setChars, shownWordsAt } from './utils';
import type { CaptionPacing } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 700;
const HEIGHT = 100;

export const STARK_TEXT_STYLE = {
	fontFamily: 'Figtree',
	fontWeight: '800',
	fontSize: 70,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.UPPER,
	fontStyle: FontStyle.NORMAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class StarkCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.STARK;
	public groups: ReturnType<typeof paceGroups> = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	private readonly asset: Asset;
	/** The text last written to the entity; null forces the next seek to write. */
	private currentText: string | null = null;
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
		this.groups = paceGroups(transcript, this.pacing, { duration: 0.2 });
		this.currentText = null;
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: 0xFFFFFF });
		fill.add(BlendMode);
		fill.set(BlendMode, { value: BlendModeType.DIFFERENCE });
		appendChild(world, fill, entity);

		loadWebFont(world, STARK_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const words = shownWordsAt(this.groups, relativeTime, this.pacing);
		const text = words?.map((word) => word.text).join(' ') ?? '';
		if (text === this.currentText) {
			if (words) retainWordStyles(world, entity, text, words);
			return;
		}
		this.currentText = text;
		setChars(world, entity, text);
		clearTextRanges(world, entity);
		if (words) applyWordStyles(world, entity, text, words);
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.loadId++;
		this.groups = [];
		this.currentText = '';
	}
}
