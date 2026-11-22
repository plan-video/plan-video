/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setFont } from '../engine';

import type { Ctx, FontSpec, Paint } from '../engine';

/** Text at a baseline, outlined (centred on the glyph edge, as in SVG) under or over its fill. */
export function paintText(
	ctx: Ctx,
	text: string,
	x: number,
	y: number,
	o: { font: FontSpec; fs: number; ls?: number; fill?: Paint; stroke?: string; strokeWidth?: number; strokeOver?: boolean },
): void {
	setFont(ctx, o.font, o.fs, o.ls ?? 0);
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	ctx.lineJoin = 'round';
	const outline = () => {
		if (!o.stroke || !o.strokeWidth) return;
		ctx.lineWidth = o.strokeWidth;
		ctx.strokeStyle = o.stroke;
		ctx.strokeText(text, x, y);
	};
	if (!o.strokeOver) outline();
	if (o.fill) {
		ctx.fillStyle = o.fill;
		ctx.fillText(text, x, y);
	}
	if (o.strokeOver) outline();
}
