/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Entity, World } from 'koota';
import type { CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import type { WordGroup } from '@plan.video/assets';
import type { CaptionPacing } from './utils';

/** Complete on purpose: every field is spelled out (even as `undefined`) so switching presets resets what the last one set. */
export type CaptionPresetStyle = {
	fontFamily: string;
	fontWeight: string;
	fontSize: number;
	fontStyle: FontStyle;
	textAlign: TextAlign;
	textBaseline: TextBaseline;
	textCase: TextCase;
	leading: number;
	letterSpacing: number | undefined;
};

export interface CaptionDecoder {
	readonly type: CaptionType;
	groups: WordGroup[];
	ready: boolean;
	/** Settles when the first read of the transcript does; `ready` turns true with it. */
	loaded: Promise<void>;
	styled: boolean;
	applyStyles(world: World, entity: Entity): boolean;
	reposition(world: World, entity: Entity): boolean;
	seekTo(world: World, entity: Entity, relativeTime: number): void;
	draw(world: World, entity: Entity): void;
	reload(): Promise<void>;
	/** The author's `words`, `chars` and `linger`; what is unset is the preset's. */
	pacing: CaptionPacing;
	repace(pacing: CaptionPacing): Promise<void>;
	dispose(): void;
}
