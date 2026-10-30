/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { LineCaptionDecoder, easeOutAt, setWordOffset, setWordOpacity } from './line';

import type { World } from 'koota';
import type { CaptionPresetStyle } from './types';
import type { WordRange } from './line';

/** How far below its place a word starts, in the text's pixels. */
const RISE = 22;
const RISE_SECONDS = 0.24;

// The line builds up word by word, each one rising into its place as it is said.
export const RISE_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '800',
	fontSize: 64,
	fontStyle: FontStyle.NORMAL,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1.15,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class RiseCaptionDecoder extends LineCaptionDecoder {
	public readonly type = CaptionType.RISE;
	protected readonly grouping = { length: 18 };
	protected readonly size = { width: 800, height: 160 };
	protected readonly textStyle = RISE_TEXT_STYLE;

	protected poseWords(world: World, words: WordRange[], time: number): void {
		for (const { range, word } of words) {
			const said = time >= word.start;
			const eased = said ? easeOutAt(time - word.start, RISE_SECONDS) : 0;
			setWordOpacity(world, range, eased);
			setWordOffset(world, range, word, RISE * (1 - eased));
		}
	}
}
