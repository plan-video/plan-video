/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

// `onQuery` is left out where the panel has no sections to search.
export function InspectorHeader(props: { title: string; query: string; onQuery?: (value: string) => void }) {
  const [focused, setFocused] = createSignal(false);
  const searching = () => props.onQuery != null && (focused() || props.query !== "");
  const close = () => {
    props.onQuery?.("");
    setFocused(false);
  };

  return (
    <div class="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-4">
      <Show
        when={searching()}
        fallback={
          <>
            <h2 class="mr-auto min-w-0 truncate text-[13px] font-medium text-foreground">{props.title}</h2>
            <Show when={props.onQuery}>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  aria-label={t("Search")}
                  onClick={() => setFocused(true)}
                >
                  <Icon name="search" />
                </TooltipTrigger>
                <TooltipContent>{t("Search")}</TooltipContent>
              </Tooltip>
            </Show>
          </>
        }
      >
        <div class="relative min-w-0 flex-1">
          <Icon name="search" class="pointer-events-none absolute left-0 top-0.5 text-muted-foreground" />
          <input
            ref={(el) => queueMicrotask(() => el.focus())}
            type="text"
            value={props.query}
            placeholder={t("Search")}
            aria-label={t("Search")}
            autocomplete="off"
            spellcheck={false}
            class="h-7 w-full min-w-0 rounded-md bg-input px-6 text-xs text-foreground outline-none placeholder:text-muted-foreground selection:bg-selection selection:text-selection-foreground focus-ring"
            onInput={(event) => props.onQuery?.(event.currentTarget.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              close();
            }}
          />
          <Button
            size="icon"
            variant="ghost"
            class="absolute right-0 top-0 text-muted-foreground"
            aria-label={t("Close search")}
            onClick={close}
          >
            <Icon name="close-remove-small" />
          </Button>
        </div>
      </Show>
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
