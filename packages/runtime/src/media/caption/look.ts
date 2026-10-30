/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PaintType, StrokeCap, StrokeJoin } from '../../constants';
import { Blur, Caption, ChildOf, Color, ColorStop, Offset, Opacity, Paint, Rotation, Scale, Shadow, Source, Stroke, StrokeStyle, TextStyle } from '../../traits';
import { createEntity, deleteEntity } from '../../actions/entities';
import { appendChild } from '../../actions/hierarchy';
import { getTextLook } from '../../fonts/looks';
import { loadWebFont } from '../../fonts/utils';
import { parseColor } from '../../utils/color';
import { store } from '../../world/store';

import type { Entity, World } from 'koota';

/** The preset's own outlines and shadows go and the look's are made, sized to the font; what the file authors itself (having a Source) stays. */
export function wearCaptionLook(world: World, entity: Entity): void {
	const look = getTextLook(entity.get(Caption)?.look);
	if (!look) return;

	for (const child of [...world.query(ChildOf(entity))]) {
		if (child.has(Source)) continue;
		if (child.has(Stroke) || child.has(Shadow)) deleteEntity(world, child);
	}

	const size = store(world, TextStyle).fontSize[entity.id()] ?? 62;
	const em = (value: number) => value * size;

	if (typeof look.fill !== 'string') {
		const gradient = createEntity(world);
		gradient.add(Paint);
		gradient.set(Paint, { value: PaintType.LINEAR_GRADIENT });
		gradient.add(Rotation);
		gradient.set(Rotation, { value: 90 });
		gradient.add(Scale);
		gradient.set(Scale, { x: 1, y: 1 });
		appendChild(world, gradient, entity);
		for (const [offset, color] of [[0, look.fill.from], [1, look.fill.to]] as const) {
			const stop = createEntity(world);
			stop.add(ColorStop);
			stop.set(ColorStop, { offset });
			stop.add(Color);
			stop.set(Color, { value: parseColor(color) ?? 0xFFFFFF });
			stop.add(Opacity);
			stop.set(Opacity, { value: 1 });
			appendChild(world, stop, gradient);
		}
	}

	for (const outline of look.strokes ?? []) {
		const stroke = createEntity(world);
		stroke.add(Stroke);
		stroke.add(Paint);
		stroke.set(Paint, { value: PaintType.SOLID });
		stroke.add(Color);
		stroke.set(Color, { value: parseColor(outline.color) ?? 0x000000 });
		stroke.add(StrokeStyle);
		stroke.set(StrokeStyle, { width: em(outline.width), join: StrokeJoin.ROUND, cap: StrokeCap.ROUND });
		appendChild(world, stroke, entity);
	}

	for (const cast of look.shadows ?? []) {
		const shadow = createEntity(world);
		shadow.add(Shadow);
		shadow.add(Color);
		shadow.set(Color, { value: parseColor(cast.color) ?? 0x000000 });
		shadow.add(Opacity);
		shadow.set(Opacity, { value: cast.opacity ?? 1 });
		shadow.add(Blur);
		shadow.set(Blur, { value: em(cast.blur) });
		shadow.add(Offset);
		shadow.set(Offset, { x: em(cast.x ?? 0), y: em(cast.y ?? 0) });
		appendChild(world, shadow, entity);
	}

	void loadWebFont(world, look.font).catch(() => {});
}
