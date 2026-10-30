/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { createSignal, onCleanup } from "solid-js";
import { defaultCalendarView, isCalendarView } from "./default-view";
import { isDateKey, localDateKey, localMinutes } from "./utils";
import type { CalendarView } from "./types";

export type CalendarNavigation = {
  date(): string;
  go(date: string, view?: CalendarView): void;
  /** Null shows the whole month. */
  picked(): string | null;
  pick(day: string): void;
  nowMinutes(): number;
  today(): string;
  view(): CalendarView;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const POST_LISTS = new Set(["posts", "scheduled", "posted", "drafts", "failed"]);

/** The URL leaves out the view picked in Preferences. */
export function useCalendarNavigation(): CalendarNavigation {
  const [params, setParams] = useSearchParams();
  const [now, setNow] = createSignal(new Date());

  const timer = window.setInterval(() => setNow(new Date()), 30_000);
  onCleanup(() => window.clearInterval(timer));

  const today = () => localDateKey(now());
  const view = (): CalendarView => {
    const page = first(params.dashboard);
    if (page && POST_LISTS.has(page)) return "list";
    const raw = first(params.view);
    return isCalendarView(raw) ? raw : defaultCalendarView();
  };
  const date = () => {
    const raw = first(params.date);
    return isDateKey(raw) ? raw : today();
  };

  const picked = () => {
    const raw = first(params.on);
    return isDateKey(raw) && raw === date() ? raw : null;
  };
  const go = (next: string, nextView = view(), on?: string) =>
    setParams(
      {
        dashboard: "calendar",
        date: next === today() ? undefined : next,
        view: nextView === defaultCalendarView() ? undefined : nextView,
        on,
      },
      { replace: true },
    );

  return {
    date,
    go: (next, nextView) => go(next, nextView),
    picked,
    pick: (day) => go(day, view(), picked() === day ? undefined : day),
    nowMinutes: () => localMinutes(now()),
    today,
    view,
  };
}
