/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show } from "solid-js";

import type { EffectKind } from "@/engine/effects";

import "./effect-preview.css";

/**
 * Where each preview rests, seconds into its 2.4s loop: a frame where the
 * effect shows, so the still alone says what it does. The zooms rest wide,
 * with the crop they go to marked.
 */
const STILLS: Record<EffectKind, number> = {
  zoomIn: 0.2,
  slowZoom: 0,
  autoZoom: 0.1,
  shake: 0.7,
  flash: 1.15,
  blur: 0.2,
  slowMotion: 0.4,
  bars: 1.4,
};

const ZOOMS: EffectKind[] = ["zoomIn", "autoZoom", "slowZoom"];

/** An effect played on real footage, for a PresetTile. */
export function EffectPreview(props: { kind: EffectKind }) {
  return (
    <div class="fx" data-kind={props.kind} style={{ "--still": `-${STILLS[props.kind]}s` }}>
      <div class="fx-shot" />
      <Show when={ZOOMS.includes(props.kind)}>
        <div class="fx-frame" />
      </Show>
      <Show when={props.kind === "flash"}>
        <div class="fx-over" />
      </Show>
      <Show when={props.kind === "bars"}>
        <div class="fx-bar fx-bar-top" />
        <div class="fx-bar fx-bar-bottom" />
      </Show>
    </div>
  );
}
