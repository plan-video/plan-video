/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import type { CalendarView } from "./types";

const STORAGE_KEY = "plan.calendar-view";

export function isCalendarView(value: unknown): value is CalendarView {
  return value === "week" || value === "month" || value === "list";
}

function storedView(): CalendarView {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isCalendarView(saved) ? saved : "month";
  } catch {
    return "month";
  }
}

const [view, setView] = createSignal<CalendarView>(storedView());

export const defaultCalendarView = view;

export function setDefaultCalendarView(next: CalendarView) {
  setView(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be off (private windows); the choice then lasts the session.
  }
}
