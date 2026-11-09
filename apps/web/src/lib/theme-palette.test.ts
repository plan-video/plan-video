/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  contrastRatio,
  decodeThemeCode,
  encodeThemeCode,
  parseThemeSpec,
  resolvePalette,
  themeCss,
  type ThemeMode,
  type ThemeSpec,
} from "./theme-palette";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

function shipped(selector: string, token: string): string {
  const block = css.slice(css.indexOf(`${selector} {`));
  const match = block.slice(0, block.indexOf("\n}")).match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match) throw new Error(`${token} not in ${selector}`);
  return match[1]!;
}

const channels = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
const distance = (a: string, b: string) => Math.max(...channels(a).map((value, index) => Math.abs(value - channels(b)[index]!)));

describe("the default theme", () => {
  const dark = resolvePalette(DEFAULT_THEME, "dark");
  const light = resolvePalette(DEFAULT_THEME, "light");

  it.each([
    ["--plane-canvas", dark.canvas],
    ["--plane-surface-1", dark.surface],
    ["--plane-layer-2", dark.layer2],
    ["--plane-layer-2-active", dark.layer2Active],
    ["--plane-border-subtle", dark.borderSubtle],
    ["--plane-border-strong-1", dark.borderStrong1],
    ["--plane-text-primary", dark.textPrimary],
  ])("starts the sliders where the dark dashboard's %s already is", (token, value) => {
    expect(distance(value, shipped("html.dashboard-theme", token))).toBeLessThanOrEqual(3);
  });

  it.each([
    ["--plane-canvas", light.canvas],
    ["--plane-layer-1", light.layer1],
    ["--plane-border-subtle", light.borderSubtle],
    ["--plane-text-secondary", light.textSecondary],
  ])("starts the sliders where the light dashboard's %s already is", (token, value) => {
    expect(distance(value, shipped('html.dashboard-theme[data-dashboard-theme="light"]', token))).toBeLessThanOrEqual(5);
  });

  it("writes no CSS, so the shipped rules stay in charge", () => {
    expect(themeCss(DEFAULT_THEME)).toBe("");
    expect(themeCss({ ...DEFAULT_THEME, tint: 7 })).not.toBe("");
  });
});

describe("readability", () => {
  const extremes = [0, 50, 100];
  const accents = ["#ffffff", "#000000", "#ffee00", "#2f6ff0", "#00ff88", "#ff0040"];
  const modes: ThemeMode[] = ["dark", "light"];

  it("keeps text legible at every slider extreme, in both modes", () => {
    for (const mode of modes) {
      for (const brightness of extremes) {
        for (const layers of extremes) {
          for (const text of extremes) {
            for (const tint of extremes) {
              for (const hue of [0, 120, 240]) {
                const palette = resolvePalette({ ...DEFAULT_THEME, brightness, layers, text, tint, hue }, mode);
                for (const background of [palette.canvas, palette.surface, palette.layer2, palette.layer3Hover]) {
                  expect(contrastRatio(palette.textPrimary, background)).toBeGreaterThanOrEqual(4.5);
                  expect(contrastRatio(palette.textSecondary, background)).toBeGreaterThanOrEqual(3);
                  expect(contrastRatio(palette.editorForeground, background)).toBeGreaterThanOrEqual(4.5);
                }
              }
            }
          }
        }
      }
    }
  });

  it("keeps white text on the brand blue", () => {
    for (const mode of modes) expect(resolvePalette(DEFAULT_THEME, mode).accentForeground).toBe("#ffffff");
  });

  it("picks button text that reads on any accent", () => {
    for (const mode of modes) {
      for (const accent of accents) {
        const palette = resolvePalette({ ...DEFAULT_THEME, accent }, mode);
        expect(contrastRatio(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("saved themes and pasted codes", () => {
  const spec: ThemeSpec = { ...DEFAULT_THEME, accent: "#ff0040", hue: 200, font: "mono", playhead: "#00ff88", clips: { audio: "#123456" } };

  it("survives the trip through a theme code", () => {
    const decoded = decodeThemeCode(encodeThemeCode("Néon ✨", spec));
    expect(decoded).toEqual({ name: "Néon ✨", spec });
  });

  it("refuses anything that could write its own CSS", () => {
    const attack = "#000000;}body{display:none}";
    expect(parseThemeSpec({ ...spec, accent: attack })).toBeNull();
    expect(parseThemeSpec({ ...spec, playhead: attack })).toBeNull();
    expect(parseThemeSpec({ ...spec, font: "x;}body{display:none}" })).toBeNull();
    expect(parseThemeSpec({ ...spec, clips: { video: attack } })).toBeNull();
    expect(parseThemeSpec({ ...spec, hue: "1;}" })).toBeNull();
  });

  it("pulls out-of-range numbers back and ignores unknown clip kinds", () => {
    const parsed = parseThemeSpec({ ...spec, tint: 900, brightness: -4, clips: { video: "#ABCDEF", nope: "#000000" } });
    expect(parsed).toMatchObject({ tint: 100, brightness: 0, clips: { video: "#abcdef" } });
    expect(parsed?.clips).not.toHaveProperty("nope");
  });

  it.each(["", "hello", "PV1.", "PV1.%%%", `PV1.${btoa("[]")}`, `PV1.${btoa('{"spec":{"accent":"red"}}')}`])("rejects the code %j", (code) => {
    expect(decodeThemeCode(code)).toBeNull();
  });
});
