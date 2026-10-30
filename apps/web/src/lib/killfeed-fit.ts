/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Fitting a killfeed entry into a set width, so every entry of a feed is
// the same size outside however long its names are: room to spare goes
// around the weapon, and names that don't fit get a little smaller, then
// cut short.

/** A name as it is drawn: perhaps cut short, at `size`, `width` wide. */
export type FittedName = { text: string; size: number; width: number };

/** Names get no smaller than this share of their size before they are cut short. */
const SMALLEST = 0.8;

/**
 * `text` at `size` in no more than `max` wide, measured with `font(size)`:
 * as it is when it fits, else smaller, else cut short with an ellipsis.
 */
export function fitName(ctx: CanvasRenderingContext2D, font: (size: number) => string, text: string, size: number, max: number): FittedName {
  ctx.font = font(size);
  let width = ctx.measureText(text).width;
  if (width <= max) return { text, size, width };
  const smaller = Math.max(size * SMALLEST, (size * max) / width);
  ctx.font = font(smaller);
  width = ctx.measureText(text).width;
  if (width <= max) return { text, size: smaller, width };
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut.trimEnd()}…`).width > max) cut = cut.slice(0, -1);
  const shown = `${cut.trimEnd()}…`;
  return { text: shown, size: smaller, width: ctx.measureText(shown).width };
}

/**
 * How `room` is shared between two names `a` and `b` wide that don't both
 * fit: a short one keeps its width and the other has the rest, else half each.
 */
export function shareRoom(room: number, a: number, b: number): [number, number] {
  const half = room / 2;
  if (a <= half) return [a, room - a];
  if (b <= half) return [room - b, b];
  return [half, half];
}
