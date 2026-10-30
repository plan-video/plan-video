/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { FontStyle } from '../constants';

export type FontSource = {
	/** @example 'Arial' */
	family: string;
	/** @example url(arial.ttf) */
	source: string;
	/** @example 'italic' */
	style?: FontStyle;
	/** @example '400' */
	weight?: string;
};

export type FontSources = {
	family: string;
	variants: FontSource[];
};
