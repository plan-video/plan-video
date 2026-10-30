/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Rebuilding a decoder on a copy means a seek and a blank frame while it lands; moving the primed
// handle lets the copy draw its first frame from the cache already warm for it.

import { AssetId, VideoDecoderHandle } from '../traits';
import { getEntityChildren } from '../queries/hierarchy';

import type { Entity, World } from 'koota';

/**
 * For a split: the copy renders next and the original can afford to rebuild. Both halves read the
 * same source frames at the same scene frames, so the decoder arrives already seeked. Audio is left
 * alone: it is scheduled against the audio graph rather than seeked, and both halves are heard.
 */
export function handOffDecoders(world: World, from: Entity, to: Entity): void {
	handOff(from, to);

	// Paired by position (the copy was rendered from the original's authored form); subtrees that
	// disagree aren't paired, as a decoder on the wrong node would only be thrown away.
	const ours = getEntityChildren(world, from);
	const theirs = getEntityChildren(world, to);
	if (ours.length !== theirs.length) return;

	for (const [index, child] of ours.entries()) {
		handOffDecoders(world, child, theirs[index]!);
	}
}

function handOff(from: Entity, to: Entity): void {
	// The decoder is only worth anything to a node playing what it decodes.
	if (from.get(AssetId)?.value !== to.get(AssetId)?.value) return;

	const video = from.get(VideoDecoderHandle);
	if (video) {
		// Nulled rather than removed: the trait's onRemove disposes what it
		// finds there, and what it would find is the decoder being handed on.
		from.set(VideoDecoderHandle, null);
		to.get(VideoDecoderHandle)?.dispose();
		to.add(VideoDecoderHandle);
		to.set(VideoDecoderHandle, video);
	}
}
