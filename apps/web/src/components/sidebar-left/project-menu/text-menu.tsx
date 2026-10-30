/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { t } from "@/lib/i18n";

export function TextMenu() {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Bold")}
          <DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Italic")}
          <DropdownMenuShortcut>⌘I</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Underline")}
          <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Strikethrough")}
          <DropdownMenuShortcut>⇧⌘X</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Text align left")}
          <DropdownMenuShortcut>⌥⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Text align center")}
          <DropdownMenuShortcut>⌥⌘T</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Text align right")}
          <DropdownMenuShortcut>⌥⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Text align justified")}
          <DropdownMenuShortcut>⌥⌘J</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>
          {t("Wrap in caption group")}
          <DropdownMenuShortcut>⇧⌥C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          {t("Detach caption group")}
          <DropdownMenuShortcut>⌥⌘B</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
