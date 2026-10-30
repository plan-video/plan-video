/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { PageToggle } from "@/components/dashboard/page-toggle";
import { msg, t } from "@/lib/i18n";
import { defaultCalendarView, setDefaultCalendarView } from "./default-view";
import type { CalendarView } from "./types";

/** Week, month, and the same posts as a list. The list stays on the calendar. */
export type CalendarPage = CalendarView;

const PAGES = [
  { value: "week", label: msg("Week"), key: "W" },
  { value: "month", label: msg("Month"), key: "M" },
  { value: "list", label: msg("List"), key: "L" },
] as const;

export function CalendarViewToggle(props: { value: CalendarPage; onChange(page: CalendarPage): void }) {
  return <PageToggle label={t("Calendar view")} options={PAGES} value={props.value} onChange={props.onChange} />;
}

/** Picks the view the calendar opens in. It sits in Preferences, where the calendar's keys do nothing, so it names none. */
export function DefaultCalendarViewToggle() {
  return (
    <PageToggle
      label={t("View the calendar opens in")}
      options={PAGES.map(({ value, label }) => ({ value, label }))}
      value={defaultCalendarView()}
      onChange={setDefaultCalendarView}
    />
  );
}

/** Opens the calendar on today in that view. List stays on the calendar. */
export function useOpenCalendarPage() {
  const [, setParams] = useSearchParams();
  return (page: CalendarPage) =>
    setParams({
      dashboard: "calendar",
      date: undefined,
      time: undefined,
      view: page === defaultCalendarView() ? undefined : page,
    });
}
