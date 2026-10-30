/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { store } from '../world/store';
import { EffectType } from '../constants';
import { Hidden, Effect, Computed, Cache } from '../traits';
import { getPreviewScale } from '../queries/camera';
import { adjustingLayers } from '../systems/transform';

import type { Entity, World } from 'koota';

const EPSILON = 1e-4;

/** Null if hidden or no-op. */
export function effectFilter(world: World, sub: Entity): string | null {
	if (sub.has(Hidden)) return null;

	const value = store(world, Computed).value[sub.id()]!;
	const type = store(world, Effect).type[sub.id()] ?? 0;

	if (type === EffectType.LAYER_BLUR) {
		const clamped = Math.max(0, value);
		return clamped > EPSILON ? `blur(${clamped * getPreviewScale(world)}px)` : null;
	}
	if (type === EffectType.BRIGHTNESS) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `brightness(${clamped})` : null;
	}
	if (type === EffectType.CONTRAST) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `contrast(${clamped})` : null;
	}
	if (type === EffectType.GRAYSCALE) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `grayscale(${clamped})` : null;
	}
	if (type === EffectType.HUE_ROTATION) {
		return Math.abs(value) > EPSILON ? `hue-rotate(${value}deg)` : null;
	}
	if (type === EffectType.INVERT) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `invert(${clamped})` : null;
	}
	if (type === EffectType.SATURATE) {
		const clamped = Math.min(1, Math.max(0, value));
		return Math.abs(clamped - 1) > EPSILON ? `saturate(${clamped})` : null;
	}
	if (type === EffectType.SEPIA) {
		const clamped = Math.min(1, Math.max(0, value));
		return clamped > EPSILON ? `sepia(${clamped})` : null;
	}
	return null;
}

export function buildEffects(world: World, entity: Entity): string | null {
	const parts: string[] = [];

	const blurVal = store(world, Computed).blur[entity.id()] ?? 0;
	// A filter radius is in canvas pixels, which a reduced preview has fewer of.
	if (blurVal > EPSILON) {
		parts.push(`blur(${blurVal * getPreviewScale(world)}px)`);
	}

	const cache = store(world, Cache);
	const effects = cache.effects[entity.id()] ?? [];
	for (const effect of effects) {
		const f = effectFilter(world, effect);
		if (f) parts.push(f);
	}

	// An adjustment layer's effects filter the clip it acts on, while it lasts.
	for (const layer of adjustingLayers(world, entity)) {
		for (const effect of cache.effects[layer.id()] ?? []) {
			const f = effectFilter(world, effect);
			if (f) parts.push(f);
		}
	}

	if (parts.length === 0) return null;

	return parts.join(' ');
}
