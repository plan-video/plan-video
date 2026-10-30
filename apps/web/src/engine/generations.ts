/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A failed generation stays in the library as a partial in error, and its key resolves to that failure
// this session and the next; removing the record is what asks again.

import { isAssetRef } from '@plan.video/jsx';
import { authoredElement } from '@plan.video/reconciler';
import {
	Caption, Generating, GenerationRequest, PendingSource, SourceError, TranscriptionRequest,
} from '@plan.video/runtime';

import type { AssetLibrary, PartialAsset } from '@plan.video/assets';
import type { World } from 'koota';

export async function retryGeneration(world: World, library: AssetLibrary, partial: PartialAsset): Promise<void> {
	await library.remove([partial]);

	for (const entity of world.query(SourceError)) {
		if (!entity.get(SourceError)!.generated) continue;
		const authored = authoredElement(entity);

		if (!authored) continue;

		const src = authored.props.src;
		entity.remove(SourceError, PendingSource, Generating);

		if (isAssetRef(src)) {
			entity.add(GenerationRequest);
			entity.set(GenerationRequest, { ref: src });
		} else if (entity.has(Caption)) {
			entity.add(TranscriptionRequest);
			entity.set(TranscriptionRequest, { seed: Number(authored.props.seed) || 0 });
		}
	}
}
