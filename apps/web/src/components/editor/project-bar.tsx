/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ProjectNameInput } from "@/components/sidebar-left";

export const PROJECT_BAR_HEIGHT = 44;

export function ProjectBar() {
  return (
    <div
      class="flex shrink-0 items-center border-b border-border px-2"
      style={{ height: `${PROJECT_BAR_HEIGHT}px` }}
    >
      <ProjectNameInput class="ml-0 min-w-0 px-1.5 text-[13px] font-medium text-foreground" />
    </div>
  );
}
