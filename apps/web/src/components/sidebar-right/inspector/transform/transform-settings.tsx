/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, createSignal, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Keyframe } from "@/components/ui/keyframe";
import { useWorld } from "@plan.video/koota-solid";
import {
  Anchor,
  Computed,
  Constraint,
  ConstraintType,
  Flip,
  Offset,
  Rotation,
  Scale,
  Skew,
  UniformScale,
  getParentEntity,
  isAdjustmentLayer,
  isScene,
  isSequence,
} from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { findKeyframeTrack, syncKeyframe } from "@/engine/keyframes";
import { RotateRow } from "./rotate-row";
import { AnchorRow } from "./anchor-row";
import { OffsetRow } from "./offset-row";
import { ScaleRow } from "./scale-row";
import { SkewRow } from "./skew-row";
import { ConstraintsRow } from "./constraints-row";
import { t } from "@/lib/i18n";

import type { AnimatableProperty } from "@plan.video/jsx";
import type { Entity, World } from "koota";

type TransformSettingsProps = {
  selection: Entity[];
};

type TransformAddon = 'rotate' | 'anchor' | 'offset' | 'scale' | 'skew' | 'constraints';
type TransformAddons = Partial<Record<TransformAddon, boolean>>;

const TRACKED: Partial<Record<TransformAddon, AnimatableProperty[]>> = {
  rotate: ['rotation'],
  offset: ['offsetX', 'offsetY'],
  scale: ['scale', 'scaleX', 'scaleY'],
};

/**
 * Whether the node already sets what a row edits, away from its default or
 * on a keyframe track. The traits hold the authored values (motion only
 * writes Computed), and an unset prop leaves its trait at the default.
 */
function setsAddon(world: World, node: Entity, addon: TransformAddon): boolean {
  if (TRACKED[addon]?.some((property) => findKeyframeTrack(world, node, property))) return true;
  switch (addon) {
    case 'rotate': {
      const flip = node.get(Flip);
      return (node.get(Rotation)?.value ?? 0) !== 0 || flip?.x === -1 || flip?.y === -1;
    }
    case 'anchor': {
      const anchor = node.get(Anchor);
      return anchor !== undefined && (anchor.x !== 0.5 || anchor.y !== 0.5);
    }
    case 'offset': {
      const offset = node.get(Offset);
      return (offset?.x ?? 0) !== 0 || (offset?.y ?? 0) !== 0;
    }
    case 'scale': {
      const scale = node.get(Scale);
      return (node.get(UniformScale)?.value ?? 1) !== 1 || (scale?.x ?? 1) !== 1 || (scale?.y ?? 1) !== 1;
    }
    case 'skew': {
      const skew = node.get(Skew);
      return (skew?.x ?? 0) !== 0 || (skew?.y ?? 0) !== 0;
    }
    case 'constraints': {
      const constraint = node.get(Constraint);
      return (constraint?.horizontal ?? ConstraintType.MIN) !== ConstraintType.MIN
        || (constraint?.vertical ?? ConstraintType.MIN) !== ConstraintType.MIN;
    }
  }
}

/**
 * Where a node sits and how it is transformed there. Position, rotation,
 * offset, scale and constraints are props (`x`/`y`, `rotation`,
 * `offsetX`/`offsetY`, `scale` or `scaleX`/`scaleY`,
 * `constrainX`/`constrainY`) written through the editor; anchor, flip and
 * skew have no JSX spelling and are written to their traits alone, so they do
 * not survive a recompile. The rows below Position are per node: a row shows
 * when the node sets what it edits, or once it is added here, so rows added
 * on one clip don't follow every other layer.
 */
export function TransformSettings(props: TransformSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  // Rows added or removed here; the rest follow what the node sets. The
  // inspector remounts on a new selection, which starts this afresh.
  const [toggled, setToggled] = createSignal<TransformAddons>({});

  const positionX = useDerived(() => entity().get(Computed)?.positionX ?? 0);
  const positionY = useDerived(() => entity().get(Computed)?.positionY ?? 0);

  // Position is where the node is rather than a modifier of it, so it is
  // written out even at 0, the way a drag on the canvas writes it.
  const updatePositionX = (x: number) => {
    editor.editProperty(entity(), 'x', x);
    syncKeyframe(world, editor, entity(), 'x', x);
  };

  const updatePositionY = (y: number) => {
    editor.editProperty(entity(), 'y', y);
    syncKeyframe(world, editor, entity(), 'y', y);
  };

  // Mirrors the runtime's own rule (see resolveConstraintOffsets): a sequence
  // is not a spatial parent, so look above it, and constraints only mean
  // something against a scene's frame.
  const supportsConstraints = createMemo(() => {
    const node = entity();
    if (isSequence(node) || isAdjustmentLayer(node)) return false;

    let parent = getParentEntity(node);
    while (parent !== null && isSequence(parent)) {
      parent = getParentEntity(parent);
    }

    return parent !== null && isScene(parent);
  });

  const showAddon = (addon: TransformAddon) => toggled()[addon] ?? setsAddon(world, entity(), addon);
  const toggleAddon = (addon: TransformAddon, on: boolean) => {
    setToggled({ ...toggled(), [addon]: on });
  };

  return (
    <PanelSection
      title={t("Transform")}
      actions={
        <Show when={!showAddon('rotate') || !showAddon('anchor') || !showAddon('offset') || !showAddon('scale') || !showAddon('skew') || !showAddon('constraints')}>
          <DropdownMenu placement="bottom-end">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button size="icon" variant="ghost" class="text-muted-foreground" {...buttonProps}>
                        <Icon name="plus-add" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>{t("Add transform")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <Show when={!showAddon('rotate')}>
                <DropdownMenuItem onSelect={() => toggleAddon('rotate', true)}>
                  {t("Rotate")}
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('constraints')}>
                <DropdownMenuItem onSelect={() => toggleAddon('constraints', true)}>
                  {t("Constraints")}
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('anchor')}>
                <DropdownMenuItem onSelect={() => toggleAddon('anchor', true)}>
                  {t("Anchor")}
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('offset')}>
                <DropdownMenuItem onSelect={() => toggleAddon('offset', true)}>
                  {t("Offset")}
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('scale')}>
                <DropdownMenuItem onSelect={() => toggleAddon('scale', true)}>
                  {t("Scale")}
                </DropdownMenuItem>
              </Show>
              <Show when={!showAddon('skew')}>
                <DropdownMenuItem onSelect={() => toggleAddon('skew', true)}>
                  {t("Skew")}
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      }
    >
      <ControlRow label={t("Position")}>
        <div class="grid grid-cols-2 gap-2">
          <ControlledTextField
            icon={<Icon name="prop-x-position" />}
            keyframe={<Keyframe target={entity()} property="x" />}
            value={positionX()}
            onNumber={updatePositionX}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
          <ControlledTextField
            icon={<Icon name="prop-y-position" />}
            keyframe={<Keyframe target={entity()} property="y" />}
            value={positionY()}
            onNumber={updatePositionY}
            step={1}
            autoSelect
            sliderEnabled
            limitEvents
          />
        </div>
      </ControlRow>

      <Show when={showAddon('constraints') && supportsConstraints()}>
        <ConstraintsRow node={entity()} />
      </Show>

      <Show when={showAddon('rotate')}>
        <RotateRow node={entity()} onRemoveAddon={() => toggleAddon('rotate', false)} />
      </Show>

      <Show when={showAddon('anchor')}>
        <AnchorRow node={entity()} onRemoveAddon={() => toggleAddon('anchor', false)} />
      </Show>

      <Show when={showAddon('offset')}>
        <OffsetRow node={entity()} onRemoveAddon={() => toggleAddon('offset', false)} />
      </Show>

      <Show when={showAddon('scale')}>
        <ScaleRow node={entity()} onRemoveAddon={() => toggleAddon('scale', false)} />
      </Show>

      <Show when={showAddon('skew')}>
        <SkewRow node={entity()} onRemoveAddon={() => toggleAddon('skew', false)} />
      </Show>
    </PanelSection>
  );
}
