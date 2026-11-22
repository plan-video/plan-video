/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Match, Show, Switch } from "solid-js";

import type { EffectKind } from "@/engine/effects";

import "./effect-preview.css";

/** Seconds into each 2.4s loop (effect-preview.css) where the still shows the effect. */
const STILLS: Record<EffectKind, number> = {
  zoomIn: 0.2,
  slowZoom: 0,
  autoZoom: 0.1,
  zoomBlur: 0.75,
  shake: 0.7,
  handheld: 0.9,
  pulse: 0.1,
  flash: 1.15,
  fade: 1.2,
  glitch: 0.62,
  blur: 0.2,
  slowMotion: 0.4,
  rgbSplit: 1.2,
  glow: 1.2,
  lightLeak: 1.1,
  vignette: 1.2,
  blackWhite: 1.4,
  bars: 1.4,
};

const ZOOMS: EffectKind[] = ["zoomIn", "autoZoom", "slowZoom"];
const SPLITS: EffectKind[] = ["glitch", "rgbSplit"];

export function EffectPreview(props: { kind: EffectKind }) {
  return (
    <div class="fx" data-kind={props.kind} style={{ "--still": `-${STILLS[props.kind]}s` }}>
      {/* A split draws the shot as its three colours, screened back together. */}
      <Switch fallback={<div class="fx-shot" />}>
        <Match when={SPLITS.includes(props.kind)}>
          <div class="fx-shot fx-g" />
          <div class="fx-shot fx-r" />
          <div class="fx-shot fx-b" />
        </Match>
      </Switch>
      <Show when={ZOOMS.includes(props.kind)}>
        <div class="fx-frame" />
      </Show>
      <Show when={props.kind === "glitch"}>
        <div class="fx-shot fx-slice fx-slice-a" />
        <div class="fx-shot fx-slice fx-slice-b" />
      </Show>
      <Show when={props.kind === "glow"}>
        <div class="fx-shot fx-halo" />
      </Show>
      <Show when={props.kind === "flash" || props.kind === "fade" || props.kind === "lightLeak" || props.kind === "vignette"}>
        <div class="fx-over" />
      </Show>
      <Show when={props.kind === "bars"}>
        <div class="fx-bar fx-bar-top" />
        <div class="fx-bar fx-bar-bottom" />
      </Show>
    </div>
  );
}
