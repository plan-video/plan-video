/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Component } from "solid-js";
import {
  RailEffectsIcon,
  RailExtensionsIcon,
  RailFolderIcon,
  RailWorkflowsIcon,
  RailTemplatesIcon,
  RailTextIcon,
  RailTransitionsIcon,
  type RailIconProps,
} from "@/components/editor/rail-icons";
import { msg, t } from "@/lib/i18n";

import { sidebarTab, type SidebarTab } from "./store";

export const SIDEBAR_TABS: { id: SidebarTab; label: string; icon: Component<RailIconProps> }[] = [
  { id: "assets", label: msg("Assets"), icon: RailFolderIcon },
  { id: "text", label: msg("Text"), icon: RailTextIcon },
  { id: "transitions", label: msg("Transitions"), icon: RailTransitionsIcon },
  { id: "effects", label: msg("Effects"), icon: RailEffectsIcon },
  { id: "templates", label: msg("Layout"), icon: RailTemplatesIcon },
  { id: "extensions", label: msg("Extensions"), icon: RailExtensionsIcon },
  { id: "workflows", label: msg("Workflows"), icon: RailWorkflowsIcon },
];

/**
 * The open panel's name, at the top of the left sidebar. The editor's rail
 * (see `EditorRail`) is what switches between them.
 */
export function SidebarTabs() {
  const label = () => SIDEBAR_TABS.find((tab) => tab.id === sidebarTab())?.label ?? "";
  return <h2 class="truncate text-[13px] font-medium text-foreground">{t(label())}</h2>;
}
