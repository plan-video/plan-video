/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { useHas, useTrait } from "@plan.video/koota-solid";
import { Grade as GradeElement } from "@plan.video/reconciler";
import {
  Cache,
  Grade,
  Hidden,
  NEUTRAL_GRADE,
  Paint,
  PaintType,
  getIntrinsicPaint,
  isGroup,
  isScene,
} from "@plan.video/runtime";

import { Button } from "@/components/ui/button";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/context/auth";
import { useDerived, useEditor } from "@/engine/hooks";
import { definedGrade, gradePresets, loadGradePresets } from "@/lib/grade-presets";
import { t } from "@/lib/i18n";
import { lookLabel } from "./grade-looks";
import { GradePanel } from "./grade-panel";

import type { GradeValues } from "@plan.video/runtime";
import type { Entity } from "koota";

// Stable identity, so a node without a grade does not resample every tick.
const NO_GRADES: Entity[] = [];

const isMedia = (paint: PaintType | undefined) => paint === PaintType.VIDEO || paint === PaintType.IMAGE;

export function GradeSettings(props: { selection: Entity[] }) {
  const editor = useEditor();
  const auth = useAuth();
  const entity = () => props.selection[0]!;

  createEffect(() => loadGradePresets(auth.user()?.id));

  let anchorRef!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);

  const gradable = useDerived(() => {
    const node = entity();
    if (isScene(node) || isGroup(node)) return true;
    if (isMedia(getIntrinsicPaint(node))) return true;
    return (node.get(Cache)?.fills ?? []).some((fill) => isMedia(fill.get(Paint)?.value));
  });

  // Cache is derived state, written without change events.
  const grades = useDerived(() => entity().get(Cache)?.grades ?? NO_GRADES);
  const grade = createMemo(() => grades().at(-1));

  const handleAdd = () => {
    const [added] = editor.insertElement(entity(), () => <GradeElement />);
    if (added) setOpen(true);
  };

  return (
    <Show when={gradable()}>
      <PanelSection
        title={t("Color")}
        ref={anchorRef}
        actions={
          <Show when={!grade()}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={handleAdd}
              >
                <Icon name="plus-add" />
              </TooltipTrigger>
              <TooltipContent>{t("Add color grade")}</TooltipContent>
            </Tooltip>
          </Show>
        }
      >
        <Show when={grade()} keyed>
          {(current) => (
            <GradeRow grade={current} onSelect={() => setOpen(true)} onRemove={() => editor.remove(current)} />
          )}
        </Show>
      </PanelSection>

      <Show when={open() && grade()} keyed>
        {(current) => (
          <GradePanel grade={current} target={entity()} anchorRef={anchorRef} onClose={() => setOpen(false)} />
        )}
      </Show>
    </Show>
  );
}

function GradeRow(props: { grade: Entity; onSelect(): void; onRemove(): void }) {
  const editor = useEditor();
  const trait = useTrait(() => props.grade, Grade);
  const hidden = useHas(() => props.grade, Hidden);

  const label = createMemo(() => {
    const values: GradeValues = { ...NEUTRAL_GRADE, ...trait() };
    const defined = definedGrade(values);
    const saved = gradePresets().find((preset) => JSON.stringify(definedGrade({ ...NEUTRAL_GRADE, ...preset.grade })) === JSON.stringify(defined));
    if (saved) return saved.name;
    const look = lookLabel(values.look);
    const adjusted = Object.keys(defined).some((key) => key !== "look" && key !== "lookAmount");
    if (look && !adjusted) return t(look);
    if (look) return t("{look}, adjusted", { look: t(look) });
    return Object.keys(defined).length ? t("Custom") : t("Original");
  });

  const toggleHidden = () => editor.editProperty(props.grade, "hidden", !hidden());

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <ItemRow
          label={t("Grade")}
          value={label()}
          icon={<Icon name="color-grade" />}
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
            <TooltipContent>{t("Remove color grade")}</TooltipContent>
          </Tooltip>
        </ItemRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={toggleHidden}>{hidden() ? t("Unhide") : t("Hide")}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={props.onRemove}>{t("Remove")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
