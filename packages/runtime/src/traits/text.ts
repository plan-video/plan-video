/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { FontStyle, TextAlign, TextBaseline, TextCase } from '../constants';

import type { Token } from '../utils/text';

// Text characters: only on the parent text node, not shared with ranges.
export const Chars = trait({ value: '' });

/** Default style on a text node, override on a range. All fields default to undefined: a sparse slot means "inherit", and the fallbacks live in the renderer's accessors. */
export const TextStyle = trait({
	leading: undefined as number | undefined,
	fontSize: undefined as number | undefined,
	fontFamily: undefined as string | undefined,
	fontWeight: undefined as string | undefined,
	fontStyle: undefined as FontStyle | undefined,
	textAlign: undefined as TextAlign | undefined,
	textBaseline: undefined as TextBaseline | undefined,
	textCase: undefined as TextCase | undefined,
	letterSpacing: undefined as number | undefined, // extra spacing between characters (px)
});

// Character range a TextStyle override applies to; end null = to the end.
export const TextRange = trait({ start: 0, end: null as number | null });

// Runtime-only: when a caption word's range is spoken, in seconds of the
// caption. Its animations play against this window, not the caption's.
export const WordTiming = trait({ start: 0, end: 0 });

// Runtime-only: cached text layout, one Token[] per line. Never serialized.
export const TextCache = trait({ tokens: () => [] as Token[][] });
