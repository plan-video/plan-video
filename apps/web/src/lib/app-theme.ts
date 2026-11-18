/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { msg } from "@/lib/i18n";
import { smoothly } from "@/lib/motion";
import { DEFAULT_THEME, cleanThemeName, parseThemeSpec, themeCss, type ThemeSpec } from "@/lib/theme-palette";

export type SavedTheme = { id: string; name: string; spec: ThemeSpec };
type ThemeStore = { active: string; custom: SavedTheme[] };

export const DEFAULT_THEME_ID = "plan-video";

const preset = (id: string, name: string, changes: Partial<ThemeSpec>): SavedTheme => ({ id, name, spec: { ...DEFAULT_THEME, ...changes } });

export const THEME_PRESETS: readonly SavedTheme[] = [
  { id: DEFAULT_THEME_ID, name: "plan.video", spec: DEFAULT_THEME },
  preset("graphite", msg("Graphite"), { tint: 0 }),
  preset("midnight", msg("Midnight"), { hue: 270, tint: 30, brightness: 26, accent: "#6d7dff" }),
  preset("ocean", msg("Ocean"), { hue: 225, tint: 24, brightness: 24, accent: "#0ea5c6" }),
  preset("forest", msg("Forest"), { hue: 155, tint: 22, brightness: 24, accent: "#1f9d5c" }),
  preset("plum", msg("Plum"), { hue: 325, tint: 26, brightness: 26, accent: "#b24bd6" }),
  preset("rose", msg("Rose"), { hue: 12, tint: 20, brightness: 24, accent: "#e23a62" }),
  preset("mono", msg("Mono"), { tint: 0, brightness: 0, accent: "#f2f2f2", corners: 20 }),
];

const STORE_KEY = "plan.theme";
const CSS_KEY = "plan.theme-css";

function parseStore(raw: string | null): ThemeStore {
  const empty: ThemeStore = { active: DEFAULT_THEME_ID, custom: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { active?: unknown; custom?: unknown };
    const custom: SavedTheme[] = [];
    for (const entry of Array.isArray(parsed.custom) ? (parsed.custom as Record<string, unknown>[]) : []) {
      const spec = parseThemeSpec(entry?.spec);
      if (spec && typeof entry.id === "string") custom.push({ id: entry.id, name: cleanThemeName(entry.name), spec });
    }
    return { active: typeof parsed.active === "string" ? parsed.active : DEFAULT_THEME_ID, custom };
  } catch {
    return empty;
  }
}

function readStore(): ThemeStore {
  try {
    return parseStore(localStorage.getItem(STORE_KEY));
  } catch {
    return parseStore(null);
  }
}

const [store, setStore] = createSignal(readStore());
const [draft, setDraft] = createSignal<ThemeSpec | null>(null);

export const customThemes = () => store().custom;
export const activeThemeId = () => store().active;

const allThemes = () => [...THEME_PRESETS, ...store().custom];
const savedSpec = () => allThemes().find((theme) => theme.id === store().active)?.spec ?? DEFAULT_THEME;

/** The theme on screen: what's being built, else what's saved. */
export const liveThemeSpec = () => draft() ?? savedSpec();

function paint(spec: ThemeSpec) {
  const css = themeCss(spec);
  let style = document.getElementById("app-theme");
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "app-theme";
    document.head.appendChild(style);
  }
  style.textContent = css;
}

function commit(next: ThemeStore) {
  setStore(next);
  const spec = savedSpec();
  paint(spec);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
    const css = themeCss(spec);
    if (css) localStorage.setItem(CSS_KEY, css);
    else localStorage.removeItem(CSS_KEY);
  } catch {
    // Storage can be off (private windows); the theme then lasts the session.
  }
}

export function selectTheme(id: string) {
  if (id === store().active) return;
  smoothly(() => commit({ ...store(), active: id }));
}

/** Saves over `id` when given, else adds a new theme, and puts it on. */
export function saveTheme(input: { id?: string | null; name: string; spec: ThemeSpec }): string {
  const id = input.id ?? crypto.randomUUID();
  const saved: SavedTheme = { id, name: cleanThemeName(input.name), spec: input.spec };
  const exists = store().custom.some((theme) => theme.id === id);
  commit({ active: id, custom: exists ? store().custom.map((theme) => (theme.id === id ? saved : theme)) : [...store().custom, saved] });
  return id;
}

export function deleteTheme(id: string) {
  const current = store();
  commit({ active: current.active === id ? DEFAULT_THEME_ID : current.active, custom: current.custom.filter((theme) => theme.id !== id) });
}

let framePending = false;

/** Shows `spec` everywhere without saving it, at most once a frame so dragging a slider stays smooth. */
export function previewTheme(spec: ThemeSpec) {
  setDraft(spec);
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    const latest = draft();
    if (latest) paint(latest);
  });
}

export function endThemePreview() {
  setDraft(null);
  paint(savedSpec());
}

if (typeof window !== "undefined") {
  paint(savedSpec());
  window.addEventListener("storage", (event) => {
    if (event.key !== STORE_KEY) return;
    setStore(parseStore(event.newValue));
    if (!draft()) paint(savedSpec());
  });
}
