/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { accent } from './accent';
import { block } from './block';
import { bottom } from './bottom';
import { cards } from './cards';
import { chip } from './chip';
import { cinema } from './cinema';
import { duo } from './duo';
import { editorial } from './editorial';
import { flip } from './flip';
import { glass } from './glass';
import { glide } from './glide';
import { haiku } from './haiku';
import { hop } from './hop';
import { hype } from './hype';
import { impact } from './impact';
import { karaoke } from './karaoke';
import { magazine } from './magazine';
import { newsroom } from './newsroom';
import { punch } from './punch';
import { quiet } from './quiet';
import { serif } from './serif';
import { shine } from './shine';
import { stack } from './stack';
import { sticker } from './sticker';
import { terminal } from './terminal';
import { ticket } from './ticket';
import { title } from './title';
import { wipe } from './wipe';

import type { SubtleStyle } from '../style';

/** Subtle's styles by preset name (github.com/0xpratzyy/subtle, MIT). Its highlighter is `hop` and its whisper `wipe`, as those names were taken. */
export const SUBTLE_STYLES = {
	accent,
	block,
	bottom,
	cards,
	chip,
	cinema,
	duo,
	editorial,
	flip,
	glass,
	glide,
	haiku,
	hop,
	hype,
	impact,
	karaoke,
	magazine,
	newsroom,
	punch,
	quiet,
	serif,
	shine,
	stack,
	sticker,
	terminal,
	ticket,
	title,
	wipe,
} as const satisfies Record<string, SubtleStyle>;

export type SubtleStyleName = keyof typeof SUBTLE_STYLES;

export const SUBTLE_STYLE_NAMES = Object.keys(SUBTLE_STYLES) as SubtleStyleName[];
