/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { toast } from "somoto";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { startEditorTour } from "@/components/tour/editor-tour";
import { useAuth } from "@/context/auth";
import { t } from "@/lib/i18n";

export function HelpMenu() {
  const auth = useAuth();

  const copyUserId = async () => {
    const id = auth.user()?.id;
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      toast(t("Copied!"), { description: t("The user id has been copied to your clipboard.") });
    } catch (error) {
      toast(t("Failed to copy"), { description: error instanceof Error ? error.message : t("Unknown error") });
    }
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={startEditorTour}>{t("Take the tour")}</DropdownMenuItem>
        <DropdownMenuItem as="a" href="https://discord.gg/4C3g9FZsyr" target="_blank">
          {t("Discord community")}
        </DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={copyUserId}>{t("Copy user id")}</DropdownMenuItem>
        <DropdownMenuItem as="a" href="https://discord.gg/4C3g9FZsyr" target="_blank">
          {t("Contact support")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
