/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, type JSX } from "solid-js";

import { SIDEBAR_TABS, setSidebarTab, sidebarTab } from "@/agent-chat";
import { RailCustomizeIcon, RailPanelIcon } from "@/components/editor/rail-icons";
import { ProjectMenu } from "@/components/sidebar-left/project-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayout } from "@/context/layout";
import { t } from "@/lib/i18n";

export const EDITOR_RAIL_WIDTH = 44;

export function EditorRail(props: { side: "left" | "right"; style?: JSX.CSSProperties }) {
  const { toggleUI, customizing, setCustomizing, hiddenSections, showSection } = useLayout();
  const tooltipSide = () => (props.side === "left" ? "right" : "left");

  return (
    <nav class="flex min-h-0 shrink-0 flex-col items-center gap-1 pb-1.5" style={props.style} aria-label={t("Panels")}>
      <div class="relative z-30 flex h-11 shrink-0 items-center">
        <ProjectMenu compact />
      </div>
      <div class="flex flex-col items-center gap-1" data-tour="sidebar">
        <For each={SIDEBAR_TABS}>
          {(tab) => (
            <RailButton
              label={t(tab.label)}
              tooltipSide={tooltipSide()}
              active={sidebarTab() === tab.id && !hiddenSections().includes("assets")}
              onClick={() => {
                showSection("assets");
                setSidebarTab(tab.id);
              }}
            >
              <tab.icon />
            </RailButton>
          )}
        </For>
      </div>
      <div class="min-h-0 flex-1" />
      <RailButton label={t("Customize layout")} tooltipSide={tooltipSide()} active={customizing()} onClick={() => setCustomizing(!customizing())}>
        <RailCustomizeIcon />
      </RailButton>
      <RailButton label={t("Hide panels")} tooltipSide={tooltipSide()} onClick={toggleUI}>
        <RailPanelIcon />
      </RailButton>
    </nav>
  );
}

function RailButton(props: { label: string; tooltipSide: "left" | "right"; active?: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <Tooltip placement={props.tooltipSide}>
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
       
        onClick={props.onClick}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
