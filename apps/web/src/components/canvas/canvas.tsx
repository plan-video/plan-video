/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@plan.video/koota-solid";
import { findSceneAt, screenToWorld, worldToLocal, Library, Root } from "@plan.video/runtime";
import { CameraController, EngineCanvas } from "@/engine";
import { AUDIO_SIZE, assetSize, insertAsset } from "@/engine/insert-asset";
import { draggedAsset, fitInScene, isEmptyScene, isFittable, sceneSize, setDropScene } from "@/engine/scene-drop";
import { droppedFiles, importFiles } from "@/engine/asset-actions";
import { Toolbar } from "./toolbar";
import { CanvasSelectionMenu } from "./canvas-menu";
import { DrawOverlay } from "./draw-overlay";
import { toast } from "somoto"
import { SceneInitOverlay } from "./scene-init-overlay";
import { LayoutCropOverlay } from "./layout-crop-overlay";
import { SceneDropOverlay } from "./scene-drop-overlay";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";
import { BAR_KILLFEED_DRAG_TYPE } from "@/components/sidebar-left/bar-killfeed-panel";
import { CS2_KILLFEED_DRAG_TYPE } from "@/components/sidebar-left/cs2-killfeed-panel";
import { KILLFEED_DRAG_TYPE } from "@/components/sidebar-left/killfeed-panel";
import { insertBarKillfeeds, insertCs2Killfeeds, insertKillfeeds, parseBarKillfeedDrag, parseCs2KillfeedDrag, parseKillfeedDrag } from "@/engine/killfeed";
import { t } from "@/lib/i18n";

import type { Asset } from "@plan.video/assets";
import type { Entity } from "koota";

export function Canvas() {
  const world = useWorld();

  // With no scene under the pointer, drops land loose on the stage, not in the active scene.
  const handleDropEvent = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const library = world.get(Library);
    if (!library) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const worldPt = screenToWorld(world, event.clientX - rect.left, event.clientY - rect.top);
    const scene = findSceneAt(world, worldPt.x, worldPt.y);
    const parent = scene ?? world.get(Root)!;
    const localPt = scene ? worldToLocal(world, scene, worldPt.x, worldPt.y) : worldPt;

    const fitScene = scene && isEmptyScene(world, scene) ? scene : null;
    let fitted = false;

    const fitIntoScene = (asset: Asset, target: Entity): boolean => {
      if (!isFittable(asset)) return false;
      const to = fitInScene(sceneSize(world, target), asset);
      return !!insertAsset(world, asset, { parent: target, ...to });
    };

    const place = (asset: Asset) => {
      if (fitScene && !fitted && isFittable(asset)) {
        fitted = true;
        if (fitIntoScene(asset, fitScene)) return;
      }
      const size = assetSize(world, parent, asset) ?? AUDIO_SIZE;
      const placed = insertAsset(world, asset, {
        parent,
        x: localPt.x - size.width / 2,
        y: localPt.y - size.height / 2,
      });
      if (!placed) toast(t("Nothing to insert into"), { description: t("Open a project first.") });
    };

    const killfeed = event.dataTransfer?.getData(KILLFEED_DRAG_TYPE);
    if (killfeed) {
      const drag = parseKillfeedDrag(killfeed);
      const placed = scene ? await insertKillfeeds(world, drag.specs, { parent: scene, center: localPt, placement: drag.placement, spacing: drag.spacing }) : [];
      if (!placed.length) toast(t("Drop it on a scene"), { description: t("A killfeed goes on the video frame.") });
      return;
    }

    const cs2Killfeed = event.dataTransfer?.getData(CS2_KILLFEED_DRAG_TYPE);
    if (cs2Killfeed) {
      const drag = parseCs2KillfeedDrag(cs2Killfeed);
      const placed = scene ? await insertCs2Killfeeds(world, drag.specs, { parent: scene, center: localPt, placement: drag.placement, spacing: drag.spacing }) : [];
      if (!placed.length) toast(t("Drop it on a scene"), { description: t("A killfeed goes on the video frame.") });
      return;
    }

    const barKillfeed = event.dataTransfer?.getData(BAR_KILLFEED_DRAG_TYPE);
    if (barKillfeed) {
      const drag = parseBarKillfeedDrag(barKillfeed);
      const placed = scene ? await insertBarKillfeeds(world, drag.id, drag.specs, { parent: scene, center: localPt, placement: drag.placement, spacing: drag.spacing }) : [];
      if (!placed.length) toast(t("Drop it on a scene"), { description: t("A killfeed goes on the video frame.") });
      return;
    }

    const assetIds = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(',').filter(Boolean) ?? [];
    for (const id of assetIds) {
      const asset = library.get(id);
      if (asset) place(asset);
    }

    const files = droppedFiles(event);
    if (files.length) {
      for (const asset of await importFiles(library, files, '')) place(asset);
    }
    setDropScene(world, null, null);
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const transfer = event.dataTransfer;
    const types = transfer ? [...transfer.types] : [];
    const fromLibrary = types.includes(ASSET_DRAG_TYPE);
    const asset = fromLibrary ? draggedAsset() : null;
    const visual = fromLibrary
      ? !asset || isFittable(asset)
      : types.includes("Files") && [...(transfer?.items ?? [])].some((item) => /^(video|image)\//.test(item.type));
    if (!visual) return setDropScene(world, null, null);

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const worldPt = screenToWorld(world, event.clientX - rect.left, event.clientY - rect.top);
    const scene = findSceneAt(world, worldPt.x, worldPt.y);
    setDropScene(world, scene && isEmptyScene(world, scene) ? scene : null, asset);
  }

  const handleDragLeave = (event: DragEvent) => {
    const to = event.relatedTarget;
    if (to instanceof Node && (event.currentTarget as HTMLElement).contains(to)) return;
    setDropScene(world, null, null);
  }

  return (
    <div class="relative size-full min-h-0 bg-canvas" data-tour="canvas">
      <div
        class="absolute inset-0"
        on:drop={handleDropEvent}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
      >
        <Toolbar />
        <DrawOverlay />
        <SceneInitOverlay />
        <CanvasSelectionMenu>
          <EngineCanvas />
        </CanvasSelectionMenu>
        <SceneDropOverlay />
        <CameraController />
        <LayoutCropOverlay />
      </div>
    </div>
  );
}
