/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';

import { isSequenceListing, sortFrames } from './probe';

describe('sortFrames', () => {
	it('plays a folder that also holds a hidden file from its first real frame', () => {
		const names = ['frame-10.webp', '.DS_Store', 'frame-2.webp', 'frame-1.webp'];
		expect(isSequenceListing(names)).toBe(true);
		expect(sortFrames(names.map((name) => ({ name }))).map((frame) => frame.name)).toEqual([
			'frame-1.webp',
			'frame-2.webp',
			'frame-10.webp',
		]);
	});
});
