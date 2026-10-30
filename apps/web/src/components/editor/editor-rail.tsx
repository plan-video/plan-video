/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, type JSX } from "solid-js";

import { SIDEBAR_TABS, setSidebarTab, sidebarTab } from "@/agent-chat";
import { RailPanelIcon } from "@/components/editor/rail-icons";
import { ProjectMenu } from "@/components/sidebar-left/project-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayout } from "@/context/layout";
import { useEditorApi } from "@/dapi";
import { t } from "@/lib/i18n";
import { isMacOSDesktop, isWindowsDesktop } from "@/projects";

export const EDITOR_RAIL_WIDTH = 44;

/**
 * The strip down the window's left edge, on the chrome like the dashboard's
 * rail: the project menu, the left panel's views, and at the bottom
 * the toggle that hides every panel.
 */
export function EditorRail(props: { style?: JSX.CSSProperties }) {
  const { isDesktop, isFullscreen } = useEditorApi();
  const { toggleUI } = useLayout();

  // Padded by the gap on its left, so the buttons sit in the middle of the
  // strip between the window's edge and the left panel.
  return (
    <nav class="flex min-h-0 flex-col items-center gap-1 pb-1.5 pl-1.5" style={props.style} aria-label={t("Panels")}>
      {/* The traffic lights, on the Mac app outside fullscreen. */}
      <Show when={isDesktop && isMacOSDesktop() && !isFullscreen()}>
        <div class="h-8 shrink-0" />
      </Show>
      <Show when={!isWindowsDesktop()}>
        <div class="relative z-30 flex h-11 shrink-0 items-center" style="-webkit-app-region: no-drag;">
          <ProjectMenu compact />
        </div>
      </Show>
      <div class="flex flex-col items-center gap-1" data-tour="sidebar">
        <For each={SIDEBAR_TABS}>
          {(tab) => (
            <RailButton
              label={t(tab.label)}
              active={sidebarTab() === tab.id}
              onClick={() => setSidebarTab(tab.id)}
            >
              <tab.icon />
            </RailButton>
          )}
        </For>
      </div>
      <div class="min-h-0 flex-1" />
      <RailButton label={t("Hide panels")} onClick={toggleUI}>
        <RailPanelIcon />
      </RailButton>
    </nav>
  );
}

function RailButton(props: { label: string; active?: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <Tooltip placement="right">
      <TooltipTrigger
        as="button"
        type="button"
        aria-label={props.label}
        aria-current={props.active ? "page" : undefined}
        class="press relative z-30 grid size-8 place-items-center rounded-md outline-none focus-ring transition-colors"
        classList={{
          "bg-secondary text-foreground": props.active,
          "text-muted-foreground hover:bg-accent hover:text-foreground": !props.active,
        }}
        style="-webkit-app-region: no-drag;"
        onClick={props.onClick}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
