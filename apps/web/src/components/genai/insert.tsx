/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Ai, getNextName, Name, Root } from "@plan.video/runtime";
import { assetName } from "@plan.video/assets";
import { findEmptyPlacement } from "@/engine/placement";
import { t } from "@/lib/i18n";
import { toast } from "somoto";

import type { AssetRef } from "@plan.video/jsx";
import type { DocumentEditor } from "@/engine/editor";
import type { Entity, World } from "koota";

const GAP = 40;

/** A declaration is keyed by its spec, so a fresh seed makes a new take. */
export const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export interface GenerationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Each variant declares its own source, so a batch is separate takes rather than one asset shown four times.
export function insertGenerated(
  world: World,
  editor: DocumentEditor,
  size: { width: number; height: number },
  element: (box: GenerationBox, index: number) => unknown,
  count = 1,
  sources: AssetRef[] = [],
): Entity[] {
  const root = world.get(Root);
  const inserted: Entity[] = [];

  if (root) {
    const totalWidth = count * size.width + (count - 1) * GAP;
    const center = findEmptyPlacement(world, totalWidth, size.height, GAP);
    const left = center.x - totalWidth / 2;
    const y = Math.round(center.y - size.height / 2);

    for (let index = 0; index < count; index++) {
      const x = Math.round(left + index * (size.width + GAP));
      const [entity] = editor.insertElement(root, () => element({ x, y, ...size }, index));
      if (entity) {
        inserted.push(entity);
        const ref = sources[index];
        if (ref) nameAfterGeneration(world, editor, entity, ref);
      }
    }
  }

  if (!inserted.length) {
    toast(t("Could not add the generation"), {
      description: t("Open a project to generate into."),
    });
    return inserted;
  }

  editor.select(inserted);
  return inserted;
}

// The resolution is memoized by ref, so this rides the element's own src request; a failure is the
// asset system's to surface (see SourceError).
function nameAfterGeneration(world: World, editor: DocumentEditor, entity: Entity, ref: AssetRef): void {
  world.get(Ai)?.resolve(ref).then((asset) => {
    if (!entity.isAlive() || entity.get(Name)?.value) return;
    editor.editProperty(entity, 'name', getNextName(world, assetName(asset).replace(/\.[^.]+$/, '')));
  }).catch(() => undefined);
}
