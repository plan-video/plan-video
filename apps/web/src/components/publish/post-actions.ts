/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { toast } from "somoto";

import { moveEvent } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";
import { localDateKey } from "@/components/calendar/utils";
import { handOffPost } from "@/components/publish/handoff";
import { hasFailed, sendPost } from "@/components/publish/publisher";
import { atLocal, timeOf } from "@/components/publish/save";
import { useAuth } from "@/context/auth";
import { askForAccount } from "@/lib/guest";
import { t } from "@/lib/i18n";

export function usePostActions() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();

  const edit = (post: StoredEvent, replace: boolean) => {
    handOffPost(post, replace);
    setParams({ dashboard: "new-post", date: undefined, view: undefined });
  };

  /** A post meant for later moves to now first, so it sits where it went out. */
  const send = async (post: StoredEvent) => {
    // Nothing goes out from guest mode's demo.
    if (auth.isGuest()) return askForAccount({ reason: "post" });
    const at = atLocal(post.day, post.allDay ? "00:00" : post.start);
    if (!post.recurrence && !hasFailed(post) && at && at.getTime() > Date.now()) {
      const now = new Date();
      moveEvent({ sourceId: post.id, day: localDateKey(now), start: timeOf(now) });
    }
    const result = await sendPost(post.id, auth.user()?.id);
    if (result !== "needs-media") return;
    edit(post, true);
    toast(t("Attach its media again"), {
      description: post.recurrence
        ? t("This series was saved without the video or pictures it goes out with. Add them, then save the series so its next runs go out with them.")
        : t("This post was saved without the video or pictures it goes out with. Add them, then press Post now."),
    });
  };

  const openCalendar = (post: StoredEvent) => setParams({ dashboard: "calendar", date: post.day, view: undefined });

  const upgrade = () => setParams({ dashboard: "billing", date: undefined, view: undefined });

  return { edit, send, openCalendar, upgrade };
}
