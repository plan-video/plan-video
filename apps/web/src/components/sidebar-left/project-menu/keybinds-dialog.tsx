/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show } from "solid-js";

import {
  Dialog,
  DialogContent,
  DialogPortal,
} from "@/components/ui/dialog";
import { KeymapSelect } from "@/components/keymap-select";
import { msg, t } from "@/lib/i18n";
import { formatKeys, shortcutLabel, type KeyCommand } from "@/lib/keymap";

/** `commands` follow the chosen keymap; `keys` is for what the engine's table doesn't run. */
type Keybind = { label: string; commands?: KeyCommand[]; keys?: string };
type KeybindGroup = { title: string; items: Keybind[] };

/** Only shortcuts the editor actually runs; unbound menu labels are left out. */
const GROUPS: KeybindGroup[] = [
  {
    title: msg("Playback"),
    items: [
      { label: msg("Play or pause"), commands: ["play"] },
      { label: msg("Hand tool while held"), keys: "Space" },
      { label: msg("Shuttle backward"), commands: ["shuttleBack"] },
      { label: msg("Stop"), commands: ["stop"] },
      { label: msg("Shuttle forward"), commands: ["shuttleForward"] },
    ],
  },
  {
    title: msg("Tools"),
    items: [
      { label: msg("Move"), commands: ["moveTool"] },
      { label: msg("Hand"), commands: ["handTool"] },
      { label: msg("Frame"), commands: ["frameTool"] },
      { label: msg("Text"), commands: ["textTool"] },
      { label: msg("Rectangle"), commands: ["rectTool"] },
    ],
  },
  {
    title: msg({ message: "Edit", context: "menu" }),
    items: [
      { label: msg("Undo"), commands: ["undo"] },
      { label: msg("Redo"), commands: ["redo"] },
      { label: msg("Cut"), commands: ["cut"] },
      { label: msg("Copy"), commands: ["copy"] },
      { label: msg("Paste"), commands: ["paste"] },
      { label: msg("Duplicate"), commands: ["duplicate"] },
      { label: msg("Delete"), commands: ["delete"] },
      { label: msg("Split at playhead"), commands: ["split"] },
      { label: msg("Group"), commands: ["group"] },
      { label: msg("Ungroup"), commands: ["ungroup"] },
      { label: msg("Wrap in scene"), commands: ["wrapInScene"] },
      { label: msg("Wrap in sequence"), commands: ["wrapInSequence"] },
      { label: msg("Unwrap sequence"), commands: ["unwrapSequence"] },
      { label: msg("Hide"), commands: ["hide"] },
    ],
  },
  {
    title: msg("Select"),
    items: [
      { label: msg("Select all"), commands: ["selectAll"] },
      { label: msg("Select parent"), commands: ["selectParent"] },
      { label: msg("Select children"), commands: ["selectChildren"] },
      { label: msg("Deselect"), commands: ["deselect"] },
      { label: msg("Bring to front"), commands: ["bringToFront"] },
      { label: msg("Send to back"), commands: ["sendToBack"] },
    ],
  },
  {
    title: msg("View"),
    items: [
      { label: msg("Zoom in"), commands: ["zoomIn"] },
      { label: msg("Zoom out"), commands: ["zoomOut"] },
      { label: msg("Zoom to 100%"), commands: ["zoomActual"] },
      { label: msg("Zoom to fit"), commands: ["zoomFit"] },
      { label: msg("Zoom to selection"), commands: ["zoomSelection"] },
      { label: msg("Preview quality, full"), commands: ["previewFull"] },
      { label: msg("Preview quality, 50%"), commands: ["previewHalf"] },
      { label: msg("Go to dashboard"), keys: formatKeys(["d", "mod", "shift"]) },
    ],
  },
  {
    title: msg("Timeline"),
    items: [
      { label: msg("Previous frame"), commands: ["previousFrame"] },
      { label: msg("Next frame"), commands: ["nextFrame"] },
      { label: msg("Back one second"), commands: ["backSecond"] },
      { label: msg("Forward one second"), commands: ["forwardSecond"] },
      { label: msg("Previous cut"), commands: ["previousCut"] },
      { label: msg("Next cut"), commands: ["nextCut"] },
      { label: msg("Go to selection start"), commands: ["selectionStart"] },
      { label: msg("Go to selection end"), commands: ["selectionEnd"] },
      { label: msg("Go to start"), commands: ["timelineStart"] },
      { label: msg("Go to end"), commands: ["timelineEnd"] },
    ],
  },
  {
    title: msg("Move"),
    items: [
      { label: msg("Nudge 1 px"), commands: ["nudgeLeft", "nudgeRight", "nudgeUp", "nudgeDown"] },
      { label: msg("Nudge 10 px"), commands: ["nudgeFastLeft", "nudgeFastRight", "nudgeFastUp", "nudgeFastDown"] },
    ],
  },
  {
    title: msg("File"),
    items: [
      { label: msg("Export scene"), keys: formatKeys(["e", "mod"]) },
      { label: msg("Export current frame"), keys: formatKeys(["e", "mod", "shift"]) },
      { label: msg("Import assets"), keys: formatKeys(["i", "mod"]) },
      { label: msg("New folder"), keys: formatKeys(["n", "mod", "shift"]) },
    ],
  },
  {
    title: msg("Assets panel"),
    items: [
      { label: msg("Move the selection"), keys: "← → ↑ ↓" },
      { label: msg("Delete the selection"), keys: "⌫" },
      { label: msg("Leave the folder"), keys: "⌫" },
    ],
  },
];

export function KeybindsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogContent class="flex max-h-[min(36rem,80vh)] w-[min(100%-2rem,42rem)] max-w-none flex-col gap-3 overflow-hidden p-5 sm:max-w-none">
          <div class="flex items-center justify-between gap-4 pr-7">
            <h2 class="text-sm font-450 text-foreground">{t("Keybinds")}</h2>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">{t("Same keys as")}</span>
              <KeymapSelect />
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <For each={GROUPS}>
                {(group) => (
                  <section>
                    <h3 class="mb-1.5 text-xs text-muted-foreground">{t(group.title)}</h3>
                    <ul class="flex flex-col">
                      <For each={group.items}>
                        {(item) => {
                          const keys = () => item.keys ?? item.commands?.map(shortcutLabel).join(" ");
                          return (
                            <Show when={keys()}>
                              <li class="flex items-baseline justify-between gap-4 py-0.5">
                                <span class="min-w-0 text-xs text-foreground">{t(item.label)}</span>
                                <span class="shrink-0 text-xs tracking-wide text-muted-foreground">{keys()}</span>
                              </li>
                            </Show>
                          );
                        }}
                      </For>
                    </ul>
                  </section>
                )}
              </For>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
