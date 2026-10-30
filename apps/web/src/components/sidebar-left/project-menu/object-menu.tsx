/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useWorld } from "@plan.video/koota-solid";
import { Transition, TransitionIn, getParentEntity, isGroupLike, isSequence } from "@plan.video/runtime";
import { Or } from "koota";
import {
  groupSelection,
  ungroupSelection,
  unwrapSequenceSelection,
  useSelection,
  wrapSelectionInScene,
  wrapSelectionInSequence,
} from "@/engine";
import { removeTransitions } from "@/engine/transitions";
import { t } from "@/lib/i18n";

import type { Entity } from "koota";

export function ObjectMenu() {
  const world = useWorld();
  const { nodes } = useSelection();
  const hasSelection = () => nodes().length > 0;

  const hasContainer = () => nodes().some((node) => isGroupLike(node) || isSequence(node));
  const hasSequence = () => nodes().some(isSequence);

  /** The clips with a transition that are selected or sit inside something selected. */
  const transitionClips = (): Entity[] => {
    const selected = new Set(nodes());
    const inSelection = (clip: Entity) => {
      for (let node: Entity | null = clip; node; node = getParentEntity(node)) {
        if (selected.has(node)) return true;
      }
      return false;
    };
    return [...world.query(Or(Transition, TransitionIn))].filter(inSelection);
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("AI actions")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <ObjectAiMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => groupSelection(world)}
        >
          {t("Group")}
          <DropdownMenuShortcut>⌘G</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasContainer()}
          onSelect={() => ungroupSelection(world)}
        >
          {t("Ungroup")}
          <DropdownMenuShortcut>⇧⌘G</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => wrapSelectionInScene(world)}
        >
          {t("Wrap in scene")}
          <DropdownMenuShortcut>⌘↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => wrapSelectionInSequence(world)}
        >
          {t("Wrap in sequence")}
          <DropdownMenuShortcut>⌥⌘↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSequence()}
          onSelect={() => unwrapSequenceSelection(world)}
        >
          {t("Unwrap sequence")}
          <DropdownMenuShortcut>⌥⇧⌘↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Bring to front")}
          <DropdownMenuShortcut>]</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Bring forward")}
          <DropdownMenuShortcut>⌘]</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Send backward")}
          <DropdownMenuShortcut>⌘[</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Send to back")}
          <DropdownMenuShortcut>[</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Insert at playhead")}
          <DropdownMenuShortcut>’</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Insert on new track")}
          <DropdownMenuShortcut>⇧’</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Insert on canvas")}
          <DropdownMenuShortcut>⌥’</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Align")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <ObjectAlignMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Transform")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[196px]">
              <ObjectTransformMenu />
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Set mask target")}
          <DropdownMenuShortcut>⌃⌥M</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Reveal in assets")}
          <DropdownMenuShortcut>⇧⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Reveal in finder")}
          <DropdownMenuShortcut>⌥⌘O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Replace media...")}
          <DropdownMenuShortcut>⌥O</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Remove properties")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Remove effects")}</DropdownMenuItem>
        <DropdownMenuItem
          disabled={transitionClips().length === 0}
          onSelect={() => removeTransitions(world, transitionClips())}
        >
          {t("Remove transitions")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function ObjectAiMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Remove background")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Remove silences")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Lip sync")}</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function ObjectTransformMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Scale")}
          <DropdownMenuShortcut>K</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Flip horizontal")}
          <DropdownMenuShortcut>⇧H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Flip vertical")}
          <DropdownMenuShortcut>⇧V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>{t("Rotate 180°")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Rotate 90° left")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Rotate 90° right")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Reset transform")}</DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

export function ObjectAlignMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Align left")}
          <DropdownMenuShortcut>⌥A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Align horizontal centers")}
          <DropdownMenuShortcut>⌥H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Align right")}
          <DropdownMenuShortcut>⌥D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Align top")}
          <DropdownMenuShortcut>⌥W</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Align vertical centers")}
          <DropdownMenuShortcut>⌥V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Align bottom")}
          <DropdownMenuShortcut>⌥S</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Distribute horizontally")}
          <DropdownMenuShortcut>⌃⌥H</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Distribute vertically")}
          <DropdownMenuShortcut>⌃⌥V</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
