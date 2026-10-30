/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { SolidPaint } from "@plan.video/reconciler";
import { Cache, isText } from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";
import { FillPicker, type FillTab } from "./fill-picker";
import { FillRow } from "./fill-row";

import type { Entity } from "koota";

const DEFAULT_FILL_COLOR = "#E0E0E0";

/** A text is painted by its glyphs, which no picture and no video fills. */
const TEXT_TABS: FillTab[] = ["solid", "gradient"];

// Stable identity, so a node without fills does not resample every tick.
const NO_FILLS: Entity[] = [];

type FillsSettingsProps = {
  selection: Entity[];
};

// The list shows topmost first, so the last element in the file is the first row.
export function FillsSettings(props: FillsSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const fills = useDerived(() => entity().get(Cache)?.fills ?? NO_FILLS);

  const tabs = createMemo<FillTab[] | undefined>(() =>
    isText(entity()) ? TEXT_TABS : undefined,
  );

  const handleAppendFill = () => {
    const [fill] = editor.insertElement(entity(), () => (
      <SolidPaint color={DEFAULT_FILL_COLOR} />
    ));
    if (fill) setPicked(fill);
  };

  // Read back off the list, so removing a fill closes the picker on it.
  const editing = createMemo(() => {
    const fill = picked();
    return fill !== undefined && fills().includes(fill) ? fill : undefined;
  });

  // A swap, because a move needs an anchor: `reparent` appends without one, and refuses an append
  // into the parent the element already has.
  const handleReorderFill = (fill: Entity, direction: number) => {
    const siblings = fills();
    const index = siblings.indexOf(fill);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), fill);
    } else {
      editor.reparent(fill, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title={t("Fill")}
        empty={fills().length === 0}
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendFill}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>{t("Add fill")}</TooltipContent>
          </Tooltip>
        }
      >
        <For each={fills().toReversed()}>
          {(fill) => (
            <FillRow
              fill={fill}
              onSelect={() => setPicked(fill)}
              onRemove={() => editor.remove(fill)}
              onMoveUp={() => handleReorderFill(fill, 1)}
              onMoveDown={() => handleReorderFill(fill, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <FillPicker
          node={entity()}
          fill={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
          onReplace={(next) => setPicked(next)}
          tabs={tabs()}
        />
      </Show>
    </>
  );
}
