/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { LineCaptionDecoder, easeOutAt, setWordBlur, setWordOpacity } from './line';

import type { World } from 'koota';
import type { CaptionPresetStyle } from './types';
import type { WordRange } from './line';

const BLUR = 7;
const FAINT = 0.35;
const FOCUS_SECONDS = 0.18;

export const FOCUS_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '700',
	fontSize: 60,
	fontStyle: FontStyle.NORMAL,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1.15,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class FocusCaptionDecoder extends LineCaptionDecoder {
	public readonly type = CaptionType.FOCUS;
	protected readonly grouping = { length: 22 };
	protected readonly size = { width: 820, height: 160 };
	protected readonly textStyle = FOCUS_TEXT_STYLE;

	protected poseWords(world: World, words: WordRange[], time: number): void {
		for (const { range, word } of words) {
			const sharp = time >= word.start ? easeOutAt(time - word.start, FOCUS_SECONDS) : 0;
			setWordBlur(world, range, BLUR * (1 - sharp));
			setWordOpacity(world, range, FAINT + (1 - FAINT) * sharp);
		}
	}
}
