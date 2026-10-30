/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Rotated resize/rotate handles need a cursor no CSS keyword can express, so
 * they are inline SVG data URLs. Everything that touches the stage cursor must
 * go through here so the last writer always wins.
 */

import { RenderSurface, Tool, ToolType } from '@plan.video/runtime';

import type { World } from 'koota';

const CORNER_SVG = `<path d='m19.7432 17.0869-4.072 4.068 2.829 2.828-8.473-.013-.013-8.47 2.841 2.842 4.075-4.068 1.414-1.415-2.844-2.842h8.486v8.484l-2.83-2.827z' fill='%23fff'/><path d='m18.6826 16.7334-4.427 4.424 1.828 1.828-5.056-.016-.014-5.054 1.842 1.841 4.428-4.422 2.474-2.475-1.844-1.843h5.073v5.071l-1.83-1.828z' fill='%23000'/>`;
const EDGE_SVG = `<path d='m9 17.9907v.005l5.997 5.996.001-3.999h1.999 2.02v4l5.98-6.001-5.98-5.999.001 4.019-2.021.002h-2l.001-4.022zm1.411.003 3.587-3.588-.001 2.587h3.5 2.521v-2.585l3.565 3.586-3.564 3.585-.001-2.585h-2.521l-3.499-.001-.001 2.586z' fill='%23fff'/><path d='m17.4971 18.9932h2.521v2.586l3.565-3.586-3.565-3.585v2.605h-2.521-3.5v-2.607l-3.586 3.587 3.586 3.586v-2.587z' fill='%23000'/>`;
const ROTATE_SVG = `<path d="M22.4789 9.45728L25.9935 12.9942L22.4789 16.5283V14.1032C18.126 14.1502 14.6071 17.6737 14.5675 22.0283H17.05L13.513 25.543L9.97889 22.0283H12.5674C12.6071 16.5691 17.0214 12.1503 22.4789 12.1031L22.4789 9.45728Z" fill="black"/><path fill-rule="evenodd" clip-rule="evenodd" d="M21.4789 7.03223L27.4035 12.9945L21.4789 18.9521V15.1868C18.4798 15.6549 16.1113 18.0273 15.649 21.0284H19.475L13.5128 26.953L7.55519 21.0284H11.6189C12.1243 15.8155 16.2679 11.6677 21.4789 11.1559L21.4789 7.03223ZM22.4789 12.1031C17.0214 12.1503 12.6071 16.5691 12.5674 22.0284H9.97889L13.513 25.543L17.05 22.0284H14.5675C14.5705 21.6896 14.5947 21.3558 14.6386 21.0284C15.1157 17.4741 17.9266 14.6592 21.4789 14.1761C21.8063 14.1316 22.1401 14.1069 22.4789 14.1032V16.5284L25.9935 12.9942L22.4789 9.45729L22.4789 12.1031Z" fill="white"/>`;

const STATIC_CURSORS = new Set(['default', 'pointer', 'cross', 'move', 'grab', 'grabbing', 'text', 'zoom-in', 'zoom-out']);

function getCursorCss(svg: string, rotation: number, turn: number, color: string, hx = 16, hy = 16): string {
	const angle = (-turn - rotation) * (Math.PI / 180);
	const dx = Math.cos(angle) - Math.sin(angle);
	const dy = Math.sin(angle) + Math.cos(angle);

	return `url("data:image/svg+xml,<svg height='32' width='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg' style='color: ${color};'><defs><filter id='shadow' y='-40%' x='-40%' width='180px' height='180%' color-interpolation-filters='sRGB'><feDropShadow dx='${dx}' dy='${dy}' stdDeviation='1.2' flood-opacity='.5'/></filter></defs><g fill='none' transform='rotate(${rotation + turn} 16 16)' filter='url(%23shadow)'>${svg.replaceAll(`"`, `'`)}</g></svg>") ${hx} ${hy}, pointer`;
}

const CURSORS: Record<string, (rotation: number, color: string) => string> = {
	'ew-resize': (rotation, color) => getCursorCss(EDGE_SVG, rotation, 0, color),
	'ns-resize': (rotation, color) => getCursorCss(EDGE_SVG, rotation, 90, color),
	'nesw-resize': (rotation, color) => getCursorCss(CORNER_SVG, rotation, 0, color),
	'nwse-resize': (rotation, color) => getCursorCss(CORNER_SVG, rotation, 90, color),
	'nwse-rotate': (rotation, color) => getCursorCss(ROTATE_SVG, rotation, 0, color),
	'nesw-rotate': (rotation, color) => getCursorCss(ROTATE_SVG, rotation, 90, color),
	'senw-rotate': (rotation, color) => getCursorCss(ROTATE_SVG, rotation, 180, color),
	'swne-rotate': (rotation, color) => getCursorCss(ROTATE_SVG, rotation, 270, color),
};

export type CursorType =
	| 'default' | 'pointer' | 'cross' | 'grab' | 'grabbing' | 'move' | 'text'
	| 'zoom-in' | 'zoom-out'
	| 'ew-resize' | 'ns-resize' | 'nesw-resize' | 'nwse-resize'
	| 'nesw-rotate' | 'nwse-rotate' | 'swne-rotate' | 'senw-rotate';

// Cached so an unchanged cursor's SVG data URL is not rebuilt on every write.
const current = new WeakMap<HTMLCanvasElement, string>();

export function updateCursor(world: World, type: CursorType, rotation = 0, color = 'black'): void {
	const canvas = world.get(RenderSurface)?.canvas;
	if (!(canvas instanceof HTMLCanvasElement)) return;

	const hash = `${type}-${rotation}-${color}`;
	if (current.get(canvas) === hash) return;
	current.set(canvas, hash);

	canvas.style.cursor = STATIC_CURSORS.has(type)
		? type
		: CURSORS[type]?.(rotation * 180 / Math.PI, color) ?? 'default';
}

/**
 * The resting cursor: what the pointer is over may override it (the move
 * tool's handles, see `updateResizeCursor`). `inputSystem` watches this to take
 * the cursor back whenever the tool's answer changes.
 */
const TOOL_CURSORS: Record<ToolType, { idle: CursorType; pressed?: CursorType }> = {
	[ToolType.MOVE]: { idle: 'default' },
	[ToolType.HAND]: { idle: 'grab', pressed: 'grabbing' },
	[ToolType.BLADE]: { idle: 'cross' },
	[ToolType.SCENE]: { idle: 'cross' },
	[ToolType.RECT]: { idle: 'cross' },
	[ToolType.TEXT]: { idle: 'cross' },
	[ToolType.TEXT_EDIT]: { idle: 'text' },
};

export function getToolCursor(world: World, pressed = false): CursorType {
	const cursor = TOOL_CURSORS[world.get(Tool)?.value ?? ToolType.MOVE];
	return pressed ? cursor.pressed ?? cursor.idle : cursor.idle;
}
