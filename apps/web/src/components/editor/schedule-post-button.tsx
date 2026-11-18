/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from "@solidjs/router";

import { Button } from "@/components/ui/button";
import { useProject } from "@/context/project";
import { useProjectConfig } from "@/engine/project-config";
import { appRoute } from "@/hooks/use-project-route";
import { t } from "@/lib/i18n";
import { queueTemplate } from "@/lib/post-templates";
import { handPostVideo, type PostVideo } from "@/projects/post-export";

export function useSchedulePost() {
  const navigate = useNavigate();
  const project = useProject();
  const config = useProjectConfig();

  return (video?: Omit<PostVideo, "key">) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const post = config()?.post();
    if (post) queueTemplate(post);
    const id = project.id();
    handPostVideo(id && video ? { key: id, ...video } : null);
    navigate(id ? `${appRoute("new-post")}&project=${encodeURIComponent(id)}` : appRoute("new-post"));
  };
}

export function SchedulePostButton() {
  const schedulePost = useSchedulePost();

  return (
    <Button class="shrink-0 px-2.5" onClick={() => schedulePost()} data-tour="schedule-post">
      {t("Schedule post")}
    </Button>
  );
}
