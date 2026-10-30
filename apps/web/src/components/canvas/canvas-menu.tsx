/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { RenderSurface, getSelectionMask, invert2D, transformPoint } from "@plan.video/runtime";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { deleteSelection, duplicateSelection } from "@/engine";
import { getAlignableSelection, stackSelection } from "@/engine/align";
import { t } from "@/lib/i18n";

import type { JSX } from "solid-js";

/**
 * The menu a right click on the selection opens on the canvas: anywhere in
 * the selection's box counts, so several placed at odds can be stacked under
 * each other in one go. Off the selection, the app's own menu opens instead.
 */
export function CanvasSelectionMenu(props: { children: JSX.Element }) {
  const world = useWorld();

  // How many the menu opened on, read when it opens.
  const [count, setCount] = createSignal(0);

  const handleContextMenu = (event: MouseEvent) => {
    const canvas = world.get(RenderSurface)?.canvas;
    const mask = getSelectionMask(world);
    if (!(canvas instanceof HTMLCanvasElement) || !mask) return setCount(0);

    const rect = canvas.getBoundingClientRect();
    const resolution = world.get(RenderSurface)?.resolution ?? 1;
    const local = transformPoint(invert2D(mask.mat), (event.clientX - rect.left) * resolution, (event.clientY - rect.top) * resolution);
    const inside = local.x >= 0 && local.x <= mask.width && local.y >= 0 && local.y <= mask.height;
    setCount(inside ? getAlignableSelection(world).length : 0);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger as="div" class="absolute inset-0" disabled={count() === 0} onContextMenu={handleContextMenu}>
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[220px]">
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={count() < 2}>{t("Stack under each other")}</ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent class="w-[180px]">
                <ContextMenuItem onSelect={() => stackSelection(world, "left")}>{t("Left edges in line")}</ContextMenuItem>
                <ContextMenuItem onSelect={() => stackSelection(world, "center")}>{t("Centers in line")}</ContextMenuItem>
                <ContextMenuItem onSelect={() => stackSelection(world, "right")}>{t("Right edges in line")}</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => duplicateSelection(world)}>
            {t("Duplicate")}
            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => deleteSelection(world)}>
            {t("Delete")}
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
