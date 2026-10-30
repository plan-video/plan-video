/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { t } from "@/lib/i18n";
import { revealPath } from "@/lib/shell";
import { isDesktop, pickProjectsRoot, projectsRoot } from "@/projects";

/** Desktop only: projects live on disk, so the browser build has no root to show (see @/projects). */
export function DashboardProjectsFolderBar() {
  const rootLabel = () => projectsRoot() ?? t("No folder selected");
  const hasRoot = () => !!projectsRoot();

  const handleChange = async () => {
    try {
      await pickProjectsRoot();
    } catch (e) {
      toast.error(t("Failed to choose projects folder"), { description: (e as Error).message });
    }
  };

  const handleReveal = async () => {
    const root = projectsRoot();
    if (!root) return;

    try {
      await revealPath(root);
    } catch (e) {
      toast.error(t("Failed to reveal projects folder"), { description: (e as Error).message });
    }
  };

  return (
    <Show when={isDesktop()}>
      <div class="flex shrink-0 flex-col gap-3 border-t border-border px-4 py-3">
        <div class="flex items-center gap-4">
          <div class="flex min-w-0 flex-1 items-start gap-2">
            <span class="relative size-4 shrink-0 text-muted-foreground">
              <Icon
                name="navigation.folder"
                class="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2"
              />
            </span>
            <div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
              <p class="h-4 text-xs text-foreground">{t("Projects folder")}</p>
              <p class="min-w-0 truncate text-xs text-muted-foreground">
                {rootLabel()}
              </p>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Show when={hasRoot()}>
              <Button variant="ghost" class="text-muted-foreground" onClick={handleReveal}>
                {t("Reveal in finder")}
              </Button>
            </Show>
            <Button variant="secondary" onClick={handleChange}>
              {hasRoot() ? t("Change...") : t("Choose folder...")}
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
