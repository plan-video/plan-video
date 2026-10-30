/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import * as solid from 'solid-js';
import * as solidStore from 'solid-js/store';

import { JSX_RUNTIME } from './runtime';

// What the desktop compile step marks external is what is handed out here,
// so a project shares the app's solid-js instance (one reactive graph) and
// its JSX runtime — the authoring package's exports bound to this host, not
// the host-less copy in the project's node_modules.
const MODULES: Record<string, unknown> = {
	'solid-js': solid,
	'solid-js/store': solidStore,
	'@plan.video/jsx': JSX_RUNTIME,
};

/**
 * Builds the component of a bundle the host wrote itself, from the bundle's
 * text and the same modules a bundle may require. Undefined for any other
 * bundle, which is then evaluated.
 */
export type BundleReader = (code: string, require: (id: string) => unknown) => (() => unknown) | undefined;

let reader: BundleReader | undefined;

/**
 * Lets the host read its own bundles instead of evaluating them. The website
 * writes every bundle it mounts, and its Content-Security-Policy has no
 * 'unsafe-eval' for `new Function`.
 */
export function setBundleReader(next: BundleReader | undefined): void {
	reader = next;
}

/** Evaluates a compiled CommonJS bundle and returns its default export. */
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
