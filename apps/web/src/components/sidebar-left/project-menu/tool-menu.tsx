/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { setSidebarTab } from "@/agent-chat";
import { useWorld } from "@plan.video/koota-solid";
import { Tool, ToolType } from "@plan.video/runtime";
import { t } from "@/lib/i18n";

export function ToolMenu() {
  const world = useWorld();
  const setTool = (value: ToolType) => {
    world.set(Tool, { value });
    if (value === ToolType.SCENE) setSidebarTab("templates");
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => setTool(ToolType.SCENE)}>
          {t("Scene")}
          <DropdownMenuShortcut>F</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTool(ToolType.TEXT)}>
          {t("Text")}
          <DropdownMenuShortcut>T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTool(ToolType.RECT)}>
          {t("Rectangle")}
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
