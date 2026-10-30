/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { For } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";

import { Icon } from "@/components/ui/icon";
import { alignSelection, distributeSelection } from "@/engine/align";
import { msg, t } from "@/lib/i18n";

const ALIGNMENT_ACTIONS = [
  {
    id: "align-left",
    icon: "horizontal-align-left",
    label: msg("Align left")
  },
  {
    id: "align-center-horizontal",
    icon: "horizontal-align-center",
    label: msg("Align center horizontally"),
  },
  {
    id: "align-right",
    icon: "horizontal-align-right",
    label: msg("Align right")
  },
  {
    id: "align-top",
    icon: "vertical-align-top",
    label: msg("Align top")
  },
  {
    id: "align-center-vertical",
    icon: "vertical-align-center",
    label: msg("Align center vertically"),
  },
  {
    id: "align-bottom",
    icon: "vertical-align-bottom",
    label: msg("Align bottom"),
  },
  {
    id: "distribute-horizontal",
    icon: "distribute-center-horizontal",
    label: msg("Distribute horizontally"),
  },
  {
    id: "distribute-vertical",
    icon: "distribute-center-vertical",
    label: msg("Distribute vertically"),
  },
] as const;

export type AlignmentAction = (typeof ALIGNMENT_ACTIONS)[number]["id"];

export function Alignment() {
  const world = useWorld();

  const handleAction = (action: AlignmentAction) => {
    if (action === "distribute-horizontal") {
      distributeSelection(world, "x");
      return;
    }

    if (action === "distribute-vertical") {
      distributeSelection(world, "y");
      return;
    }

    alignSelection(world, action);
  };

  return (
    <div
      role="toolbar"
      aria-label={t("Alignment")}
      class="flex h-12 items-center gap-2 border-t border-border px-4"
    >
      <For each={ALIGNMENT_ACTIONS}>
        {(item) => (
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-foreground w-5.5 h-7"
              onClick={() => handleAction(item.id)}
            >
              <Icon name={item.icon} />
            </TooltipTrigger>
            <TooltipContent>{t(item.label)}</TooltipContent>
          </Tooltip>
        )}
      </For>
    </div>
  );
}
