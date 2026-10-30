/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Icon } from "@/components/ui/icon";
import { LogoMark } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { useLocation, useNavigate } from "@solidjs/router";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { isInputTarget } from "@/utils";
import { appRoute, type ProjectRouteState } from "@/hooks/use-project-route";
import { t } from "@/lib/i18n";
import { FileMenu } from "./file-menu";
import { KeybindsDialog } from "./keybinds-dialog";
import { EditMenu } from "./edit-menu";
import { ViewMenu } from "./view-menu";
import { ToolMenu } from "./tool-menu";
import { HelpMenu } from "./help-menu";

/** The logo menu. `compact` drops the chevron, for a square spot like the editor's rail. */
export function ProjectMenu(props: { compact?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation<ProjectRouteState>();
  const [keybindsOpen, setKeybindsOpen] = createSignal(false);

  const handleOpenDashboard = () => {
    (document.activeElement as HTMLElement)?.blur?.();
    navigate(location.state?.returnTo ?? appRoute("projects"));
  };

  /**
   * Leaving the editor is the app's command rather than the runtime's, so its
   * key is bound here, with the item that offers it.
   */
  const handleShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.key.toLowerCase() !== "d" || isInputTarget(event)) return;

    event.preventDefault();
    handleOpenDashboard();
  };

  onMount(() => {
    window.addEventListener("keydown", handleShortcut);
    onCleanup(() => window.removeEventListener("keydown", handleShortcut));
  });

  return (
    <>
      <DropdownMenu placement="bottom-start">
        <Show
          when={props.compact}
          fallback={
            <DropdownMenuTrigger
              as="button"
              type="button"
              class="flex items-center gap-0 h-7 rounded-md text-muted-foreground outline-none focus-ring hover:text-foreground data-expanded:text-foreground"
            >
              <LogoMark class="size-5 mx-0.5 text-current" />
              <div class="flex items-center justify-center overflow-clip h-6 w-4">
                <Icon name="chevron-down" class="size-6" />
              </div>
            </DropdownMenuTrigger>
          }
        >
          {/* The mark alone, square, for the editor's rail. */}
          <DropdownMenuTrigger
            as="button"
            type="button"
            aria-label={t("Project menu")}
            class="grid size-8 place-items-center rounded-md text-muted-foreground outline-none focus-ring transition-colors hover:bg-accent hover:text-foreground data-expanded:bg-accent data-expanded:text-foreground"
          >
            {/* A pixel right: the P's stem carries its weight on the left. */}
            <LogoMark class="size-5 translate-x-px text-current" />
          </DropdownMenuTrigger>
        </Show>
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-[196px]">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={handleOpenDashboard}>
                {t("Go to dashboard")}
                <DropdownMenuShortcut>⇧⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("File")}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[196px]">
                    <FileMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t({ message: "Edit", context: "menu" })}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[196px]">
                    <EditMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("View")}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[216px]">
                    <ViewMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("Tool")}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[172px]">
                    <ToolMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t("Help")}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent class="w-[188px]">
                    <HelpMenu />
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuItem onSelect={() => setKeybindsOpen(true)}>
                {t("Keybinds")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      <KeybindsDialog open={keybindsOpen()} onOpenChange={setKeybindsOpen} />
    </>
  );
}
