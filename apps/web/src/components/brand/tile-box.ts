/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Margins go in the viewBox, not CSS: browsers round a smaller CSS-centred SVG box to
// whole pixels, so at 14px a mark got 2px on one side and 4px on the other.

export function tileViewBox(box: string, share: number): string {
  const [x, y, width, height] = box.split(/\s+/).map(Number) as [number, number, number, number];
  const side = Math.max(width, height) / share;
  const n = (value: number) => Math.round(value * 1000) / 1000;
  return `${n(x - (side - width) / 2)} ${n(y - (side - height) / 2)} ${n(side)} ${n(side)}`;
}
