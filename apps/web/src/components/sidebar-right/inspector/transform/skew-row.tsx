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
import { Computed } from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";

import type { Entity } from "koota";

export type SkewRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

// No keyframe diamonds: the motion system animates skew as `skew.x`/`skew.y`, which a track cannot name yet.
export function SkewRow(props: SkewRowProps) {
  const skewX = useDerived(() => props.node.get(Computed)?.skewX ?? 0);
  const skewY = useDerived(() => props.node.get(Computed)?.skewY ?? 0);

  const isDefault = createMemo(() => skewX() === 0 && skewY() === 0);

  const editor = useEditor();

  const updateSkew = (axis: 'x' | 'y', value: number) => {
    editor.editProperty(props.node, axis === 'x' ? 'skewX' : 'skewY', value === 0 ? false : value);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label={t("Skew")}
        contentClass="grid grid-cols-2 gap-2"
      >
        <ControlledTextField
          icon={<Icon name="prop-x-position" />}
          value={skewX()}
          onNumber={(value) => updateSkew('x', value)}
          step={1}
          unit="°"
          autoSelect
          sliderEnabled
          limitEvents
        />
        <ControlledTextField
          icon={<Icon name="prop-y-position" />}
          value={skewY()}
          onNumber={(value) => updateSkew('y', value)}
          step={1}
          unit="°"
          autoSelect
          sliderEnabled
          limitEvents
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={isDefault()}
          onSelect={() => {
            updateSkew('x', 0);
            updateSkew('y', 0);
          }}
        >
          {t("Reset to Default")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          {t("Remove row")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
