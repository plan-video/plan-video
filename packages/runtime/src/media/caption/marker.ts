/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, FontStyle, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Blur, Caption, Color, Offset, Opacity, Shadow } from '../../traits';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { colorToHex } from '../../utils/color';
import { textRangeBounds } from '../../utils/text';
import { LineCaptionDecoder, easeOutAt } from './line';

import type { Entity, World } from 'koota';
import type { Token } from '../../utils/text';
import type { CaptionPresetStyle } from './types';

/** The marker's color until the file gives it one. */
export const MARKER_COLOR = 0x4ADE80;
const MARKER_OPACITY = 0.9;
const SWEEP_SECONDS = 0.2;

export const MARKER_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '800',
	fontSize: 64,
	fontStyle: FontStyle.NORMAL,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.ORIGINAL,
	leading: 1.2,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class MarkerCaptionDecoder extends LineCaptionDecoder {
	public readonly type = CaptionType.MARKER;
	protected readonly grouping = { length: 16 };
	protected readonly size = { width: 760, height: 120 };
	protected readonly textStyle = MARKER_TEXT_STYLE;

	/** A soft shadow, so white glyphs keep their edge over the marker and over bright footage. */
	protected decorate(world: World, entity: Entity): void {
		const shadow = createEntity(world);
		shadow.add(Shadow);
		shadow.add(Color);
		shadow.set(Color, { value: 0x000000 });
		shadow.add(Opacity);
		shadow.set(Opacity, { value: 0.45 });
		shadow.add(Blur);
		shadow.set(Blur, { value: 10 });
		shadow.add(Offset);
		shadow.set(Offset, { x: 0, y: 3 });
		appendChild(world, shadow, entity);
	}

	protected markSpoken(): void {}

	protected underlay(_world: World, entity: Entity, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, lines: readonly Token[][]): void {
		if (!this.spoken) return;
		const bounds = textRangeBounds(lines, this.spoken);
		if (!bounds) return;

		const pad = bounds.height * 0.1;
		const progress = easeOutAt(this.time - this.spokenStart, SWEEP_SECONDS);
		const width = (bounds.width + pad * 2) * progress;
		if (width <= 0) return;
		const height = bounds.height * 0.62;

		ctx.globalAlpha *= MARKER_OPACITY;
		ctx.beginPath();
		ctx.roundRect(bounds.x - pad, bounds.y + bounds.height * 0.26, width, height, height * 0.18);
		ctx.fillStyle = colorToHex(entity.get(Caption)?.colors?.[0] ?? MARKER_COLOR);
		ctx.fill();
	}
}
