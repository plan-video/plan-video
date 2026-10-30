/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from 'solid-js';

import type { Entity } from 'koota';

/** Not the caption element: selecting a word must not select the captions layer. */
export type CaptionWordSelection = {
	entity: Entity;
	indices: ReadonlySet<number>;
};

const [selection, setSelection] = createSignal<CaptionWordSelection | null>(null);

export function captionWordSelection(): CaptionWordSelection | null {
	return selection();
}

export function isSoleCaptionWord(entity: Entity, index: number): boolean {
	const current = selection();
	return !!current && current.entity === entity && current.indices.size === 1 && current.indices.has(index);
}

/** Returns false when the pick is already that. */
export function setCaptionWordSelection(entity: Entity, indices: readonly number[]): boolean {
	const next = new Set(indices);
	const current = selection();
	if (
		current?.entity === entity
		&& current.indices.size === next.size
		&& [...next].every((index) => current.indices.has(index))
	) {
		return false;
	}

	setSelection(next.size > 0 ? { entity, indices: next } : null);
	return true;
}

/** A word on another caption replaces the pick. */
export function addCaptionWord(entity: Entity, index: number): boolean {
	const current = selection();
	if (current?.entity === entity) {
		if (current.indices.has(index)) return false;
		const indices = new Set(current.indices);
		indices.add(index);
		setSelection({ entity, indices });
		return true;
	}

	setSelection({ entity, indices: new Set([index]) });
	return true;
}

export function clearCaptionWordSelection(): void {
	if (selection() !== null) setSelection(null);
}
