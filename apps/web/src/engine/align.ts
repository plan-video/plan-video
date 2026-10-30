/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only top-level nodes and direct children of scenes take part: a nested node's group has
// no box of its own to align against here.

import {
  Geometry,
  Group,
  Position,
  Selected,
  WorldBounds,
  entityWorldMat,
  getParentEntity,
  getParentNode,
  invert2D,
  isScene,
  store,
  transformPoint,
} from "@plan.video/runtime";
import { Or } from "koota";
import { getDocumentEditor } from "./editor";
import { syncKeyframe } from "./keyframes";

import type { Entity, World } from "koota";

export type AlignAction =
  | "align-left"
  | "align-center-horizontal"
  | "align-right"
  | "align-top"
  | "align-center-vertical"
  | "align-bottom";

export type Axis = "x" | "y";

type Box = { minX: number; minY: number; maxX: number; maxY: number };

export function getAlignableSelection(world: World): Entity[] {
  return [...world.query(Selected, Or(Geometry, Group))].filter((entity) => {
    const parent = getParentNode(entity);
    return parent === null || isScene(parent);
  });
}

function boundsOf(world: World, entity: Entity): Box {
  const bounds = store(world, WorldBounds);
  const eid = entity.id();
  return {
    minX: bounds.minX[eid] ?? 0,
    minY: bounds.minY[eid] ?? 0,
    maxX: bounds.maxX[eid] ?? 0,
    maxY: bounds.maxY[eid] ?? 0,
  };
}

function union(boxes: Box[]): Box {
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

/** The delta in the parent's space (the stage's is the view), rounded like a drag's, kept in step with any position track. */
function moveByWorldDelta(world: World, entity: Entity, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const position = entity.get(Position);
  if (!position) return;

  const inverse = invert2D(entityWorldMat(world, getParentEntity(entity)));
  const origin = transformPoint(inverse, 0, 0);
  const delta = transformPoint(inverse, dx, dy);
  const editor = getDocumentEditor(world);

  if (dx !== 0) {
    const x = Math.round(position.x + delta.x - origin.x);
    editor.editProperty(entity, "x", x);
    syncKeyframe(world, editor, entity, "x", x);
  }
  if (dy !== 0) {
    const y = Math.round(position.y + delta.y - origin.y);
    editor.editProperty(entity, "y", y);
    syncKeyframe(world, editor, entity, "y", y);
  }
}

export function alignSelection(world: World, action: AlignAction): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 2) return;

  const boxes = entities.map((entity) => boundsOf(world, entity));
  const mask = union(boxes);
  const centerX = (mask.minX + mask.maxX) / 2;
  const centerY = (mask.minY + mask.maxY) / 2;

  entities.forEach((entity, index) => {
    const box = boxes[index]!;
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;

    let targetMinX = box.minX;
    let targetMinY = box.minY;

    switch (action) {
      case "align-left": targetMinX = mask.minX; break;
      case "align-center-horizontal": targetMinX = centerX - width / 2; break;
      case "align-right": targetMinX = mask.maxX - width; break;
      case "align-top": targetMinY = mask.minY; break;
      case "align-center-vertical": targetMinY = centerY - height / 2; break;
      case "align-bottom": targetMinY = mask.maxY - height; break;
    }

    moveByWorldDelta(world, entity, targetMinX - box.minX, targetMinY - box.minY);
  });
}

export function distributeSelection(world: World, axis: Axis): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 3) return;

  const horizontal = axis === "x";
  const min = (box: Box) => (horizontal ? box.minX : box.minY);
  const size = (box: Box) => (horizontal ? box.maxX - box.minX : box.maxY - box.minY);

  const sorted = entities
    .map((entity) => ({ entity, box: boundsOf(world, entity) }))
    .sort((a, b) => min(a.box) - min(b.box));
  const mask = union(sorted.map((item) => item.box));

  const total = sorted.reduce((sum, item) => sum + size(item.box), 0);
  const gap = (size(mask) - total) / (sorted.length - 1);

  let cursor = min(mask);
  for (const { entity, box } of sorted) {
    const delta = cursor - min(box);
    moveByWorldDelta(world, entity, horizontal ? delta : 0, horizontal ? 0 : delta);
    cursor += size(box) + gap;
  }
}

export type StackEdge = "left" | "center" | "right";

/** The gap is an eighth of the typical height, as a killfeed's entries stack. */
export function stackSelection(world: World, edge: StackEdge): void {
  const entities = getAlignableSelection(world);
  if (entities.length < 2) return;

  const sorted = entities
    .map((entity) => ({ entity, box: boundsOf(world, entity) }))
    .sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX);
  const mask = union(sorted.map((item) => item.box));
  const heights = sorted.map(({ box }) => box.maxY - box.minY).sort((a, b) => a - b);
  const gap = heights[Math.floor(heights.length / 2)]! / 8;

  let cursor = sorted[0]!.box.minY;
  for (const { entity, box } of sorted) {
    const width = box.maxX - box.minX;
    const targetMinX = edge === "left" ? mask.minX
      : edge === "right" ? mask.maxX - width
      : (mask.minX + mask.maxX) / 2 - width / 2;
    moveByWorldDelta(world, entity, targetMinX - box.minX, cursor - box.minY);
    cursor += box.maxY - box.minY + gap;
  }
}
