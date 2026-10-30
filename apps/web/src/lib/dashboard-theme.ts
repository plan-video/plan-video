/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

export type DashboardTheme = "dark" | "light";

const STORAGE_KEY = "plan.dashboard-theme";

function storedTheme(): DashboardTheme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

const [choice, setChoice] = createSignal<DashboardTheme | null>(storedTheme());

/** Shared by the dashboard, the editor and the site; light until one is picked. */
export const dashboardTheme = (): DashboardTheme => choice() ?? "light";

export function setDashboardTheme(next: DashboardTheme) {
  setChoice(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be off (private windows); the choice then lasts the session.
  }
}

const RAIL_LABELS_KEY = "plan.dashboard-rail-labels";

function storedRailLabels(): boolean {
  try {
    return localStorage.getItem(RAIL_LABELS_KEY) !== "off";
  } catch {
    return true;
  }
}

const [railLabels, setRailLabelsSignal] = createSignal(storedRailLabels());

/** On until the user picks icons only. */
export const dashboardRailLabels = railLabels;

export function setDashboardRailLabels(next: boolean) {
  setRailLabelsSignal(next);
  try {
    localStorage.setItem(RAIL_LABELS_KEY, next ? "on" : "off");
  } catch {
    // Storage can be off (private windows); the choice then lasts the session.
  }
}
