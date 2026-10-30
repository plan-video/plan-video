/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from "@solidjs/router";
import CalendarClockIcon from "lucide-solid/icons/calendar-clock";

import { Button } from "@/components/ui/button";
import { useProject } from "@/context/project";
import { useProjectConfig } from "@/engine/project-config";
import { appRoute } from "@/hooks/use-project-route";
import { t } from "@/lib/i18n";
import { queueTemplate } from "@/lib/post-templates";

/**
 * Takes the project to a new post: the composer gets it by its key and
 * renders its video in the background. Leaving the editor saves what is
 * still unsaved on the way. A project a workflow set up for a post opens
 * the composer with that post's accounts, caption and timing filled in.
 */
export function useSchedulePost() {
  const navigate = useNavigate();
  const project = useProject();
  const config = useProjectConfig();

  return () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const post = config()?.post();
    if (post) queueTemplate(post);
    const id = project.id();
    navigate(id ? `${appRoute("new-post")}&project=${encodeURIComponent(id)}` : appRoute("new-post"));
  };
}

export function SchedulePostButton() {
  const schedulePost = useSchedulePost();

  return (
    <Button
      class="gap-1.5 pl-2 pr-2.5"
      style="-webkit-app-region: no-drag;"
      onClick={schedulePost}
      data-tour="schedule-post"
    >
      <CalendarClockIcon class="size-3.5" stroke-width={2} />
      {t("Schedule post")}
    </Button>
  );
}
