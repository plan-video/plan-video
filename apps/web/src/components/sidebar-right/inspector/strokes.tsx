/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { useHas } from "@plan.video/koota-solid";
import { Stroke as StrokeElement } from "@plan.video/reconciler";
import { Cache, Computed, Hidden, colorToHex } from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";
import { StrokeInspector } from "./stroke-inspector";
import { MixedTag, useMixed } from "./word-mix";

import type { Entity } from "koota";

/** `<stroke>`'s own default color. */
const DEFAULT_COLOR = "#000000";

// Stable identity, so a node without strokes does not resample every tick.
const NO_STROKES: Entity[] = [];

type StrokesSettingsProps = {
  selection: Entity[];
};

// The list shows topmost first, so the last element in the file is the first row.
export function StrokesSettings(props: StrokesSettingsProps) {
  const editor = useEditor();
  const mixed = useMixed();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const strokes = useDerived(() => entity().get(Cache)?.strokes ?? NO_STROKES);

  const handleAppendStroke = () => {
    const [stroke] = editor.insertElement(entity(), () => (
      <StrokeElement color={DEFAULT_COLOR} />
    ));
    if (stroke) setPicked(stroke);
  };

  // Read back off the list, so removing a stroke closes the inspector on it.
  const editing = createMemo(() => {
    const stroke = picked();
    return stroke !== undefined && strokes().includes(stroke) ? stroke : undefined;
  });

  // A swap, because a move needs an anchor: `reparent` appends without one, and refuses an append
  // into the parent the element already has.
  const handleReorderStroke = (stroke: Entity, direction: number) => {
    const siblings = strokes();
    const index = siblings.indexOf(stroke);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    if (direction > 0) {
      editor.reparent(siblings[target]!, entity(), stroke);
    } else {
      editor.reparent(stroke, entity(), siblings[target]!);
    }
  };

  return (
    <>
      <PanelSection
        title={t("Stroke")}
        empty={strokes().length === 0}
        subtitle={<MixedTag when={mixed("strokes")} />}
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendStroke}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>{t("Add stroke")}</TooltipContent>
          </Tooltip>
        }
      >
        <For each={strokes().toReversed()}>
          {(stroke) => (
            <StrokeRow
              stroke={stroke}
              onSelect={() => setPicked(stroke)}
              onRemove={() => editor.remove(stroke)}
              onMoveUp={() => handleReorderStroke(stroke, 1)}
              onMoveDown={() => handleReorderStroke(stroke, -1)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <StrokeInspector
          stroke={editing()!}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type StrokeRowProps = {
  stroke: Entity;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

function StrokeRow(props: StrokeRowProps) {
  const editor = useEditor();

  const color = useDerived(() => props.stroke.get(Computed)?.color ?? 0);
  const hidden = useHas(() => props.stroke, Hidden);

  const toggleHidden = () => {
    editor.editProperty(props.stroke, "hidden", !hidden());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label={t("Stroke")}
          value={colorToHex(color()).replace("#", "")}
          icon={<Icon name="rectangle-small" />}
          onClick={props.onSelect}
          disabled={hidden()}
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
            <TooltipContent>{t("Remove stroke")}</TooltipContent>
          </Tooltip>
        </ItemRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onMoveUp}>{t("Move Up")}</ContextMenuItem>
        <ContextMenuItem onSelect={props.onMoveDown}>{t("Move Down")}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={toggleHidden}>
          {hidden() ? t("Unhide") : t("Hide")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onRemove}>{t("Remove")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
