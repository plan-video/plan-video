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

const WIDTH = 1000;
const HEIGHT = 100;

// The preset's base TextStyle; the document writes it and authored style
// props overwrite it (see CAPTION_PRESET_STYLES).
export const WHISPER_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '400',
	fontSize: 40,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1.4,
	fontStyle: FontStyle.NORMAL,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class WhisperCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.WHISPER;
	public groups: ReturnType<typeof paceGroups> = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	private readonly asset: Asset;
	private currentGroupIndex = -1;
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
		this.groups = paceGroups(transcript, this.pacing, { duration: 2 });
		this.currentGroupIndex = -1;
		this.ready = true;
	}

	public reposition(world: World, entity: Entity): boolean {
		return placeCaption(world, entity, { width: WIDTH, height: HEIGHT, defaultAlign: CaptionAlign.BOTTOM });
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		loadWebFont(world, WHISPER_TEXT_STYLE.fontFamily);
		return true;
	}

	public seekTo(world: World, entity: Entity, relativeTime: number): void {
		const groupIndex = findActiveGroup(this.groups, relativeTime, this.pacing.linger);

		if (groupIndex === -1) {
			setChars(world, entity, '');
			clearTextRanges(world, entity);
			this.currentGroupIndex = -1;
			return;
		}

		if (groupIndex !== this.currentGroupIndex) {
			this.currentGroupIndex = groupIndex;
			const group = this.groups[groupIndex]!;
			const text = group.map(w => w.text).join(' ');
			setChars(world, entity, text);
			clearTextRanges(world, entity);
			applyWordStyles(world, entity, text, group);
		} else {
			const group = this.groups[groupIndex]!;
			retainWordStyles(world, entity, group.map(w => w.text).join(' '), group);
		}
	}

	public draw(world: World, entity: Entity): void {
		renderText(world, entity);
	}

	public dispose(): void {
		this.loadId++;
		this.groups = [];
		this.currentGroupIndex = -1;
	}
}
