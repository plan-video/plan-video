/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { AssetId, Cache, Paint, PaintType, getIntrinsicPaint } from "@plan.video/runtime";
import { useSelection } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";

import type { Asset } from "@plan.video/assets";
import type { Entity } from "koota";

type MediaPaint = PaintType.IMAGE | PaintType.VIDEO;

export interface SelectedNode {
  entity: Entity;
  source: Entity;
  paint?: MediaPaint;
}

export interface BoundNode extends SelectedNode {
  asset: Asset;
}

function isMediaPaint(paint: PaintType | undefined): paint is MediaPaint {
  return paint === PaintType.IMAGE || paint === PaintType.VIDEO;
}

// A node that paints no media is still its own source element: an `<audio>` carries its `src` like any other.
function resolve(entity: Entity): SelectedNode {
  const intrinsic = getIntrinsicPaint(entity);
  if (isMediaPaint(intrinsic)) return { entity, source: entity, paint: intrinsic };

  for (const fill of entity.get(Cache)?.fills ?? []) {
    const paint = fill.get(Paint)?.value;
    if (isMediaPaint(paint)) return { entity, source: fill, paint };
  }

  return { entity, source: entity };
}

export function useMediaSelection() {
  const library = useLibrary();
  const { nodes } = useSelection();

  const selected = createMemo(() => nodes().map(resolve));

  const painted = (paint: MediaPaint) =>
    createMemo(() => selected().filter((node) => node.paint === paint).map((node) => node.source));

  const imageNodes = painted(PaintType.IMAGE);
  const videoNodes = painted(PaintType.VIDEO);

  const sources = createMemo(() => selected().map((node) => node.source));

  const bound = createMemo(() => {
    const lib = library();
    if (!lib) return [];

    const entries: BoundNode[] = [];
    for (const node of selected()) {
      const id = node.source.get(AssetId)?.value;
      const asset = id ? lib.get(id) : undefined;
      if (asset) entries.push({ ...node, asset });
    }
    return entries;
  });

  const images = createMemo(() => bound().filter((entry) => entry.asset.type === "IMAGE"));

  return { bound, images, imageNodes, videoNodes, sources };
}
