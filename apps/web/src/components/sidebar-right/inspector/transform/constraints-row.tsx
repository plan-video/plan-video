/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectIconTrigger,
  SelectItem,
  SelectPortal,
} from "@/components/ui/select";
import {
  horizontalConstraintName,
  horizontalConstraints,
  verticalConstraintName,
  verticalConstraints,
} from "./constants";
import { useTrait } from "@plan.video/koota-solid";
import { Constraint, ConstraintType } from "@plan.video/runtime";
import { useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";

import type { Entity } from "koota";

type ConstraintsRowProps = {
  node: Entity;
};

// The runtime seeds its cache the first time it sees a node with a constraint, so one set here moves nothing
// until the frame changes. `MIN` (pinned where the node already is) spells as the prop's absence.
export function ConstraintsRow(props: ConstraintsRowProps) {
  const editor = useEditor();
  const constraint = useTrait(() => props.node, Constraint);
  const horizontal = () => constraint()?.horizontal ?? ConstraintType.MIN;
  const vertical = () => constraint()?.vertical ?? ConstraintType.MIN;

  const assignHorizontal = (value: ConstraintType | null) => {
    if (value == null) return;
    editor.editProperty(
      props.node,
      "constrainX",
      value === ConstraintType.MIN ? false : horizontalConstraintName(value),
    );
  };

  const assignVertical = (value: ConstraintType | null) => {
    if (value == null) return;
    editor.editProperty(
      props.node,
      "constrainY",
      value === ConstraintType.MIN ? false : verticalConstraintName(value),
    );
  };

  const assignCenter = () => {
    assignHorizontal(ConstraintType.CENTER);
    assignVertical(ConstraintType.CENTER);
  };

  return (
    <ControlRow
      label=""
      labelClass="opacity-0"
      class="items-start"
      contentClass="grid grid-cols-2 gap-2"
    >
      <div class="flex flex-col gap-2 min-w-0">
        <Select<ConstraintType>
          value={horizontal()}
          onChange={(value) => assignHorizontal(value)}
          options={horizontalConstraints.map((c) => c.key)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {t(horizontalConstraints.find((c) => c.key === itemProps.item.rawValue)?.label ?? "")}
            </SelectItem>
          )}
        >
          <SelectIconTrigger<ConstraintType>
            icon={<Icon name="pin-left-right" />}
            valueClass="text-xs"
          >
            {(state) =>
              t(horizontalConstraints.find((c) => c.key === state.selectedOption())?.label ?? "")
            }
          </SelectIconTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>

        <Select<ConstraintType>
          value={vertical()}
          onChange={(value) => assignVertical(value)}
          options={verticalConstraints.map((c) => c.key)}
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>
              {t(verticalConstraints.find((c) => c.key === itemProps.item.rawValue)?.label ?? "")}
            </SelectItem>
          )}
        >
          <SelectIconTrigger<ConstraintType>
            icon={<Icon name="pin-top-bottom" />}
            valueClass="text-xs"
          >
            {(state) =>
              t(verticalConstraints.find((c) => c.key === state.selectedOption())?.label ?? "")
            }
          </SelectIconTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
      </div>

      <div class="h-16 bg-input rounded-md relative min-w-0">
        <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-7 bg-muted rounded-sm overflow-hidden flex items-center justify-center">
          <div class="size-6 overflow-hidden flex items-center justify-center text-muted-foreground">
            <Icon name="plus-add" />
          </div>
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 -ml-[23px] cursor-pointer py-1"
          onClick={() => assignHorizontal(ConstraintType.MIN)}
        >
          <div
            class="w-2.5 h-0.5 rounded-sm"
            classList={{
              "bg-primary": horizontal() === ConstraintType.MIN || horizontal() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": horizontal() !== ConstraintType.MIN && horizontal() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-y-1/2 -translate-x-1/2 ml-[23px] cursor-pointer py-1"
          onClick={() => assignHorizontal(ConstraintType.MAX)}
        >
          <div
            class="w-2.5 h-0.5 rounded-sm"
            classList={{
              "bg-primary": horizontal() === ConstraintType.MAX || horizontal() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": horizontal() !== ConstraintType.MAX && horizontal() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -mt-[23px] cursor-pointer px-1"
          onClick={() => assignVertical(ConstraintType.MIN)}
        >
          <div
            class="w-0.5 h-2.5 rounded-sm"
            classList={{
              "bg-primary": vertical() === ConstraintType.MIN || vertical() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": vertical() !== ConstraintType.MIN && vertical() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 mt-[23px] cursor-pointer px-1"
          onClick={() => assignVertical(ConstraintType.MAX)}
        >
          <div
            class="w-0.5 h-2.5 rounded-sm"
            classList={{
              "bg-primary": vertical() === ConstraintType.MAX || vertical() === ConstraintType.STRETCH,
              "bg-muted-foreground/40 group-hover:bg-muted-foreground/70": vertical() !== ConstraintType.MAX && vertical() !== ConstraintType.STRETCH
            }}
          />
        </div>

        <div
          class="group absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer p-1"
          onClick={assignCenter}
        >
          <div class="relative size-2.5">
            <div
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-0.5 rounded-sm"
              classList={{
                "bg-primary": horizontal() === ConstraintType.CENTER,
                "bg-transparent group-hover:bg-muted-foreground/40": horizontal() !== ConstraintType.CENTER
              }}
            />
            <div
              class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-2.5 rounded-sm"
              classList={{
                "bg-primary": vertical() === ConstraintType.CENTER,
                "bg-transparent group-hover:bg-muted-foreground/40": vertical() !== ConstraintType.CENTER
              }}
            />
          </div>
        </div>
      </div>
    </ControlRow>
  );
}
