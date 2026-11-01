/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@plan.video/koota-solid";
import XIcon from "lucide-solid/icons/x";
import { For, Show, createEffect, createSignal, on, onCleanup, type JSX } from "solid-js";
import { toast } from "somoto";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { useLayout } from "@/context/layout";
import { zoomToFitWhenSettled } from "@/engine/camera";
import { msg, t } from "@/lib/i18n";
import { LAYOUT_PRESET_IDS, findLayoutByName, type LayoutPresetId, type SavedLayout } from "./dock-layout";

const PRESET_LABELS: Record<LayoutPresetId, string> = {
  timeline: msg("Timeline focus"),
  canvas: msg("Canvas focus"),
  sidebars: msg("Tall sidebars"),
};

const [saveOpen, setSaveOpen] = createSignal(false);

export function LayoutMenu() {
  const layout = useLayout();
  const world = useWorld();
  const fit = () => zoomToFitWhenSettled(world);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t("Layout")}</DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent class="w-56">
          <DropdownMenuItem onSelect={() => layout.setCustomizing(true)}>{t("Customize layout")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <For each={LAYOUT_PRESET_IDS}>
            {(id) => (
              <LayoutItem active={layout.activeLayout() === id} onSelect={() => { layout.applyPreset(id); fit(); }}>
                <span class="mx-1 min-w-0 flex-1 truncate">{t(PRESET_LABELS[id])}</span>
              </LayoutItem>
            )}
          </For>
          <Show when={layout.savedLayouts().length > 0}>
            <DropdownMenuSeparator />
            <For each={layout.savedLayouts()}>
              {(saved) => <SavedLayoutItem saved={saved} onApplied={fit} />}
            </For>
          </Show>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>{t("Save current layout…")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { layout.resetLayout(); fit(); }}>{t("Reset layout")}</DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function LayoutItem(props: { active: boolean; onSelect: () => void; children: JSX.Element }) {
  return (
    <DropdownMenuItem class="gap-0.5 px-0 pr-2" onSelect={props.onSelect}>
      <div class="invisible" classList={{ visible: props.active }}>
        <Icon name="confirm-check" class="text-foreground" />
      </div>
      {props.children}
    </DropdownMenuItem>
  );
}

function SavedLayoutItem(props: { saved: SavedLayout; onApplied: () => void }) {
  const layout = useLayout();
  const stop = (event: Event) => event.stopPropagation();

  const remove = (event: MouseEvent) => {
    stop(event);
    const undo = layout.deleteSavedLayout(props.saved.id);
    toast(t("Layout deleted"), { action: { label: t("Undo"), onClick: undo } });
  };

  return (
    <LayoutItem active={layout.activeLayout() === props.saved.id} onSelect={() => { layout.applySavedLayout(props.saved); props.onApplied(); }}>
      <span class="mx-1 min-w-0 flex-1 truncate">{props.saved.name}</span>
      {/* Stops the row under it from applying the layout: menu rows select on pointer up. */}
      <button
        type="button"
        aria-label={t("Delete {name}", { name: props.saved.name })}
        class="-mr-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-ring"
        onPointerDown={stop}
        onPointerUp={stop}
        onClick={remove}
      >
        <XIcon class="size-3" stroke-width={2} />
      </button>
    </LayoutItem>
  );
}

export function SaveLayoutDialog() {
  const layout = useLayout();
  const [name, setName] = createSignal("");
  let dialogRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  createEffect(on(saveOpen, (open) => {
    if (!open) return;
    const active = layout.savedLayouts().find((saved) => saved.id === layout.activeLayout());
    setName(active?.name ?? "");

    // The menu that opened this hands focus back to its own button as it closes, after the dialog has opened.
    const keepFocus = (event: FocusEvent) => {
      if (!dialogRef?.contains(event.target as Node)) inputRef?.focus();
    };
    document.addEventListener("focusin", keepFocus);
    onCleanup(() => document.removeEventListener("focusin", keepFocus));
    requestAnimationFrame(() => inputRef?.focus());
  }));

  const replaces = () => !!findLayoutByName(layout.savedLayouts(), name());
  const close = () => setSaveOpen(false);

  const save = () => {
    if (!name().trim()) return;
    layout.saveLayout(name());
    close();
    toast.success(t("Layout saved"));
  };

  return (
    <Dialog open={saveOpen()} onOpenChange={(open) => !open && close()}>
      <DialogContent ref={dialogRef} class="w-[360px] max-w-[calc(100%-2rem)] gap-5 p-5">
        <DialogHeader>
          <DialogTitle class="text-[13px] font-medium">{t("Save layout")}</DialogTitle>
        </DialogHeader>
        <form
          class="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">{t("Name")}</span>
            <input
              ref={inputRef}
              type="text"
              value={name()}
              placeholder={t("Reels")}
              maxLength={40}
              onFocus={(event) => event.currentTarget.select()}
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => event.stopPropagation()}
              class="h-8 rounded-md bg-input px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-ring"
            />
          </label>
          <DialogFooter class="gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!name().trim()}>
              {replaces() ? t("Replace") : t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
