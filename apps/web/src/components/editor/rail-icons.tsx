/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Component } from "solid-js";
import BetweenVerticalStartLucide from "lucide-solid/icons/between-vertical-start";
import ClapperboardLucide from "lucide-solid/icons/clapperboard";
import PanelLeftLucide from "lucide-solid/icons/panel-left";
import PanelsTopLeftLucide from "lucide-solid/icons/panels-top-left";
import PuzzleLucide from "lucide-solid/icons/puzzle";
import SparklesLucide from "lucide-solid/icons/sparkles";
import TypeLucide from "lucide-solid/icons/type";
import WorkflowLucide from "lucide-solid/icons/workflow";

import { cx } from "@/lib/cva";

export type RailIconProps = { class?: string };

// The editor rail's icons, all from Lucide like the dashboard's, shown at 18
// with 1.75 strokes (about 1.3px, the dashboard rail's weight).
function railIcon(Lucide: Component<{ class?: string; "stroke-width"?: number; "aria-hidden"?: "true" }>) {
  return (props: RailIconProps) => (
    <Lucide class={cx("size-[18px] shrink-0", props.class)} stroke-width={1.75} aria-hidden="true" />
  );
}

export const RailFolderIcon = railIcon(ClapperboardLucide);
export const RailWorkflowsIcon = railIcon(WorkflowLucide);
export const RailTextIcon = railIcon(TypeLucide);
export const RailTransitionsIcon = railIcon(BetweenVerticalStartLucide);
export const RailEffectsIcon = railIcon(SparklesLucide);
export const RailTemplatesIcon = railIcon(PanelsTopLeftLucide);
export const RailExtensionsIcon = railIcon(PuzzleLucide);
export const RailPanelIcon = railIcon(PanelLeftLucide);
