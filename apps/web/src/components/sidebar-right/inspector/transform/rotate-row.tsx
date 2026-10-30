/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo } from 'solid-js';
import { ControlRow } from '@/components/ui/control-group';
import { Icon } from '@/components/ui/icon';
import { ControlledTextField } from '@/components/ui/text-field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Keyframe } from '@/components/ui/keyframe';
import { useTrait, useWorld } from '@plan.video/koota-solid';
import { Computed, Flip } from '@plan.video/runtime';
import { useDerived, useEditor } from '@/engine/hooks';
import { syncKeyframe } from '@/engine/keyframes';
import { t } from '@/lib/i18n';

import type { Entity } from 'koota';

type RotateRowProps = {
  node: Entity;
  onRemoveAddon(): void;
};

/**
 * `rotation` is a prop, unset at 0; the two flips are `flipX`/`flipY`, unset
 * when the node is the right way round.
 */
export function RotateRow(props: RotateRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const rotation = useDerived(() => props.node.get(Computed)?.rotation ?? 0);
  const flip = useTrait(() => props.node, Flip);
  const flipX = () => flip()?.x ?? 1;
  const flipY = () => flip()?.y ?? 1;

  const isDefault = createMemo(() => rotation() === 0 && flipX() === 1 && flipY() === 1);

  const updateRotation = (value: number) => {
    editor.editProperty(props.node, 'rotation', value === 0 ? false : value);
    syncKeyframe(world, editor, props.node, 'rotation', value);
  };

  const setFlip = (axis: 'x' | 'y', value: -1 | 1) => {
    editor.editProperty(props.node, axis === 'x' ? 'flipX' : 'flipY', value === -1);
  };

  const handleResetToDefault = () => {
    updateRotation(0);
    setFlip('x', 1);
    setFlip('y', 1);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger<typeof ControlRow>
        as={ControlRow}
        label={t("Rotate")}
        contentClass="flex gap-2 items-center"
      >
        <ControlledTextField
          class="flex-1"
          icon={<Icon name="rotate-angle" />}
          value={rotation()}
          onNumber={updateRotation}
          unit={'°'}
          autoSelect
          sliderEnabled
          limitEvents
          keyframe={<Keyframe target={props.node} property="rotation" />}
        />
        <div class="flex flex-1 gap-px rounded-md overflow-hidden">
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex-1 h-7 bg-input flex items-center justify-center hover:bg-input/80 text-foreground"
              onClick={() => updateRotation(rotation() + 90)}
            >
              <Icon name="rotate-90" class="size-5" />
            </TooltipTrigger>
            <TooltipContent>{t("Rotate 90")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex-1 h-7 bg-input flex items-center justify-center hover:bg-input/80 text-foreground"
              onClick={() => setFlip('x', flipX() === 1 ? -1 : 1)}
            >
              <Icon name="flip-horizontal" class="size-5" />
            </TooltipTrigger>
            <TooltipContent>{t("Flip Horizontal")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              as="button"
              type="button"
              class="flex-1 h-7 bg-input flex items-center justify-center hover:bg-input/80 text-foreground"
              onClick={() => setFlip('y', flipY() === 1 ? -1 : 1)}
            >
              <Icon name="flip-vertical" class="size-5" />
            </TooltipTrigger>
            <TooltipContent>{t("Flip Vertical")}</TooltipContent>
          </Tooltip>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem disabled={isDefault()} onSelect={handleResetToDefault}>
          {t("Reset to Default")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={props.onRemoveAddon}>
          {t("Remove row")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
