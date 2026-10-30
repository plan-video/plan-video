/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What a compiled bundle sees as "@plan.video/jsx": the authoring package with the host-bound
// implementations layered over it. Order matters: the renderer bindings must come last so they win.

import * as authoring from '@plan.video/jsx';

import * as elements from './elements';
import { __inspect } from './inspect';
import {
	createComponent,
	createElement,
	createTextNode,
	effect,
	insert,
	insertNode,
	memo,
	mergeProps,
	render,
	setProp,
	spread,
	use,
	useResolution,
	useTicker,
} from './renderer';

export const JSX_RUNTIME = {
	...authoring,
	...elements,
	render,
	effect,
	memo,
	createComponent,
	createElement,
	createTextNode,
	insertNode,
	insert,
	spread,
	setProp,
	mergeProps,
	use,
	useResolution,
	useTicker,
	__inspect,
};
