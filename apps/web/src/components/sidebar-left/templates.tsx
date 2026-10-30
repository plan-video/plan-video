/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SidebarTabs } from "@/agent-chat";
import { SceneTemplatePanel } from "@/components/sidebar-right/inspector/scene-template";

/** The left sidebar's Layout tab: stream layouts and video sizes for the scene. */
export function TemplatePanel() {
  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <div class="flex min-w-0 flex-1 items-center">
          <SidebarTabs />
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <SceneTemplatePanel />
      </div>
    </div>
  );
}
