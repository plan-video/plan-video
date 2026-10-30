/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AnimationPhase, AnimationType, CaptionAlign, CaptionType, FontStyle, PaintType, StrokeCap, StrokeJoin, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Animation, Caption, ChildOf, Color, FrameRate, Paint, Stroke, StrokeStyle, TextRange, WordTiming } from '../../traits';
import { renderText } from '../../utils/text';
import { loadWebFont } from '../../fonts/utils';
import { applyWordStyles, clearTextRanges, paceGroups, resolveTranscript, retainWordStyles, setChars, shownWordsAt } from './utils';
import type { CaptionPacing } from './utils';
import { placeCaption } from './position';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { store } from '../../world/store';

import type { Entity, World } from 'koota';
import type { Asset } from '@plan.video/assets';
import type { CaptionDecoder, CaptionPresetStyle } from './types';

const WIDTH = 700;
const HEIGHT = 120;
const FILL = 0xFFCC00;
const POP_SECONDS = 0.22;

// Extra-bold yellow with a thick black outline: the TikTok caption look.
export const POP_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '900',
	fontSize: 72,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	fontStyle: FontStyle.NORMAL,
	leading: 1,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class PopCaptionDecoder implements CaptionDecoder {
	public readonly type = CaptionType.POP;
	public groups: ReturnType<typeof paceGroups> = [];
	public ready = false;
	public loaded: Promise<void>;
	public styled = false;
	public pacing: CaptionPacing;

	private readonly asset: Asset;
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

	/** Groups the words again for new `words`, `chars` or `linger`. */
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
		return placeCaption(world, entity, {
			width: WIDTH,
			height: HEIGHT,
			defaultAlign: CaptionAlign.CENTER,
		});
	}

	public applyStyles(world: World, entity: Entity): boolean {
		if (!this.reposition(world, entity)) return false;

		const stroke = createEntity(world);
		stroke.add(Stroke);
		stroke.add(Paint);
		stroke.set(Paint, { value: PaintType.SOLID });
		stroke.add(Color);
		stroke.set(Color, { value: 0x000000 });
		stroke.add(StrokeStyle);
		stroke.set(StrokeStyle, { width: 14, join: StrokeJoin.ROUND, cap: StrokeCap.ROUND });
		appendChild(world, stroke, entity);

		loadWebFont(world, POP_TEXT_STYLE.fontFamily);
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
		if (!words || !text) return;

		applyWordStyles(world, entity, text, words);
		popWords(world, entity);
	}

	public draw(world: World, entity: Entity): void {
		// A look brings its own colour.
		const caption = entity.get(Caption);
		if (!caption?.look) store(world, Color).value[entity.id()] = caption?.colors?.[0] ?? FILL;
		renderText(world, entity);
	}

	public dispose(): void {
		this.loadId++;
		this.groups = [];
		this.currentText = '';
	}
}

/** A pop on each shown word, so it scales on as it is said. A word with an animation of its own keeps it. */
function popWords(world: World, entity: Entity): void {
	const fps = world.get(FrameRate)?.value ?? 30;
	for (const range of [...world.query(ChildOf(entity), TextRange, WordTiming)]) {
		let animated = false;
		for (const child of world.query(ChildOf(range))) {
			if (child.has(Animation)) animated = true;
		}
		if (animated) continue;

		const animation = createEntity(world);
		animation.add(Animation);
		animation.set(Animation, {
			type: AnimationType.POP,
			duration: Math.max(1, Math.round(POP_SECONDS * fps)),
			delay: 0,
			phase: AnimationPhase.IN,
		});
		appendChild(world, animation, range);
	}
}
