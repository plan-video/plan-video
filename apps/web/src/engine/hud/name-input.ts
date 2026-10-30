/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The header is painted on the canvas, which cannot take text input, so an <input> is placed over it. */

import { Name, RenderSurface } from '@plan.video/runtime';

import { getDocumentEditor } from '../editor';

import type { Entity, World } from 'koota';

const INPUT_STYLE = {
	position: 'absolute',
	transformOrigin: 'left top',
	font: '350 11px Inter, sans-serif',
	color: 'var(--foreground)',
	background: 'var(--input)',
	border: '1px solid var(--primary)',
	borderRadius: '2px',
	outline: 'none',
	padding: '0 0 0 2px',
	margin: '0',
	boxSizing: 'content-box',
	zIndex: '1000',
};

let mounted: { input: HTMLInputElement; entity: Entity } | null = null;

export function getMountedNameInput(): { input: HTMLInputElement; entity: Entity } | null {
	return mounted;
}

export function mountNameInput(world: World, entity: Entity): void {
	const canvas = world.get(RenderSurface)?.canvas;
	const container = canvas instanceof HTMLCanvasElement ? canvas.parentElement : null;
	if (!container) return;

	const editor = getDocumentEditor(world);
	const original = entity.get(Name)?.value ?? '';

	const input = document.createElement('input');
	input.type = 'text';
	input.value = original;
	Object.assign(input.style, INPUT_STYLE);

	input.addEventListener('input', () => {
		editor.editProperty(entity, 'name', input.value);
	});

	input.addEventListener('blur', () => {
		input.remove();
		// An empty name is not an edit.
		if (!input.value.trim()) editor.editProperty(entity, 'name', original);
		if (mounted?.input === input) mounted = null;
	});

	input.addEventListener('keydown', (event) => {
		// Canvas shortcuts listen on the window; keep typing here away from them.
		event.stopPropagation();

		if (event.key === 'Escape') {
			editor.editProperty(entity, 'name', original);
			input.blur();
		}

		if (event.key === 'Enter') {
			input.blur();
		}
	});

	container.appendChild(input);
	input.focus();
	input.select();

	mounted = { input, entity };
}

export function unmountNameInput(): void {
	mounted?.input.blur();
	mounted = null;
}
