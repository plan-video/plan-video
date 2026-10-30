/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ChildOf, ColorStop, Computed, colorToHex } from "@plan.video/runtime";

import type { Entity, World } from "koota";

export type GradientStop = {
  entity: Entity;
  /** Position along the gradient; the animated value, so 0-1 is only the usual case. */
  offset: number;
  color: number;
  opacity: number;
};

// By offset, not document order. Values come off `Computed`, which the motion system writes, so sample through `useDerived`.
export function readGradientStops(world: World, fill: Entity): GradientStop[] {
  return [...world.query(ColorStop, ChildOf(fill))]
    .map((entity) => {
      const computed = entity.get(Computed);
      return {
        entity,
        offset: computed?.stopOffset ?? 0,
        color: computed?.color ?? 0xFFFFFF,
        opacity: computed?.opacity ?? 1,
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

/** Compares two samples by value, so a resample per tick does not notify. */
export function sameGradientStops(a: GradientStop[], b: GradientStop[]): boolean {
  return a.length === b.length && a.every((stop, index) => {
    const other = b[index]!;
    return stop.entity === other.entity
      && stop.offset === other.offset
      && stop.color === other.color
      && stop.opacity === other.opacity;
  });
}

export function readStopProps(world: World, fill: Entity): { offset: number; color: string; opacity?: number }[] {
  return readGradientStops(world, fill).map((stop) => ({
    offset: stop.offset,
    color: colorToHex(stop.color),
    ...(stop.opacity === 1 ? {} : { opacity: stop.opacity }),
  }));
}
