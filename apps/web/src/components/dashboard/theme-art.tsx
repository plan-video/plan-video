/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, createMemo } from "solid-js";

import { COLORS, LIGHT_COLORS } from "@/engine/timeline/constants";
import type { ClipKind, ThemePalette } from "@/lib/theme-palette";

const WIDTH = 640;
const HEIGHT = 400;
const CALENDAR_DAYS = Array.from({ length: 28 }, (_, index) => index + 1);
const CHIP_DAYS = [3, 5, 9, 10, 15, 18, 20, 24, 26];

type Art = { palette: ThemePalette; class?: string };

function Frame(props: Art & { children: unknown }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      class={props.class}
      style={{ background: props.palette.canvas, "font-family": props.palette.fontStack ?? "inherit" }}
    >
      {props.children as never}
    </svg>
  );
}

function Rail(props: { palette: ThemePalette; radius: number }) {
  return (
    <>
      <rect x="14" y="14" width="20" height="20" rx={props.radius} fill={props.palette.accent} />
      <For each={[0, 1, 2, 3, 4, 5]}>
        {(row) => <rect x="16" y={54 + row * 30} width="16" height="16" rx={props.radius * 0.7} fill={row === 0 ? props.palette.textPrimary : props.palette.textTertiary} opacity={row === 0 ? 1 : 0.55} />}
      </For>
    </>
  );
}

function Bars(props: { x: number; y: number; widths: number[]; gap: number; color: string; height?: number }) {
  return (
    <For each={props.widths}>
      {(width, index) => <rect x={props.x} y={props.y + index() * props.gap} width={width} height={props.height ?? 6} rx="3" fill={props.color} />}
    </For>
  );
}

export function ThemeDashboardArt(props: Art) {
  const radius = () => 6 * props.palette.cornerScale;
  const panelRadius = () => 10 * props.palette.cornerScale;
  const cell = { width: 57, height: 66, left: 212, top: 74 };
  return (
    <Frame {...props}>
      <Rail palette={props.palette} radius={radius()} />
      <rect x="48" y="8" width="150" height="384" rx={panelRadius()} fill={props.palette.surface} stroke={props.palette.borderSubtle} />
      <rect x="60" y="20" width="126" height="26" rx={radius()} fill={props.palette.accent} />
      <rect x="96" y="30" width="54" height="6" rx="3" fill={props.palette.accentForeground} />
      <rect x="60" y="62" width="126" height="22" rx={radius()} fill={props.palette.layer2Active} />
      <Bars x={70} y={70} widths={[70]} gap={0} color={props.palette.textPrimary} />
      <Bars x={70} y={100} widths={[86, 60, 74, 52, 80]} gap={24} color={props.palette.textTertiary} />
      <rect x="204" y="8" width="428" height="384" rx={panelRadius()} fill={props.palette.surface} stroke={props.palette.borderSubtle} />
      <Bars x={220} y={28} widths={[92]} gap={0} color={props.palette.textPrimary} height={9} />
      <rect x="560" y="20" width="60" height="24" rx={radius()} fill={props.palette.layer2} stroke={props.palette.borderSubtle1} />
      <For each={CALENDAR_DAYS}>
        {(day) => {
          const column = () => (day - 1) % 7;
          const row = () => Math.floor((day - 1) / 7);
          const x = () => cell.left + column() * cell.width;
          const y = () => cell.top + row() * cell.height;
          const hasChip = () => CHIP_DAYS.includes(day);
          const picked = () => day === 10;
          return (
            <>
              <rect x={x()} y={y()} width={cell.width} height={cell.height} fill="none" stroke={props.palette.borderSubtle} />
              <text x={x() + 7} y={y() + 15} font-size="10" fill={day === 10 ? props.palette.accentText : props.palette.textSecondary}>
                {day}
              </text>
              {hasChip() && (
                <>
                  <rect x={x() + 5} y={y() + 24} width={cell.width - 10} height="18" rx={radius() * 0.6} fill={picked() ? props.palette.accentSubtleActive : props.palette.layer2Active} />
                  <rect x={x() + 5} y={y() + 24} width="2.5" height="18" fill={props.palette.accent} />
                  <rect x={x() + 13} y={y() + 30} width={cell.width - 28} height="5" rx="2.5" fill={picked() ? props.palette.accentSubtleForeground : props.palette.textSecondary} />
                </>
              )}
            </>
          );
        }}
      </For>
    </Frame>
  );
}

function clipColors(palette: ThemePalette, kind: ClipKind) {
  const base = (palette.mode === "light" ? LIGHT_COLORS : COLORS).clip[kind];
  return palette.clips[kind] ?? base;
}

export function ThemeEditorArt(props: Art) {
  const radius = () => 6 * props.palette.cornerScale;
  const clips = createMemo(() => [
    { kind: "text" as const, x: 208, y: 276, width: 112 },
    { kind: "caption" as const, x: 330, y: 276, width: 86 },
    { kind: "image" as const, x: 120, y: 302, width: 82 },
    { kind: "video" as const, x: 208, y: 302, width: 150 },
    { kind: "video" as const, x: 362, y: 302, width: 136 },
    { kind: "shape" as const, x: 504, y: 302, width: 54 },
    { kind: "audio" as const, x: 120, y: 328, width: 438 },
  ]);
  return (
    <Frame {...props}>
      <Rail palette={props.palette} radius={radius()} />
      <rect x="48" y="0" width="592" height="400" fill={props.palette.surface} />
      <rect x="48" y="0" width="108" height="240" fill={props.palette.surface} stroke={props.palette.editorBorder} />
      <Bars x={60} y={18} widths={[52]} gap={0} color={props.palette.editorForeground} />
      <For each={[0, 1, 2, 3, 4, 5]}>
        {(index) => (
          <rect
            x={60 + (index % 2) * 44}
            y={40 + Math.floor(index / 2) * 44}
            width="38"
            height="36"
            rx={radius()}
            fill={props.palette.layer2Active}
          />
        )}
      </For>
      <rect x="156" y="0" width="372" height="240" fill={props.palette.canvas} />
      <rect x="208" y="34" width="268" height="150" rx={radius() * 0.5} fill={props.palette.layer2} stroke={props.palette.editorBorderStrong} />
      <circle cx="342" cy="109" r="17" fill={props.palette.accent} />
      <path d="M337 100 L351 109 L337 118 Z" fill={props.palette.accentForeground} />
      <rect x="296" y="204" width="92" height="22" rx={radius()} fill={props.palette.popover} stroke={props.palette.editorBorderInput} />
      <rect x="528" y="0" width="112" height="240" fill={props.palette.surface} stroke={props.palette.editorBorder} />
      <rect x="538" y="12" width="92" height="22" rx={radius()} fill={props.palette.accent} />
      <rect x="564" y="20" width="40" height="6" rx="3" fill={props.palette.accentForeground} />
      <Bars x={538} y={52} widths={[46, 70, 58, 66, 40, 72]} gap={22} color={props.palette.editorMuted} />
      <rect x="48" y="240" width="592" height="160" fill={props.palette.surface} stroke={props.palette.editorBorder} />
      <text x="60" y="260" font-size="11" fill={props.palette.editorForeground}>
        00:12:08
      </text>
      <For each={Array.from({ length: 14 }, (_, index) => index)}>
        {(tick) => <rect x={120 + tick * 36} y="250" width="1" height="10" fill={props.palette.editorMuted} opacity="0.4" />}
      </For>
      <For each={clips()}>
        {(clip) => (
          <>
            <rect x={clip.x} y={clip.y} width={clip.width} height="22" rx={radius() * 0.7} fill={clipColors(props.palette, clip.kind).background} stroke={clipColors(props.palette, clip.kind).border} />
            <rect x={clip.x + 8} y={clip.y + 8} width={Math.min(52, clip.width - 16)} height="5" rx="2.5" fill={clipColors(props.palette, clip.kind).foreground} />
          </>
        )}
      </For>
      <rect x="298" y="246" width="1.5" height="154" fill={props.palette.playhead} />
      <path d="M293 244 h11 v7 l-5.5 6 l-5.5 -6 Z" fill={props.palette.playhead} />
    </Frame>
  );
}
