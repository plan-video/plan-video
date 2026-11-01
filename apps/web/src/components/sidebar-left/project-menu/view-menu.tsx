/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { LayoutMenu } from "@/components/editor/layout-menu";
import { Icon } from "@/components/ui/icon";
import { useWorld } from "@plan.video/koota-solid";
import { useLayout } from "@/context/layout";
import {
  PREVIEW_QUALITIES,
  setPreviewQuality,
  usePreviewQuality,
  useSelection,
  zoomBy,
  zoomTo,
  zoomToFit,
  zoomToSelection,
} from "@/engine";
import { dashboardTheme, setDashboardTheme, type DashboardTheme } from "@/lib/dashboard-theme";
import { msg, t } from "@/lib/i18n";

const THEMES: { value: DashboardTheme; label: string }[] = [
  { value: "dark", label: msg("Dark") },
  { value: "light", label: msg("Light") },
];

export function ViewMenu() {
  const world = useWorld();
  const layout = useLayout();
  const { nodes } = useSelection();
  const quality = usePreviewQuality();

  const hasSelection = () => nodes().length > 0;

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => zoomBy(world, 1.25)}>
          {t("Zoom in")}
          <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => zoomBy(world, 0.8)}>
          {t("Zoom out")}
          <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => zoomTo(world, 1)}>
          {t("Zoom to 100%")}
          <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => zoomToFit(world)}>
          {t("Zoom to fit")}
          <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => zoomToSelection(world)}
        >
          {t("Zoom to selection")}
          <DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Preview quality")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-40">
              <For each={PREVIEW_QUALITIES}>
                {(option) => (
                  <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => setPreviewQuality(world, option.value)}>
                    <div class="invisible" classList={{ visible: quality() === option.value }}>
                      <Icon name="confirm-check" class="text-foreground" />
                    </div>
                    <span class="mx-1">{t(option.label)}</span>
                    <Show when={option.shortcut}>
                      <DropdownMenuShortcut>{option.shortcut}</DropdownMenuShortcut>
                    </Show>
                  </DropdownMenuItem>
                )}
              </For>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Theme")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-40">
              <For each={THEMES}>
                {(option) => (
                  <DropdownMenuItem class="px-0 pr-2 gap-0.5" onSelect={() => setDashboardTheme(option.value)}>
                    <div class="invisible" classList={{ visible: dashboardTheme() === option.value }}>
                      <Icon name="confirm-check" class="text-foreground" />
                    </div>
                    <span class="mx-1">{t(option.label)}</span>
                  </DropdownMenuItem>
                )}
              </For>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={layout.toggleUI}>
          {t("Toggle UI")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={layout.toggleTimeline}>
          {t("Toggle timeline")}
        </DropdownMenuItem>
        <LayoutMenu />
      </DropdownMenuGroup>
    </>
  );
}
