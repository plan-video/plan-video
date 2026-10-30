/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/editor/export-button";
import { SchedulePostButton } from "@/components/editor/schedule-post-button";
import { t } from "@/lib/i18n";
import { useWorld } from "@plan.video/koota-solid";
import {
  PREVIEW_QUALITIES,
  setPreviewQuality,
  useCameraScale,
  usePreviewQuality,
  zoomBy,
  zoomTo,
  zoomToFit,
} from "@/engine";

export function InspectorHeader(props: { title: string }) {
  return (
    <div class="h-11 shrink-0 flex items-center gap-2 pl-4 pr-2 border-b border-border">
      <span class="min-w-0 flex-1 text-[13px] leading-5 font-medium text-foreground truncate">{props.title}</span>
      <ExportButton />
      <SchedulePostButton />
    </div>
  );
}

export function ZoomMenu(props: { placement?: "bottom-end" | "top-end" }) {
  const world = useWorld();
  const scale = useCameraScale();
  const quality = usePreviewQuality();
  const zoomLabel = () => `${Math.round(scale() * 100)}%`;

  return (
    <DropdownMenu placement={props.placement ?? "bottom-end"}>
      <DropdownMenuTrigger<typeof Button>
        as={(triggerProps) => (
          <Button
            {...triggerProps}
            variant="ghost"
            aria-label={t("Zoom and preview quality")}
            class="gap-0 pl-2 pr-0.5 text-muted-foreground hover:text-foreground data-[expanded]:text-foreground tabular-nums"
          >
            <span>{zoomLabel()}</span>
            <Icon name="chevron-down" class="size-6 shrink-0" />
          </Button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-52">
          <DropdownMenuGroup>
            <DropdownMenuGroupLabel inset>{t("Zoom")}</DropdownMenuGroupLabel>
            <DropdownMenuItem inset onSelect={() => zoomBy(world, 1.25)}>
              {t("Zoom in")}
              <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem inset onSelect={() => zoomBy(world, 0.8)}>
              {t("Zoom out")}
              <DropdownMenuShortcut>⌘-</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem inset onSelect={() => zoomToFit(world)}>
              {t("Zoom to fit")}
              <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem inset onSelect={() => zoomTo(world, 0.5)}>
              {t("Zoom to 50%")}
            </DropdownMenuItem>
            <DropdownMenuItem inset onSelect={() => zoomTo(world, 1)}>
              {t("Zoom to 100%")}
              <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem inset onSelect={() => zoomTo(world, 2)}>
              {t("Zoom to 200%")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuGroupLabel inset>{t("Preview quality")}</DropdownMenuGroupLabel>
            <For each={PREVIEW_QUALITIES}>
              {(option) => (
                <DropdownMenuItem inset onSelect={() => setPreviewQuality(world, option.value)}>
                  <Show when={quality() === option.value}>
                    <Icon name="confirm-check" class="absolute left-1 text-foreground" />
                  </Show>
                  {t(option.label)}
                  <Show when={option.shortcut}>
                    <DropdownMenuShortcut>{option.shortcut}</DropdownMenuShortcut>
                  </Show>
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
