/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";

import {
  Dialog,
  DialogContent,
  DialogPortal,
} from "@/components/ui/dialog";
import { msg, t } from "@/lib/i18n";

type Keybind = { label: string; keys: string };
type KeybindGroup = { title: string; items: Keybind[] };

/** Only shortcuts the editor actually runs; unbound menu labels are left out. */
const GROUPS: KeybindGroup[] = [
  {
    title: msg("Playback"),
    items: [
      { label: msg("Play or pause"), keys: "Space" },
      { label: msg("Hand tool while held"), keys: "Space" },
      { label: msg("Shuttle backward"), keys: "J" },
      { label: msg("Stop"), keys: "K" },
      { label: msg("Shuttle forward"), keys: "L" },
    ],
  },
  {
    title: msg("Tools"),
    items: [
      { label: msg("Move"), keys: "V" },
      { label: msg("Hand"), keys: "H" },
      { label: msg("Frame"), keys: "F" },
      { label: msg("Text"), keys: "T" },
      { label: msg("Rectangle"), keys: "R" },
    ],
  },
  {
    title: msg({ message: "Edit", context: "menu" }),
    items: [
      { label: msg("Undo"), keys: "⌘Z" },
      { label: msg("Redo"), keys: "⇧⌘Z" },
      { label: msg("Cut"), keys: "⌘X" },
      { label: msg("Copy"), keys: "⌘C" },
      { label: msg("Paste"), keys: "⌘V" },
      { label: msg("Duplicate"), keys: "⌘D" },
      { label: msg("Delete"), keys: "⌫" },
      { label: msg("Split at playhead"), keys: "⌘B" },
      { label: msg("Group"), keys: "⌘G" },
      { label: msg("Ungroup"), keys: "⇧⌘G" },
      { label: msg("Wrap in scene"), keys: "⌘↩" },
      { label: msg("Wrap in sequence"), keys: "⌥⌘↩" },
      { label: msg("Unwrap sequence"), keys: "⌥⇧⌘↩" },
      { label: msg("Hide"), keys: "⇧⌘H" },
    ],
  },
  {
    title: msg("Select"),
    items: [
      { label: msg("Select all"), keys: "⌘A" },
      { label: msg("Select parent"), keys: "\\" },
      { label: msg("Select children"), keys: "↩" },
      { label: msg("Deselect"), keys: "Esc" },
      { label: msg("Bring to front"), keys: "]" },
      { label: msg("Send to back"), keys: "[" },
    ],
  },
  {
    title: msg("View"),
    items: [
      { label: msg("Zoom in"), keys: "⌘+" },
      { label: msg("Zoom out"), keys: "⌘-" },
      { label: msg("Zoom to 100%"), keys: "⌘0" },
      { label: msg("Zoom to fit"), keys: "⌘1" },
      { label: msg("Zoom to selection"), keys: "⌘2" },
      { label: msg("Preview quality, full"), keys: "⌘J" },
      { label: msg("Preview quality, 50%"), keys: "⇧⌘J" },
      { label: msg("Go to dashboard"), keys: "⇧⌘D" },
    ],
  },
  {
    title: msg("Timeline"),
    items: [
      { label: msg("Previous frame"), keys: "A" },
      { label: msg("Next frame"), keys: "D" },
      { label: msg("Back one second"), keys: "S" },
      { label: msg("Forward one second"), keys: "W" },
      { label: msg("Go to selection start"), keys: ";" },
      { label: msg("Go to selection end"), keys: "'" },
      { label: msg("Go to start"), keys: "Home" },
      { label: msg("Go to end"), keys: "End" },
    ],
  },
  {
    title: msg("Move"),
    items: [
      { label: msg("Nudge 1 px"), keys: "← → ↑ ↓" },
      { label: msg("Nudge 10 px"), keys: "⇧← → ↑ ↓" },
    ],
  },
  {
    title: msg("File"),
    items: [
      { label: msg("Export scene"), keys: "⌘E" },
      { label: msg("Export current frame"), keys: "⇧⌘E" },
      { label: msg("Import assets"), keys: "⌘I" },
      { label: msg("New folder"), keys: "⇧⌘N" },
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
          <h2 class="text-sm font-450 text-foreground">{t("Keybinds")}</h2>
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <For each={GROUPS}>
                {(group) => (
                  <section>
                    <h3 class="mb-1.5 text-xs text-muted-foreground">{t(group.title)}</h3>
                    <ul class="flex flex-col">
                      <For each={group.items}>
                        {(item) => (
                          <li class="flex items-baseline justify-between gap-4 py-0.5">
                            <span class="min-w-0 text-xs text-foreground">{t(item.label)}</span>
                            <span class="shrink-0 text-xs tracking-wide text-muted-foreground">{item.keys}</span>
                          </li>
                        )}
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
