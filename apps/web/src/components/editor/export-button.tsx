/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createSignal } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { getActiveEntity, getParentNode } from "@plan.video/runtime";
import DownloadIcon from "lucide-solid/icons/download";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ExportSettingsDialog } from "@/components/sidebar-right/inspector/export";
import { useExport } from "@/context/export";
import { useTimelineIndex } from "@/engine/hooks";
import { t } from "@/lib/i18n";

import type { Entity, World } from "koota";

/** The scene an export renders: the top of the one being worked in. */
function exportedScene(world: World): Entity | null {
  let scene = getActiveEntity(world);
  while (scene) {
    const parent = getParentNode(scene);
    if (!parent) break;
    scene = parent;
  }
  return scene ?? null;
}

/**
 * Exports the video without going looking for it: opens the export settings
 * of the scene being worked in (the ones its Export section shows, the
 * default preset until the scene is given its own) beside the inspector, with
 * the export at their foot.
 */
export function ExportButton() {
  const world = useWorld();
  const index = useTimelineIndex();
  const { exporting } = useExport();
  const [scene, setScene] = createSignal<Entity | null>(null);

  let trigger: HTMLElement | undefined;

  const toggle = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (scene()) return setScene(null);
    const next = exportedScene(world);
    if (!next) {
      toast(t("Nothing to export"), { description: t("Add a scene first.") });
      return;
    }
    setScene(next);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          as={Button}
          ref={trigger}
          variant="secondary"
          class="gap-1.5 pl-2 pr-2.5"
          style="-webkit-app-region: no-drag;"
          disabled={exporting() || !index().root}
          onClick={toggle}
          data-tour="export-button"
        >
          <DownloadIcon class="size-3.5" stroke-width={2} />
          {t("Export")}
        </TooltipTrigger>
        <TooltipContent>{t("Save the video to your computer")}</TooltipContent>
      </Tooltip>
      <Show when={scene()?.isAlive() && scene()} keyed>
        {(current) => (
          // Beside the whole inspector, level with its title row, where the
          // scene's own Export section opens the same settings.
          <ExportSettingsDialog scene={current} anchorRef={trigger?.parentElement ?? undefined} onClose={() => setScene(null)} />
        )}
      </Show>
    </>
  );
}
