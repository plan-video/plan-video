/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Camera, Root, type Camera2D } from '@plan.video/runtime';
import { useTrait, useWorld } from '@plan.video/koota-solid';

import type { Accessor } from 'solid-js';

/** Write it with the operations in ../camera, never by mutating the record. */
export function useCamera(): Accessor<Camera2D | undefined> {
	const world = useWorld();
	return useTrait(world.get(Root)!, Camera);
}

/** 1 = 100%. */
export function useCameraScale(): Accessor<number> {
	const camera = useCamera();
	return () => {
		const { a = 1, b = 0 } = camera() ?? {};
		return Math.hypot(a, b);
	};
}
