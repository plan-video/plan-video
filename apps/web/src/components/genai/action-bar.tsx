/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import { createMemo, createSignal, Show } from "solid-js";
import { RemoveBackgroundDialog } from "./remove-background-dialog";
import { useAutoCaptions } from "./use-auto-captions";
import { useMediaSelection } from "./selection";
import { useTransforms } from "./use-transforms";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { useDerived, useSelection } from "@/engine/hooks";
import { undoEdit } from "@/engine/input/shortcuts";
import { bringRectIntoView } from "@/engine/camera";
import { fitSceneToClip, sceneFitFor } from "@/engine/scene-size";
import { getDocumentEditor } from "@/engine/editor";
import { t } from "@/lib/i18n";
import { cx } from "@/lib/cva";
import { useLayout } from "@/context/layout";
import { BAR_SLOT_CLASS } from "@/components/canvas/toolbar-slot";

import type { Entity } from "koota";

export function ActionBar() {
  const { toolbarSlot } = useLayout();
  const { imageNodes, videoNodes } = useMediaSelection();
  const { isOn, toggle } = useTransforms();
  const [cutoutFor, setCutoutFor] = createSignal<Entity | null>(null);

  const { generate: autoCaptions, canCaption } = useAutoCaptions();

  const world = useWorld();
  const { nodes } = useSelection();

  const isImage = createMemo(() => imageNodes().length > 0);
  const isVideo = createMemo(() => videoNodes().length > 0);

  const sceneFit = useDerived(
    () => {
      const selected = nodes();
      return selected.length === 1 ? sceneFitFor(world, selected[0]!) : null;
    },
    (a, b) => a?.scene === b?.scene && a?.width === b?.width && a?.height === b?.height,
  );

  const visible = createMemo(() => {
    return isImage() || canCaption() || !!sceneFit();
  });

  const fitScene = () => {
    const clip = nodes()[0];
    const fit = clip ? fitSceneToClip(world, clip) : null;
    if (!fit) return;
    // The scene, not the clip, so the size shown is the scene's, before and after an undo.
    getDocumentEditor(world).select(fit.scene);
    bringRectIntoView(world, fit);
    toast(t("Scene resized to {width} × {height}", { width: fit.width, height: fit.height }), {
      action: { label: t("Undo"), onClick: () => undoEdit(world) },
    });
  };

  const removeBackground = () => {
    const images = imageNodes();
    if (images.length === 1 && !isOn("removeBackground")) setCutoutFor(images[0]!);
    else toggle("removeBackground");
  };

  return (
    <>
      <Show when={visible()}>
        <div class={cx("absolute z-10 rounded-lg p-1 bg-background border border-border-input flex gap-1 items-center", BAR_SLOT_CLASS[toolbarSlot()])}>
          <Show when={canCaption() && !isVideo()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={autoCaptions}>
              <Icon name="captions" />
              {t("Auto-Captions")}
            </Button>
          </Show>
          <Show when={isImage()}>
            <div class="flex gap-1 items-center">
              <Button
                variant="ghost"
                class="gap-0 pl-0.5 text-muted-foreground"
                onClick={removeBackground}
              >
                <Icon name="ai-generate" />
                {isOn("removeBackground") ? t("Restore background") : t("Remove background")}
              </Button>
            </div>
          </Show>
          <Show when={sceneFit()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={fitScene}>
              <Icon name="media-fit-type" />
              {t("Fit scene to video")}
            </Button>
            <Show when={isVideo() && canCaption()}>
              <Separator orientation="vertical" class="min-h-5" />
            </Show>
          </Show>
          <Show when={isVideo() && canCaption()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={autoCaptions}>
              <Icon name="captions" />
              {t("Auto-Captions")}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={cutoutFor()} keyed>
        {(entity) => <RemoveBackgroundDialog entity={entity} onClose={() => setCutoutFor(null)} />}
      </Show>
    </>
  );
}
