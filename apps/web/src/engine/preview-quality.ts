/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { PreviewQuality } from '@plan.video/runtime';
import { useTrait, useWorld } from '@plan.video/koota-solid';

import { store } from '@/init';
import { msg } from '@/lib/i18n';

import type { Accessor } from 'solid-js';
import type { World } from 'koota';

export type PreviewQualityOption = {
	value: number;
	label: string;
	shortcut?: string;
};

export const PREVIEW_QUALITIES: readonly PreviewQualityOption[] = [
	{ value: 1, label: msg('Full'), shortcut: '⌘J' },
	{ value: 0.75, label: '75%' },
	{ value: 0.5, label: '50%', shortcut: '⇧⌘J' },
	{ value: 0.25, label: '25%' },
];

const saved = store.define<number>('preview.quality', 1);

export function getSavedPreviewQuality(): number {
	const value = saved.value;
	return PREVIEW_QUALITIES.some((option) => option.value === value) ? value : 1;
}

export function setPreviewQuality(world: World, value: number): void {
	world.set(PreviewQuality, { value });
	saved.value = value;
}

export function getPreviewQualityOption(value: number): PreviewQualityOption {
	return PREVIEW_QUALITIES.find((option) => option.value === value) ?? PREVIEW_QUALITIES[0]!;
}

export function usePreviewQuality(): Accessor<number> {
	const world = useWorld();
	const quality = useTrait(world, PreviewQuality);
	return () => quality()?.value ?? 1;
}
