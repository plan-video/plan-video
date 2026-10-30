/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { trait } from 'koota';

import { ToolType } from '../constants';


export const Tool = trait({ value: ToolType.MOVE });

export const Selected = trait();

export const Active = trait();

export const Interactive = trait();

export const Hovering = trait();

export const Dragging = trait();

export const Timeline = trait({
	scrollX: 0,
	scrollY: 0,
	resolution: 1,
	transform: () => new DOMMatrix(),
});

/** Each drag frame places the clip at origin + delta, so nothing accumulates. A group's `start`/`end` come from its children, so they can't be derived from `authored`. */
export const ClipDragOrigin = trait({ authored: 0, start: 0, end: 0 });

// What a keyframe's time was when a drag of it began. Same reason.
export const KeyframeDragOrigin = trait({ time: 0 });

// What a clip's bounds were when a trim of it began; the edge not being
// dragged is what the other one is measured against.
export const TrimDragOrigin = trait({ start: 0, end: 0 });
