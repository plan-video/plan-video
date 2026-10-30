/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { BlendModeType, EffectType, ScaleModeType, StrokeJoin, StrokeCap } from '../constants';

// Opacity of whatever the entity is: a node, a paint, a stroke, a shadow, a
// gradient stop's color. Absent means opaque.
export const Opacity = trait({ value: 1 });

// How the entity composites over what is below it. Absent means source-over.
export const BlendMode = trait({ value: BlendModeType.SOURCE_OVER as BlendModeType });

// Solid color (0xRRGGBB). Its translucency, when any, is the entity's Opacity.
export const Color = trait({ value: 0 });

export const CornerRadius = trait({ value: 0 });

// Per-corner radii (CSS order: TL, TR, BR, BL).
export const MixedCornerRadius = trait({
	topLeft: 0,
	topRight: 0,
	bottomRight: 0,
	bottomLeft: 0,
});

export const Blur = trait({ value: 0 });

export const ScaleMode = trait({ value: ScaleModeType.COVER as ScaleModeType });

/** Fractions of the source; absent means the whole frame. */
export const MediaCrop = trait({
	x: 0,
	y: 0,
	width: 1,
	height: 1,
});

export const Effect = trait({
	type: EffectType.DROP_SHADOW as EffectType,
	value: 0,
});

/** Only the last one under a node counts. Sliders -100..100 (0 = unchanged); a wheel is a hue (degrees), amount (0..100) and level (-100..100). */
export const Grade = trait({
	exposure: 0,
	contrast: 0,
	highlights: 0,
	shadows: 0,
	whites: 0,
	blacks: 0,
	temperature: 0,
	tint: 0,
	saturation: 0,
	liftHue: 0,
	liftAmount: 0,
	liftLevel: 0,
	gammaHue: 0,
	gammaAmount: 0,
	gammaLevel: 0,
	gainHue: 0,
	gainAmount: 0,
	gainLevel: 0,
	look: '',
	lookAmount: 100,
});

/** Position 0-1; colour and opacity are the entity's Color and Opacity. Stop count is fixed for the fill's lifetime. */
export const ColorStop = trait({ offset: 0 });

/** On the stroke itself, so each stroke of a node has its own width. Absent means a 1px miter/butt line. */
export const StrokeStyle = trait({
	width: 1,
	join: StrokeJoin.MITER as StrokeJoin,
	cap: StrokeCap.BUTT as StrokeCap,
	miterLimit: 10,
});

// Shader paint source (document data; the compiled host lives in ShaderHost).
export const Shader = trait({
	code: '',
	uniforms: () => null as Record<string, number | number[] | string> | null,
});
