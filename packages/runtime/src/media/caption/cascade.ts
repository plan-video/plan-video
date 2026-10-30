/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionAlign, CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { applyWordStyles, clearTextRanges, paceGroups, findActiveGroup, resolveTranscript, retainWordStyles, setChars } from './utils';
import type { CaptionPacing } from './utils';
import { placeCaption } from './position';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 800;
const HEIGHT = 200;

export const CASCADE_TEXT_STYLE = {
	fontFamily: 'Inter',
	fontWeight: '300',
	fontSize: 50,
	textAlign: TextAlign.LEFT,
	textBaseline: TextBaseline.TOP,
	fontStyle: FontStyle.NORMAL,
	textCase: TextCase.ORIGINAL,
	leading: 1.2,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class CascadeCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.CASCADE;
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
		this.groups = paceGroups(transcript, this.pacing, { length: 50 });
		this.currentText = null;
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, x: 100, defaultAlign: CaptionAlign.BOTTOM });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, CASCADE_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime, this.pacing.linger);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			clearTextRanges(world, entity);
			this.currentText = '';
			return;
		}

		const group = this.groups[groupIndex]!;

		const shown = group.filter(word => word.start <= relativeTime);
		const text = shown.map(w => w.text).join(' ');

		if (text !== this.currentText) {
			this.currentText = text;
			setChars(world, entity, text);
			clearTextRanges(world, entity);
			applyWordStyles(world, entity, text, shown);
		} else {
			retainWordStyles(world, entity, text, shown);
		}
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
