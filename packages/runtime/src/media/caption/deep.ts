/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, FontStyle, PaintType, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Caption, Color, Paint } from '../../traits';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { renderText } from '../../utils/text';
import { store } from '../../world/store';
import { LineCaptionDecoder, easeOutAt, setWordOpacity, setWordScale } from './line';

import type { Entity, World } from 'koota';
import type { CaptionPresetStyle } from './types';
import type { WordRange } from './line';

/** The spoken word's color until the file gives it one. */
export const DEEP_HIGHLIGHT = 0xFFFFFF;
/** How faint the words not being said are. */
const DIM = 0.4;
/** How much larger the spoken word is. */
const LIFT = 0.04;
const LIFT_SECONDS = 0.12;

// The whole line up, the word being said bright and a touch larger, the rest faint.
export const DEEP_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '800',
	fontSize: 62,
	fontStyle: FontStyle.NORMAL,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1.15,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class DeepCaptionDecoder extends LineCaptionDecoder {
	public readonly type = CaptionType.DEEP;
	protected readonly grouping = { length: 20 };
	protected readonly size = { width: 800, height: 160 };
	protected readonly textStyle = DEEP_TEXT_STYLE;

	private fill: Entity | null = null;

	protected markSpoken(world: World, range: Entity): void {
		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: DEEP_HIGHLIGHT });
		appendChild(world, fill, range);
		this.fill = fill;
	}

	protected poseWords(world: World, words: WordRange[], time: number): void {
		for (const { range, word } of words) {
			const spoken = word.start === this.spokenStart && time >= word.start;
			setWordOpacity(world, range, spoken ? 1 : DIM);
			setWordScale(world, range, spoken ? 1 + LIFT * easeOutAt(time - word.start, LIFT_SECONDS) : 1);
		}
	}

	public draw(world: World, entity: Entity): void {
		if (this.spoken && this.fill?.isAlive()) {
			store(world, Color).value[this.fill.id()] = entity.get(Caption)?.colors?.[0] ?? DEEP_HIGHLIGHT;
		}
		renderText(world, entity);
	}
}
