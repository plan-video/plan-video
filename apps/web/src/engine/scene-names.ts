/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useTrait, useWorld } from '@plan.video/koota-solid';

import { store } from '@/init';

import { SceneNames } from './traits';

import type { Accessor } from 'solid-js';
import type { World } from 'koota';

const saved = store.define<boolean>('canvas.alwaysShowNames', false);

export function getSavedAlwaysShowNames(): boolean {
	return saved.value === true;
}

export function setAlwaysShowNames(world: World, always: boolean): void {
	world.set(SceneNames, { always });
	saved.value = always;
}

export function useAlwaysShowNames(): Accessor<boolean> {
	const world = useWorld();
	const names = useTrait(world, SceneNames);
	return () => names()?.always ?? false;
}
