/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Tickers } from '@plan.video/runtime';

import { createRuntimeDocument } from './document';
import { evaluate } from './evaluate';
import { collectInspect } from './inspect';
import { renderProject } from './renderer';

import type { World } from 'koota';
import type { InspectEntry } from './inspect';

export interface Mount {
	/** Tears down the reactive graph and every entity the project rendered. */
	dispose(): void;
	/** Die with the mount: a remount evaluates the module again and declares them afresh. */
	inspect: InspectEntry[];
}

/**
 * Throws if the bundle does not evaluate, its root is not a <stage>, or `world` still has a
 * mounted project (the stage is a singleton); nothing is left in the world when it throws.
 */
export function mount(code: string, world: World): Mount {
	const { result: component, entries } = collectInspect(() => evaluate(code));
	const document = createRuntimeDocument(world);

	let dispose: () => void;
	try {
		dispose = renderProject(component, document);
	} catch (error) {
		document.dispose();
		throw error;
	}

	const advance = () => document.advanceTicker();
	world.get(Tickers)?.add(advance);

	return {
		inspect: entries,
		dispose() {
			world.get(Tickers)?.delete(advance);
			// Solid's universal render disposer only drops the reactive graph;
			// the document owns the entities.
			dispose();
			document.dispose();
		},
	};
}
