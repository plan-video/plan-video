/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useTrait } from "@plan.video/koota-solid";
import { Anchor } from "@plan.video/runtime";
import { useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";
import { AnchorPointPicker } from "./anchor-picker";

import type { Entity } from "koota";

export type AnchorRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

/**
 * The pivot rotation, scale and skew turn about, as a fraction of the box,
 * written as `anchorX`/`anchorY` so it is saved and undone like any prop.
 * The document sets both axes of the trait on every write: the trait's own
 * defaults are (0, 0) while a node without one pivots about its centre.
 */
export function AnchorRow(props: AnchorRowProps) {
  const anchor = useTrait(() => props.node, Anchor);
  const anchorX = () => anchor()?.x ?? 0.5;
  const anchorY = () => anchor()?.y ?? 0.5;

  const isDefault = createMemo(() => anchorX() === 0.5 && anchorY() === 0.5);

  const editor = useEditor();

  /** Both axes as `anchorX`/`anchorY`, the centre as no prop at all; only what changed is written. */
  const assignAnchor = (x: number, y: number) => {
    if (x !== anchorX()) editor.editProperty(props.node, 'anchorX', x === 0.5 ? false : x);
    if (y !== anchorY()) editor.editProperty(props.node, 'anchorY', y === 0.5 ? false : y);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label={t("Anchor")}
        class="items-start"
        labelClass="pt-1.5"
        contentClass="flex gap-2 items-center"
      >
        <div class="flex flex-col gap-2 flex-1 min-w-0">
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            value={Math.round(anchorX() * 100)}
            onNumber={(value) => assignAnchor(value / 100, anchorY())}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            value={Math.round(anchorY() * 100)}
            onNumber={(value) => assignAnchor(anchorX(), value / 100)}
            step={1}
            unit="%"
            autoSelect
            sliderEnabled
          />
        </div>
        <AnchorPointPicker x={anchorX()} y={anchorY()} onPick={assignAnchor} />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={isDefault()} onSelect={() => assignAnchor(0.5, 0.5)}>
          {t("Reset to Default")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          {t("Remove row")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
