/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { createEffect } from "solid-js";

import { hydrateCalendar } from "@/components/calendar/store";
import type { DashboardView } from "@/components/dashboard/types";
import { useAuth } from "@/context/auth";
import { msg } from "@/lib/i18n";
import { loadQueueSlots } from "@/lib/queue-slots";

export function useQueueSlots() {
  const auth = useAuth();
  createEffect(() => loadQueueSlots(auth.ownerId()));
  void hydrateCalendar();
}

export const QUEUE_RETURN_LABELS: Partial<Record<DashboardView, string>> = {
  "new-post": msg("New post"),
  "bulk-tools": msg("Bulk tools"),
};

export function useOpenQueueSettings() {
  const [params, setParams] = useSearchParams();
  return () => {
    const from = typeof params.dashboard === "string" && params.dashboard in QUEUE_RETURN_LABELS ? params.dashboard : undefined;
    setParams({ dashboard: "queue", back: from });
  };
}
