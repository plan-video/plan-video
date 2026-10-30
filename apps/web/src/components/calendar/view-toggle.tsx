/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { PageToggle } from "@/components/dashboard/page-toggle";
import { msg, t } from "@/lib/i18n";
import { defaultCalendarView, setDefaultCalendarView } from "./default-view";
import type { CalendarView } from "./types";

export type CalendarPage = CalendarView;

const PAGES = [
  { value: "week", label: msg("Week"), key: "W" },
  { value: "month", label: msg("Month"), key: "M" },
  { value: "list", label: msg("List"), key: "L" },
] as const;

export function CalendarViewToggle(props: { value: CalendarPage; onChange(page: CalendarPage): void }) {
  return <PageToggle label={t("Calendar view")} options={PAGES} value={props.value} onChange={props.onChange} />;
}

/** Names no shortcut keys: in Preferences the calendar's keys do nothing. */
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
