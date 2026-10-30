/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { CaptionType, FontStyle, PaintType, TextAlign, TextBaseline, TextCase } from '../../constants';
import { Caption, Color, Paint } from '../../traits';
import { createEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { colorToHex } from '../../utils/color';
import { textRangeBounds } from '../../utils/text';
import { LineCaptionDecoder, easeOutAt } from './line';

import type { Entity, World } from 'koota';
import type { Token } from '../../utils/text';
import type { CaptionPresetStyle } from './types';

/** The box's color until the file gives it one. */
export const BOX_COLOR = 0xFFD60A;
const INK = 0x111111;
const POP_SECONDS = 0.12;

export const BOX_TEXT_STYLE = {
	fontFamily: 'Montserrat',
	fontWeight: '800',
	fontSize: 68,
	fontStyle: FontStyle.NORMAL,
	textAlign: TextAlign.CENTER,
	textBaseline: TextBaseline.MIDDLE,
	textCase: TextCase.UPPER,
	leading: 1.2,
	letterSpacing: undefined,
} as const satisfies CaptionPresetStyle;

export class BoxCaptionDecoder extends LineCaptionDecoder {
	public readonly type = CaptionType.BOX;
	protected readonly grouping = { length: 14 };
	protected readonly size = { width: 760, height: 120 };
	protected readonly textStyle = BOX_TEXT_STYLE;

	protected markSpoken(world: World, range: Entity, entity: Entity): void {
		// A look keeps its own colours on the box; its outline is what reads there.
		if (entity.get(Caption)?.look) return;
		const fill = createEntity(world);
		fill.add(Paint);
		fill.set(Paint, { value: PaintType.SOLID });
		fill.add(Color);
		fill.set(Color, { value: INK });
		appendChild(world, fill, range);
	}

	protected underlay(_world: World, entity: Entity, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, lines: readonly Token[][]): void {
		if (!this.spoken) return;
		const bounds = textRangeBounds(lines, this.spoken);
		if (!bounds) return;

		const padX = bounds.height * 0.12;
		const padY = bounds.height * 0.04;
		const x = bounds.x - padX;
		const y = bounds.y + padY;
		const width = bounds.width + padX * 2;
		const height = bounds.height - padY * 2;
		const scale = 0.9 + 0.1 * easeOutAt(this.time - this.spokenStart, POP_SECONDS);

		ctx.translate(x + width / 2, y + height / 2);
		ctx.scale(scale, scale);
		ctx.beginPath();
		ctx.roundRect(-width / 2, -height / 2, width, height, height * 0.16);
		ctx.fillStyle = colorToHex(entity.get(Caption)?.colors?.[0] ?? BOX_COLOR);
		ctx.fill();
	}
}
