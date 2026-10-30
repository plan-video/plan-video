/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Pulse animation for entities with the Generating tag, and the still fill
 * that takes its place when the wait ends in an error. Everything that draws
 * one reads it from here — the stage and the timeline both — so a node
 * waiting on a generation pulses in step wherever it is shown.
 *
 * Easing:     cubic-bezier(0.52, 0.18, 0.56, 0.88)
 * Duration:   0.6s per half-cycle (alternating)
 * Delay:      0.2s before the first transition
 * Full cycle: 0.2 delay + 0.6 forward + 0.6 reverse = 1.4s
 *             repeats ∞ for the entire gen phase (~4.5s)
 *
 * Pulses between --background (#1c1c1c) and --secondary (#292929).
 */

import { cubicBezier } from 'animejs';

import { Cache, DEFAULT_GENERATING_PULSE, Generating, GeneratingPulse, SourceError, Time } from '../traits';

import type { Entity, World } from 'koota';

const generatingEase = cubicBezier(0.52, 0.18, 0.56, 0.88);

const GEN_DELAY = 200;  // ms
const GEN_DURATION = 600;  // ms per half-cycle
const GEN_CYCLE = GEN_DURATION * 2; // full forward+reverse cycle


/**
 * Whether the node is waiting on a generation. The wait sits wherever the
 * src does: on the node itself where the paint is intrinsic (`<image>`,
 * `<video>`, `<audio>`, `<captions>`), or on one of its paints where it is
 * authored as a child (`<rect><imagePaint src /></rect>`).
 */
export function isGenerating(entity: Entity): boolean {
	if (entity.has(Generating)) return true;
	for (const fill of entity.get(Cache)?.fills ?? []) {
		if (fill.has(Generating)) return true;
	}
	return false;
}

/**
 * The reason the node's source failed, from wherever the src sits — the
 * counterpart of `isGenerating`, and what a still red fill is drawn for.
 */
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

	// Before initial delay → show base color
	const elapsed = t % (GEN_DELAY + GEN_CYCLE);
	if (elapsed < GEN_DELAY) return 0;

	const cycleT = elapsed - GEN_DELAY;
	const half = cycleT % GEN_DURATION;
	const eased = generatingEase(half / GEN_DURATION);

	// Alternate direction: first half forward, second half reverse
	return cycleT >= GEN_DURATION ? 1 - eased : eased;
}

/**
 * The fill a node whose source failed is left with: the pulse gone still and
 * turned toward red, so a node that will never fill itself in is not mistaken
 * for one that still might.
 */
export const FAILED_COLOR = '#2e1d1d';

/** The fill a node in generation is painted with this frame. */
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
