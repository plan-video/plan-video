/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Every surface that draws the pulse (stage, timeline) reads it here, so a node pulses in step
// wherever it is shown. cubic-bezier(0.52, 0.18, 0.56, 0.88), 0.2 s delay, 0.6 s per alternating half-cycle.

import { cubicBezier } from 'animejs';

import { Cache, DEFAULT_GENERATING_PULSE, Generating, GeneratingPulse, SourceError, Time } from '../traits';

import type { Entity, World } from 'koota';

const generatingEase = cubicBezier(0.52, 0.18, 0.56, 0.88);

const GEN_DELAY = 200;  // ms
const GEN_DURATION = 600;  // ms per half-cycle
const GEN_CYCLE = GEN_DURATION * 2; // full forward+reverse cycle


/** The wait sits wherever the src does: on the node for intrinsic paints, or on a child paint (`<rect><imagePaint src /></rect>`). */
export function isGenerating(entity: Entity): boolean {
	if (entity.has(Generating)) return true;
	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (fill.has(Generating)) return true;
	}
	return false;
}

export function getSourceFailure(entity: Entity): string | undefined {
	const own = entity.get(SourceError)?.value;
	if (own) return own;
	for (const fill of entity.get(Cache)?.fills ?? []) {
		const failure = fill.get(SourceError)?.value;
		if (failure) return failure;
	}
	return undefined;
}

/** Where the pulse stands on the world's clock: 0 at rest, 1 fully lit. */
function generatingFactor(world: World): number {
	const t = world.get(Time)?.now ?? 0;

	const elapsed = t % (GEN_DELAY + GEN_CYCLE);
	if (elapsed < GEN_DELAY) return 0;

	const cycleT = elapsed - GEN_DELAY;
	const half = cycleT % GEN_DURATION;
	const eased = generatingEase(half / GEN_DURATION);

	return cycleT >= GEN_DURATION ? 1 - eased : eased;
}

/** Still and turned toward red, so a node that will never fill in isn't mistaken for one that still might. */
export const FAILED_COLOR = '#2e1d1d';

export function getGeneratingColor(world: World): string {
	const { from, to } = world.get(GeneratingPulse) ?? DEFAULT_GENERATING_PULSE;
	const factor = generatingFactor(world);
	const mix = (shift: number) => {
		const start = (from >> shift) & 0xff;
		const end = (to >> shift) & 0xff;
		return Math.round(start + (end - start) * factor);
	};

	return `rgb(${mix(16)},${mix(8)},${mix(0)})`;
}
