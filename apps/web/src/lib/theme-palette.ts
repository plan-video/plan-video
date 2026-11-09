/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type ThemeMode = "dark" | "light";

export const CLIP_KINDS = ["video", "audio", "text", "image", "caption", "shape"] as const;
export type ClipKind = (typeof CLIP_KINDS)[number];

export const THEME_FONTS = ["default", "inter", "geist", "system", "mono"] as const;
export type ThemeFont = (typeof THEME_FONTS)[number];

export type ThemeSpec = {
  accent: string;
  hue: number;
  tint: number;
  brightness: number;
  layers: number;
  borders: number;
  text: number;
  corners: number;
  font: ThemeFont;
  playhead: string | null;
  clips: Partial<Record<ClipKind, string>>;
};

export const DEFAULT_THEME: ThemeSpec = {
  accent: "#2f6ff0",
  hue: 60,
  tint: 6,
  brightness: 20,
  layers: 50,
  borders: 50,
  text: 50,
  corners: 40,
  font: "default",
  playhead: null,
  clips: {},
};

type Oklch = { l: number; c: number; h: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number];
}

const toLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const toGamma = (channel: number) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexChannels(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const lab = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, lab),
    h: (Math.atan2(lab, a) * 180) / Math.PI + (lab < 0 ? 360 : 0),
  };
}

function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const p = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const q = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * p - 3.3077115913 * q + 0.2309699292 * s,
    -1.2684380046 * p + 2.6097574011 * q - 0.3413193965 * s,
    -0.0041960863 * p - 0.7034186147 * q + 1.707614701 * s,
  ];
}

const inGamut = (channels: number[]) => channels.every((channel) => channel >= -0.0001 && channel <= 1.0001);

export function oklchToHex(lightness: number, chroma: number, h: number): string {
  const l = clamp(lightness, 0, 1);
  let c = Math.max(0, chroma);
  if (!inGamut(oklchToLinear(l, c, h))) {
    let low = 0;
    let high = c;
    for (let step = 0; step < 16; step++) {
      c = (low + high) / 2;
      if (inGamut(oklchToLinear(l, c, h))) low = c;
      else high = c;
    }
    c = low;
  }
  const hex = oklchToLinear(l, c, h)
    .map((channel) => Math.round(clamp(toGamma(clamp(channel, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

function luminance(hex: string): number {
  const [r, g, b] = hexChannels(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Dark then light: the neutral ramp every theme bends, in the steps the dashboard and editor already use. */
const GREYS = {
  canvas: ["#060606", "#f3f3f3"],
  surface: ["#0b0b0b", "#ffffff"],
  surface2: ["#111111", "#fafafa"],
  layer1: ["#111111", "#f6f6f6"],
  layer1Hover: ["#161616", "#f0f0f0"],
  layer2: ["#161616", "#ffffff"],
  layer2Hover: ["#1b1b1b", "#f6f6f6"],
  layer2Active: ["#232323", "#efefef"],
  layer3: ["#1b1b1b", "#efefef"],
  layer3Hover: ["#232323", "#e7e7e7"],
  popover: ["#111111", "#ffffff"],
  secondary: ["#161616", "#f0f0f0"],
  secondaryHover: ["#1b1b1b", "#e8e8e8"],
  secondaryPressing: ["#232323", "#dedede"],
  timelineMuted: ["#161616", "#ededed"],
  timelineAccent: ["#161616", "#f3f3f3"],
  artCard: ["#151515", "#ffffff"],
} as const;

const LINES = {
  borderSubtle: ["#1c1c1c", "#ebebeb"],
  borderSubtle1: ["#252525", "#e3e3e3"],
  borderStrong: ["#2e2e2e", "#d4d4d4"],
  borderStrong1: ["#3a3a3a", "#c2c2c2"],
  editorBorder: ["#1a1a1a", "#ededed"],
  editorBorderStrong: ["#1f1f1f", "#e6e6e6"],
  editorBorderInput: ["#262626", "#e0e0e0"],
  timelineInput: ["#2e2e2e", "#d4d4d4"],
  artCardEdge: ["#262626", "#e3e3e3"],
  artLine: ["#2e2e2e", "#dedede"],
  artLineSoft: ["#222222", "#ececec"],
} as const;

const TEXTS = {
  textPrimary: ["#ededed", "#171717"],
  textSecondary: ["#a1a1a1", "#5c5c5c"],
  textTertiary: ["#7d7d7d", "#737373"],
  textPlaceholder: ["#666666", "#a3a3a3"],
  textDisabled: ["#4a4a4a", "#c7c7c7"],
  editorForeground: ["#d4d4d4", "#171717"],
  editorMuted: ["#a1a1a1", "#5c5c5c"],
  editorDisabled: ["#4a4a4a", "#a3a3a3"],
} as const;

type GreyStep = keyof typeof GREYS;
type LineStep = keyof typeof LINES;
type TextStep = keyof typeof TEXTS;

export type ClipPalette = { background: string; border: string; primary: string; foreground: string };

export type ThemePalette = Record<GreyStep | LineStep | TextStep, string> & {
  mode: ThemeMode;
  accent: string;
  accentHover: string;
  accentActive: string;
  accentText: string;
  accentForeground: string;
  accentSubtle: string;
  accentSubtleActive: string;
  accentSubtleForeground: string;
  playhead: string;
  cornerScale: number;
  fontStack: string | null;
  clips: Partial<Record<ClipKind, ClipPalette>>;
};

const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

export const FONT_STACKS: Record<Exclude<ThemeFont, "default">, string> = {
  inter: `'Inter', ui-sans-serif, system-ui, sans-serif, ${EMOJI}`,
  geist: `'Geist', 'Inter', ui-sans-serif, system-ui, sans-serif, ${EMOJI}`,
  system: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif, ${EMOJI}`,
  mono: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace, ${EMOJI}`,
};

const MAX_DARK_LAYER = 0.52;

function surfaceLightness(brightness: number, mode: ThemeMode): number {
  if (mode === "light") return brightness < 20 ? 1 : lerp(1, 0.86, (brightness - 20) / 80);
  const anchor = hexToOklch(GREYS.surface[0]).l;
  return brightness < 20 ? lerp(0, anchor, brightness / 20) : lerp(anchor, 0.34, (brightness - 20) / 80);
}

/** Moves text away from the background until it reads, so no slider position can make the app illegible. */
function readable(l: number, c: number, h: number, background: string, target: number, mode: ThemeMode): string {
  let lightness = l;
  let hex = oklchToHex(lightness, c, h);
  const step = mode === "dark" ? 0.01 : -0.01;
  while (contrastRatio(hex, background) < target && lightness > 0 && lightness < 1) {
    lightness += step;
    hex = oklchToHex(lightness, c, h);
  }
  return hex;
}

function clipPalette(color: string, mode: ThemeMode): ClipPalette {
  const { c, h } = hexToOklch(color);
  const chroma = clamp(c, 0.01, 0.2);
  return mode === "dark"
    ? {
        background: oklchToHex(0.3, chroma * 0.35, h),
        border: oklchToHex(0.42, chroma * 0.6, h),
        primary: oklchToHex(0.76, chroma, h),
        foreground: oklchToHex(0.92, chroma * 0.25, h),
      }
    : {
        background: oklchToHex(0.95, chroma * 0.15, h),
        border: oklchToHex(0.87, chroma * 0.3, h),
        primary: oklchToHex(0.66, chroma, h),
        foreground: oklchToHex(0.42, chroma, h),
      };
}

export function resolvePalette(spec: ThemeSpec, mode: ThemeMode): ThemePalette {
  const index = mode === "dark" ? 0 : 1;
  const anchor = hexToOklch(GREYS.surface[index]).l;
  const surfaceL = surfaceLightness(spec.brightness, mode);
  const chroma = (spec.tint / 100) * (mode === "dark" ? 0.09 : 0.05);
  const layerScale = spec.layers <= 50 ? lerp(0.4, 1, spec.layers / 50) : lerp(1, 2.2, (spec.layers - 50) / 50);
  const lineScale = spec.borders <= 50 ? lerp(0.3, 1, spec.borders / 50) : lerp(1, 1.8, (spec.borders - 50) / 50);

  const palette = { mode } as ThemePalette;
  for (const step of Object.keys(GREYS) as GreyStep[]) {
    const lightness = surfaceL + (hexToOklch(GREYS[step][index]).l - anchor) * layerScale;
    // Past this, even white text can't reach 4.5:1 on the lightest layer.
    palette[step] = oklchToHex(mode === "dark" ? Math.min(lightness, MAX_DARK_LAYER) : lightness, chroma, spec.hue);
  }
  for (const step of Object.keys(LINES) as LineStep[]) {
    palette[step] = oklchToHex(surfaceL + (hexToOklch(LINES[step][index]).l - anchor) * lineScale, chroma, spec.hue);
  }

  const backgrounds = (Object.keys(GREYS) as GreyStep[]).map((step) => palette[step]);
  const hardest = backgrounds.reduce((worst, next) => ((luminance(next) > luminance(worst)) === (mode === "dark") ? next : worst));
  const push = ((spec.text - 50) / 50) * 0.1 * (mode === "dark" ? 1 : -1);
  const targets: Record<TextStep, number> = {
    textPrimary: 7,
    textSecondary: 4.5,
    textTertiary: 3,
    textPlaceholder: 1,
    textDisabled: 1,
    editorForeground: 7,
    editorMuted: 4.5,
    editorDisabled: 1,
  };
  for (const step of Object.keys(TEXTS) as TextStep[]) {
    palette[step] = readable(hexToOklch(TEXTS[step][index]).l + push, chroma * 0.4, spec.hue, hardest, targets[step], mode);
  }

  const accent = hexToOklch(spec.accent);
  const accentL = mode === "dark" ? Math.max(accent.l, 0.5) : Math.min(accent.l - 0.03, 0.62);
  palette.accent = oklchToHex(accentL, accent.c, accent.h);
  palette.accentHover = oklchToHex(accentL + (mode === "dark" ? 0.04 : -0.06), accent.c, accent.h);
  palette.accentActive = oklchToHex(accentL + (mode === "dark" ? -0.03 : -0.11), accent.c, accent.h);
  palette.accentText = oklchToHex(mode === "dark" ? Math.max(accentL, 0.75) : Math.min(accentL, 0.5), accent.c, accent.h);
  palette.accentForeground = contrastRatio("#ffffff", palette.accent) >= 4.5 ? "#ffffff" : "#000000";
  const subtleC = Math.min(accent.c, 0.08);
  palette.accentSubtle = oklchToHex(mode === "dark" ? Math.max(0.22, surfaceL + 0.08) : surfaceL - 0.035, subtleC * 0.6, accent.h);
  palette.accentSubtleActive = oklchToHex(mode === "dark" ? Math.max(0.29, surfaceL + 0.14) : surfaceL - 0.075, subtleC, accent.h);
  palette.accentSubtleForeground = oklchToHex(mode === "dark" ? 0.9 : 0.28, subtleC, accent.h);

  palette.playhead = spec.playhead ?? palette.accent;
  palette.cornerScale = spec.corners / 40;
  palette.fontStack = spec.font === "default" ? null : FONT_STACKS[spec.font];
  palette.clips = {};
  for (const kind of CLIP_KINDS) {
    const color = spec.clips[kind];
    if (color) palette.clips[kind] = clipPalette(color, mode);
  }
  return palette;
}

const sameSpec = (a: ThemeSpec, b: ThemeSpec) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function canonical(spec: ThemeSpec) {
  return { ...spec, clips: CLIP_KINDS.map((kind) => spec.clips[kind] ?? null) };
}

export const isDefaultTheme = (spec: ThemeSpec) => sameSpec(spec, DEFAULT_THEME);

function clipTokens(palette: ThemePalette): Record<string, string> {
  const { video, audio, text, caption } = palette.clips;
  return {
    ...(video && { "--art-video": video.background, "--art-video-ink": video.primary }),
    ...(audio && {
      "--art-audio": audio.background,
      "--art-audio-ink": audio.primary,
      "--audio-background": audio.background,
      "--audio-primary": audio.primary,
    }),
    ...(text && { "--art-text": text.background, "--art-text-ink": text.foreground }),
    ...(caption && { "--caption-background": caption.background }),
  };
}

function accentTokens(palette: ThemePalette): Record<string, string> {
  return {
    "--primary": palette.accent,
    "--primary-foreground": palette.accentForeground,
    "--primary-hover": palette.accentHover,
    "--primary-pressing": palette.accentActive,
    "--tertiary": palette.accentSubtleActive,
    "--tertiary-foreground": palette.accentSubtleForeground,
    "--tertiary-hover": palette.accentSubtle,
    "--tertiary-pressing": palette.accentSubtle,
    "--ring": palette.accent,
    "--selection": palette.accentSubtleActive,
    "--selection-foreground": palette.accentSubtleForeground,
  };
}

function dashboardTokens(palette: ThemePalette): Record<string, string> {
  return {
    "--plane-canvas": palette.canvas,
    "--plane-surface-1": palette.surface,
    "--plane-surface-2": palette.surface2,
    "--plane-layer-1": palette.layer1,
    "--plane-layer-1-hover": palette.layer1Hover,
    "--plane-layer-2": palette.layer2,
    "--plane-layer-2-hover": palette.layer2Hover,
    "--plane-layer-2-active": palette.layer2Active,
    "--plane-layer-3": palette.layer3,
    "--plane-layer-3-hover": palette.layer3Hover,
    "--plane-border-subtle": palette.borderSubtle,
    "--plane-border-subtle-1": palette.borderSubtle1,
    "--plane-border-strong": palette.borderStrong,
    "--plane-border-strong-1": palette.borderStrong1,
    "--plane-text-primary": palette.textPrimary,
    "--plane-text-secondary": palette.textSecondary,
    "--plane-text-tertiary": palette.textTertiary,
    "--plane-text-placeholder": palette.textPlaceholder,
    "--plane-text-disabled": palette.textDisabled,
    "--plane-accent-primary": palette.accent,
    "--plane-accent-primary-hover": palette.accentHover,
    "--plane-accent-primary-active": palette.accentActive,
    "--plane-accent-secondary": palette.accentText,
    "--plane-accent-subtle": palette.accentSubtle,
    "--plane-accent-subtle-active": palette.accentSubtleActive,
    "--art-card": palette.artCard,
    "--art-card-edge": palette.artCardEdge,
    "--art-line": palette.artLine,
    "--art-line-soft": palette.artLineSoft,
    "--secondary": palette.mode === "light" ? palette.secondary : palette.layer2,
    "--secondary-hover": palette.mode === "light" ? palette.secondaryHover : palette.layer2Hover,
    "--secondary-pressing": palette.mode === "light" ? palette.secondaryPressing : palette.layer2Active,
    ...accentTokens(palette),
    ...clipTokens(palette),
  };
}

function editorTokens(palette: ThemePalette): Record<string, string> {
  return {
    "--canvas": palette.canvas,
    "--background": palette.surface,
    "--foreground": palette.editorForeground,
    "--card": palette.surface,
    "--card-foreground": palette.editorForeground,
    "--popover": palette.popover,
    "--popover-foreground": palette.editorForeground,
    "--muted-foreground": palette.editorMuted,
    "--accent-foreground": palette.editorMuted,
    "--disabled-foreground": palette.editorDisabled,
    "--border": palette.editorBorder,
    "--border-strong": palette.editorBorderStrong,
    "--border-input": palette.editorBorderInput,
    "--border-darker": palette.surface,
    ...accentTokens(palette),
    ...clipTokens(palette),
  };
}

const rule = (selector: string, tokens: Record<string, string>) =>
  `${selector}{${Object.entries(tokens).map(([name, value]) => `${name}:${value}`).join(";")}}`;

/** `:root` outranks the shipped per-mode rules whatever order the stylesheets load in. The default theme is those rules, so it writes nothing. */
export function themeCss(spec: ThemeSpec): string {
  if (isDefaultTheme(spec)) return "";
  const dark = resolvePalette(spec, "dark");
  const light = resolvePalette(spec, "light");
  const rules = [
    rule('html.dashboard-theme[data-dashboard-theme="dark"]:root', dashboardTokens(dark)),
    rule('html.dashboard-theme[data-dashboard-theme="light"]:root', dashboardTokens(light)),
    rule('html.editor-theme[data-kb-theme="dark"]:root', editorTokens(dark)),
    rule('html.editor-theme[data-kb-theme="light"]:root', editorTokens(light)),
    rule("html.dashboard-theme:root,html.editor-theme:root", { "--corner-scale": String(dark.cornerScale), "--guest-frame": dark.borderSubtle }),
    rule('html[data-boot="dark"] #boot-splash', { background: dark.surface }),
    rule('html[data-boot="light"] #boot-splash', { background: light.surface }),
  ];
  if (dark.fontStack) rules.push(rule("html.dashboard-theme:root :is(body,.font-sans),html.editor-theme:root :is(body,.font-sans)", { "font-family": dark.fontStack }));
  return rules.join("");
}

const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 40;

function sliderValue(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(clamp(value, 0, max)) : null;
}

/** Saved themes and pasted codes end up inside a stylesheet, so nothing passes through unchecked. */
export function parseThemeSpec(input: unknown): ThemeSpec | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const accent = raw.accent ?? DEFAULT_THEME.accent;
  if (typeof accent !== "string" || !HEX.test(accent)) return null;
  const playhead = raw.playhead ?? null;
  if (playhead !== null && (typeof playhead !== "string" || !HEX.test(playhead))) return null;
  const font = raw.font ?? DEFAULT_THEME.font;
  if (!THEME_FONTS.includes(font as ThemeFont)) return null;

  const hue = sliderValue(raw.hue, DEFAULT_THEME.hue, 360);
  const tint = sliderValue(raw.tint, DEFAULT_THEME.tint, 100);
  const brightness = sliderValue(raw.brightness, DEFAULT_THEME.brightness, 100);
  const layers = sliderValue(raw.layers, DEFAULT_THEME.layers, 100);
  const borders = sliderValue(raw.borders, DEFAULT_THEME.borders, 100);
  const text = sliderValue(raw.text, DEFAULT_THEME.text, 100);
  const corners = sliderValue(raw.corners, DEFAULT_THEME.corners, 100);
  if (hue === null || tint === null || brightness === null || layers === null || borders === null || text === null || corners === null) return null;

  const clips: ThemeSpec["clips"] = {};
  const rawClips = raw.clips ?? {};
  if (typeof rawClips !== "object" || rawClips === null) return null;
  for (const kind of CLIP_KINDS) {
    const color = (rawClips as Record<string, unknown>)[kind];
    if (color === undefined || color === null) continue;
    if (typeof color !== "string" || !HEX.test(color)) return null;
    clips[kind] = color.toLowerCase();
  }

  return {
    accent: accent.toLowerCase(),
    hue,
    tint,
    brightness,
    layers,
    borders,
    text,
    corners,
    font: font as ThemeFont,
    playhead: playhead === null ? null : (playhead as string).toLowerCase(),
    clips,
  };
}

export const cleanThemeName = (name: unknown) => (typeof name === "string" ? name.trim().slice(0, NAME_MAX) : "");

const CODE_PREFIX = "PV1.";

export function encodeThemeCode(name: string, spec: ThemeSpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ name: cleanThemeName(name), spec }));
  return CODE_PREFIX + btoa(String.fromCharCode(...bytes));
}

export function decodeThemeCode(code: string): { name: string; spec: ThemeSpec } | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) return null;
  try {
    const bytes = Uint8Array.from(atob(trimmed.slice(CODE_PREFIX.length)), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { name?: unknown; spec?: unknown };
    const spec = parseThemeSpec(parsed.spec);
    return spec ? { name: cleanThemeName(parsed.name), spec } : null;
  } catch {
    return null;
  }
}
