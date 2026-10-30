/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { TextRange, TextStyle } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { applyWordStyles, paceGroups, findActiveGroup, splitSequence, clearTextRanges, resolveTranscript, retainWordStyles, setChars } from './utils';
import type { CaptionPacing } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 700;
const HEIGHT = 200;

export const PAPER_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '300',
	fontSize: 50,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 0.9,
	fontStyle: FontStyle.NORMAL,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class PaperCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.PAPER;
	public groups: ReturnType<typeof paceGroups> = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	private readonly asset: Asset;
	private currentGroupIndex = -1;
	private activeSplit: 'left' | 'right' | null = null;
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
		this.groups = paceGroups(transcript, this.pacing, { length: 18 });
		this.currentGroupIndex = -1;
		this.activeSplit = null;
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.CENTER });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, PAPER_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime, this.pacing.linger);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			clearTextRanges(world, entity);
			this.currentGroupIndex = -1;
			this.activeSplit = null;
			return;
		}

		const group = this.groups[groupIndex]!;
		const [left, right] = splitSequence(group);
		const leftText = left.map(w => w.text).join(' ');
		const rightText = right.map(w => w.text).join(' ');
		const text = rightText ? `${leftText}\n${rightText}` : leftText;
		const activeSplit = right.length > 0 && relativeTime >= right[0]!.start ? 'right' : 'left';

		if (groupIndex !== this.currentGroupIndex || activeSplit !== this.activeSplit) {
			this.currentGroupIndex = groupIndex;
			this.activeSplit = activeSplit;
			setChars(world, entity, text);

			clearTextRanges(world, entity);
			const start = activeSplit === 'left' ? 0 : leftText.length + 1;
			const end = activeSplit === 'left' ? leftText.length : text.length;
			if (end > start) {
				const range = createEntity(world);
				range.add(TextRange);
				range.set(TextRange, { start, end });
				range.add(TextStyle);
				range.set(TextStyle, { fontWeight: '500' });
				appendChild(world, range, entity);
			}
			applyWordStyles(world, entity, text, [...left, ...right]);
		} else {
			retainWordStyles(world, entity, text, [...left, ...right]);
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.loadId++;
		this.groups = [];
		this.currentGroupIndex = -1;
		this.activeSplit = null;
	}
}
