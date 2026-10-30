/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { FillItem } from "@/components/ui/fill-item";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useHas, useTrait } from "@plan.video/koota-solid";
import { Hidden, Paint, PaintType } from "@plan.video/runtime";
import { useEditor } from "@/engine/hooks";
import { msg, t } from "@/lib/i18n";

import type { Entity } from "koota";

type FillRowProps = {
  fill: Entity;
  onSelect(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
};

const FILL_TYPE_LABELS: Record<PaintType, string> = {
  [PaintType.SOLID]: msg("Solid"),
  [PaintType.IMAGE]: msg("Image"),
  [PaintType.VIDEO]: msg("Video"),
  [PaintType.LINEAR_GRADIENT]: msg("Gradient"),
  [PaintType.RADIAL_GRADIENT]: msg("Gradient"),
  [PaintType.WAVEFORM]: msg("Waveform"),
  [PaintType.HTML]: "Html",
  [PaintType.SURFACE]: msg("Surface"),
  [PaintType.SHADER]: msg("Shader"),
};

export function FillRow(props: FillRowProps) {
  const editor = useEditor();

  const paint = useTrait(() => props.fill, Paint);
  const hidden = useHas(() => props.fill, Hidden);

  const label = createMemo(() => t(FILL_TYPE_LABELS[paint()?.value ?? PaintType.SOLID] ?? "Solid"));

  const toggleHidden = () => {
    editor.editProperty(props.fill, "hidden", !hidden());
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label={label()}
        class={hidden() ? "opacity-50" : undefined}
      >
        <FillItem fill={props.fill} onClick={props.onSelect} />
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
