/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as solid from 'solid-js';
import * as solidStore from 'solid-js/store';

import { JSX_RUNTIME } from './runtime';

// Handed to bundles so a project shares the app's solid-js instance (one reactive graph)
// and the host-bound JSX runtime, not the host-less copies in its own node_modules.
const MODULES: Record<string, unknown> = {
	'solid-js': solid,
	'solid-js/store': solidStore,
	'@plan.video/jsx': JSX_RUNTIME,
};

/** Builds a bundle the host wrote itself; undefined for any other bundle, which is then evaluated. */
export type BundleReader = (code: string, require: (id: string) => unknown) => (() => unknown) | undefined;

let reader: BundleReader | undefined;

/** The website's CSP has no 'unsafe-eval' for `new Function`, so it reads its own bundles instead. */
export function setBundleReader(next: BundleReader | undefined): void {
	reader = next;
}

export function evaluate(code: string): () => unknown {
	const module = { exports: {} as { default?: unknown } };

	const require = (id: string): unknown => {
		const resolved = MODULES[id];
		if (!resolved) throw new Error(`Cannot import "${id}" — only solid-js and @plan.video/jsx are available.`);
		return resolved;
	};

	const read = reader?.(code, require);
	if (read) return read;

	new Function('require', 'module', 'exports', code)(require, module, module.exports);

	const component = module.exports.default;
	if (typeof component !== 'function') {
		throw new Error('The entry file must export a component as default.');
	}
	return component as () => unknown;
}
