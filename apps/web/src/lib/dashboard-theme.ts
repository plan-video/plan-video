/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { smoothly } from "@/lib/motion";

export type DashboardTheme = "dark" | "light";
export type ThemeModeChoice = DashboardTheme | "system";

const STORAGE_KEY = "plan.dashboard-theme";

function parseChoice(value: string | null): ThemeModeChoice | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

function storedTheme(): ThemeModeChoice | null {
  try {
    return parseChoice(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

const [choice, setChoice] = createSignal<ThemeModeChoice | null>(storedTheme());

const deviceQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
const [deviceTheme, setDeviceTheme] = createSignal<DashboardTheme>(deviceQuery?.matches ? "light" : "dark");
deviceQuery?.addEventListener("change", (event) => setDeviceTheme(event.matches ? "light" : "dark"));

export type ThemeSurface = "site" | "app";

/** Tested as index.html tests it before the first paint; EditorColorMode (app.tsx) keeps it right as the address changes. */
const atSite = () => typeof window !== "undefined" && !/^\/(dashboard|try|projects)(\/|$)/.test(location.pathname) && !/^\/(p|connect)\/[^/]+\/?$/.test(location.pathname);
const [surface, setSurface] = createSignal<ThemeSurface>(atSite() ? "site" : "app");

export function setThemeSurface(next: ThemeSurface) {
  setSurface(next);
}

/** Shared by the dashboard, the editor and the site; until one is picked, light on the site and dark in the app. */
export const dashboardTheme = (): DashboardTheme => {
  const picked = choice();
  if (picked === "system") return deviceTheme();
  return picked ?? (surface() === "site" ? "light" : "dark");
};

/** What was picked, before "system" turns into this device's light or dark. */
export const themeModeChoice = (): ThemeModeChoice => choice() ?? dashboardTheme();

export function setDashboardTheme(next: ThemeModeChoice) {
  const resolved = next === "system" ? deviceTheme() : next;
  if (resolved === dashboardTheme()) setChoice(next);
  else smoothly(() => void setChoice(next));
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage can be off (private windows); the choice then lasts the session.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) setChoice(parseChoice(event.newValue));
  });
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
