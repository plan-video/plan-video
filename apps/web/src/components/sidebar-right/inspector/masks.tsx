/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { Rect } from "@plan.video/reconciler";
import { Cache, Computed, Name, getNextName } from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";

import type { Entity } from "koota";

/** Inset rather than flush, so a new mask shows at once: at the parent's own size it would clip a band off two edges invisibly. */
const MASK_INSET = 20;

// Stable identity, so a node without masks does not resample every tick.
const NO_MASKS: Entity[] = [];

type MasksSettingsProps = {
  selection: Entity[];
};

// A mask is never drawn, so its `fill`, `opacity` and paint children have no effect, and the plus authors neither.
export function MasksSettings(props: MasksSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  // Cache is derived state, written without change events.
  const masks = useDerived(() => entity().get(Cache)?.masks ?? NO_MASKS);

  const handleAppendMask = () => {
    const node = entity();
    const computed = node.get(Computed);
    const width = Math.round(computed?.width ?? 0);
    const height = Math.round(computed?.height ?? 0);
    // A mask without a size of its own is 500x500, the honest answer for a parent with no box yet (an empty group).
    const size = width > 0 && height > 0 ? { width, height } : {};

    editor.insertElement(node, () => (
      <Rect mask name={getNextName(world, "Mask")} x={MASK_INSET} y={MASK_INSET} {...size} />
    ));
    // Stay on the node: selecting the new mask would swap this inspector for the mask's own, which lacks most panels.
  };

  return (
    <PanelSection
      title={t("Masks")}
      empty={masks().length === 0}
      actions={
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={handleAppendMask}
          >
            <Icon name="plus-add" />
          </TooltipTrigger>
          <TooltipContent>{t("Add mask")}</TooltipContent>
        </Tooltip>
      }
    >
      <For each={masks()}>
        {(mask) => (
          <MaskRow
            mask={mask}
            onSelect={() => editor.select(mask)}
            onRemove={() => editor.remove(mask)}
          />
        )}
      </For>
    </PanelSection>
  );
}

type MaskRowProps = {
  mask: Entity;
  onSelect(): void;
  onRemove(): void;
};

function MaskRow(props: MaskRowProps) {
  const name = useTrait(() => props.mask, Name);

  return (
    <ItemRow
      label={t("Mask")}
      value={name()?.value || t("Mask")}
      icon={<Icon name="mask-small" />}
      class="text-foreground"
      onClick={props.onSelect}
    >
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon"
          variant="ghost"
          class="text-muted-foreground"
          onClick={props.onRemove}
        >
          <Icon name="close-remove-small" />
        </TooltipTrigger>
        <TooltipContent>{t("Remove mask")}</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}
