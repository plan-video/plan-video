/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A mark on a logo tile is drawn in an SVG the size of the tile, with its
// margin in the viewBox rather than in CSS. A smaller SVG box centred by CSS
// lands on a fraction of a pixel, and browsers round that box to whole
// pixels: at 14px a mark got 2px on one side and 4px on the other (seen on
// the hero's chips, 2026-10-24). Inside one box the size of the tile, the
// mark is drawn exactly where the maths puts it.

/** The viewBox that shows `box` (an SVG's "x y width height") centred, at `share` of the tile's width. */
export function tileViewBox(box: string, share: number): string {
  const [x, y, width, height] = box.split(/\s+/).map(Number) as [number, number, number, number];
  const side = Math.max(width, height) / share;
  const n = (value: number) => Math.round(value * 1000) / 1000;
  return `${n(x - (side - width) / 2)} ${n(y - (side - height) / 2)} ${n(side)} ${n(side)}`;
}
