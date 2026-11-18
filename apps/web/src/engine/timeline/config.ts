/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const MIN_CLIP_HEIGHT = 28;
export const MAX_CLIP_HEIGHT = 116;
export const KEYFRAME_TRACK_HEIGHT = 32;
export const TARGET_MAJOR_TICK_DISTANCE = 160;

export const TIMELINE_RESOLUTION_RANGE = [0.03, 120] as const;
export const DEFAULT_TIMELINE_RESOLUTION = 1 / 0.7;
export const DEFAULT_CLIP_HEIGHT = 40;

export const TIMELINE_PADDING_LEFT = 8;

export const WHEEL_LINE_HEIGHT = 16;
export const WHEEL_PAGE_HEIGHT = 600;

export const ZOOM_DELTA_CLAMP = 50;
export const ZOOM_SENSITIVITY = 0.01;

export const SCROLL_X_SENSITIVITY = 2;

/** How near, in pixels, a dragged edge has to be to snap to something. */
export const SNAP_DISTANCE = 10;

export const TRIM_HANDLE_WIDTH = 10;

export const CLICK_DISTANCE_THRESHOLD = 5;
export const DOUBLE_CLICK_THRESHOLD = 500;

export const TIMELINE_BAR_HEIGHT = 36;
/** Fits three icon buttons: a keyframe row's previous, add and next. */
export const TIMELINE_GUTTER_WIDTH = 76;

export const RULER_HEIGHT = 26;
/** Kept clear for the scrollbar: rows are cut off above it, so the bar never covers a clip. */
export const SCROLLBAR_LANE = 12;
export const RULER_TICK_HEIGHT_MAJOR = 10;
export const RULER_TICK_HEIGHT_MINOR = 4;
export const RULER_LABEL_X = 6;
export const RULER_LABEL_Y = 10;

/** Kept clear above and below a row's clips, so clips on neighbouring rows never touch. */
export const CLIP_INSET = 2;
/** How strongly a row's band is drawn. The layer column beside the canvas draws the same band (`Lane`), so they share these. */
export const LANE_OPACITY = { rest: 0.45, nested: 0.6, hovered: 0.8, selected: 1 } as const;
export const CLIP_CORNER_RADIUS = 6;
export const CLIP_FONT = '500 11px Geist, Inter, sans-serif';
/** Clear of the trim handle a selected clip draws at its edge. */
export const CLIP_LABEL_X = 10;
export const CLIP_LABEL_HEIGHT = 16;
