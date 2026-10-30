/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useWorld } from "@plan.video/koota-solid";
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  getEditHistory,
  pasteSelection,
  selectAll,
  selectChildren,
  selectParents,
  toggleSelectionHidden,
  useEditor,
  useSelection,
} from "@/engine";
import { captionWordSelection } from "@/engine/timeline/caption-word-selection";
import { t } from "@/lib/i18n";

export function EditMenu() {
  const world = useWorld();
  const editor = useEditor();
  const history = getEditHistory(world);
  const { nodes } = useSelection();
  const hasSelection = () => nodes().length > 0;

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!history.canUndo()} onSelect={() => history.undo()}>
          {t("Undo")}
          <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!history.canRedo()} onSelect={() => history.redo()}>
          {t("Redo")}
          <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection() && !captionWordSelection()}
          onSelect={() => copySelection(world)}
        >
          {t("Copy")}
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pasteSelection(world)}>
          {t("Paste")}
          <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => duplicateSelection(world)}
        >
          {t("Duplicate")}
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection() && !captionWordSelection()}
          onSelect={() => deleteSelection(world)}
        >
          {t("Delete")}
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => toggleSelectionHidden(world)}
        >
          {t("Hide")}
          <DropdownMenuShortcut>⇧⌘H</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={() => selectAll(world)}>
          {t("Select all")}
          <DropdownMenuShortcut>⌘A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => selectParents(world)}
        >
          {t("Select parent")}
          <DropdownMenuShortcut>{"\\"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => selectChildren(world)}
        >
          {t("Select children")}
          <DropdownMenuShortcut>↩︎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSelection()}
          onSelect={() => editor.clearSelection()}
        >
          {t("Deselect")}
          <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
