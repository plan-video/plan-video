/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { SidebarTabs } from "@/agent-chat";
import { Button } from "@/components/ui/button";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { mountTextInput } from "@/engine";
import { addTextBox, addTextStyle, TEXT_STYLES, type TextStyle } from "@/engine/text-presets";
import { t } from "@/lib/i18n";

import { TextStyleLook } from "@/components/editor/text-style-look";

/**
 * The left sidebar's Text tab: a plain text box, and under it the text
 * styles, each shown as itself. Either goes on the scene at the playhead.
 */
export function TextPanel() {
  const world = useWorld();

  const add = async (style?: TextStyle) => {
    try {
      const added = await (style ? addTextStyle(world, style) : addTextBox(world));
      if (!added) toast(t("Nothing to insert into"), { description: t("Open a scene first.") });
      // Typing goes straight into it on the canvas, replacing the placeholder.
      else mountTextInput(world, added);
    } catch (error) {
      toast.error(t("Couldn't add text"), { description: (error as Error).message });
    }
  };

  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <div class="flex min-w-0 flex-1 items-center">
          <SidebarTabs />
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-3 p-3">
          <Button variant="secondary" class="w-full" onClick={() => void add()}>
            {t("Add a text box")}
          </Button>
          <PresetGrid>
            <For each={TEXT_STYLES}>
              {(style) => {
                // A still: made once, not again each time the tile is hovered.
                const look = <TextStyleLook style={style} />;
                return (
                  <PresetTile title={t(style.name)} aspect="16 / 10" onClick={() => void add(style)}>
                    {() => look}
                  </PresetTile>
                );
              }}
            </For>
          </PresetGrid>
        </div>
      </div>
    </div>
  );
}
