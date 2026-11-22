/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, createSignal } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { SidebarTabs } from "@/agent-chat";
import { EffectPreview } from "@/components/editor/effect-preview";
import { PresetGrid, PresetSection, PresetTile } from "@/components/ui/preset-tile";
import { addEffect, effectOf, type EffectFailure, type EffectKind } from "@/engine/effects";
import { useDerived, useSelection } from "@/engine/hooks";
import { msg, t } from "@/lib/i18n";
import { runAutoZoom } from "./auto-zoom-panel";

type EffectInfo = { kind: EffectKind; label: string; summary: string };

/** Each group fills whole rows of two. */
export const EFFECT_GROUPS: { label: string; effects: EffectInfo[] }[] = [
  {
    label: msg("Camera"),
    effects: [
      { kind: "zoomIn", label: msg("Zoom in"), summary: msg("Push in on a moment, then back out.") },
      { kind: "autoZoom", label: msg("Auto zoom"), summary: msg("Punch in wherever your voice lands, across the whole clip.") },
      { kind: "slowZoom", label: msg("Slow zoom"), summary: msg("A slow push in or out that keeps a still shot moving.") },
      { kind: "zoomBlur", label: msg("Zoom blur"), summary: msg("A fast zoom with motion blur, for a hit or a reveal.") },
      { kind: "shake", label: msg("Shake"), summary: msg("Shake the shot on a hit, a drop or a punchline.") },
      { kind: "handheld", label: msg("Handheld"), summary: msg("A gentle drift, as if the camera were held by hand.") },
      { kind: "pulse", label: msg("Pulse"), summary: msg("Bump the shot in time with the beat.") },
      { kind: "slowMotion", label: msg("Slow motion"), summary: msg("Slow a moment down, then back up to speed.") },
    ],
  },
  {
    label: msg("Moments"),
    effects: [
      { kind: "flash", label: msg("Flash"), summary: msg("A flash of white or black, on a beat or a cut.") },
      { kind: "fade", label: msg("Fade"), summary: msg("Fade in from black or white, or fade out to it.") },
      { kind: "glitch", label: msg("Glitch"), summary: msg("Colour split and jumps, like a broken signal.") },
      { kind: "blur", label: msg("Blur"), summary: msg("Bring the shot into focus, or let it drift out.") },
    ],
  },
  {
    label: msg("Looks"),
    effects: [
      { kind: "rgbSplit", label: msg("RGB split"), summary: msg("Red and blue edges, like a lens that splits colour.") },
      { kind: "glow", label: msg("Glow"), summary: msg("Soft light around the bright parts of the shot.") },
      { kind: "lightLeak", label: msg("Light leak"), summary: msg("Warm light that drifts across, like old film.") },
      { kind: "vignette", label: msg("Vignette"), summary: msg("Darken the edges to draw the eye to the middle.") },
      { kind: "blackWhite", label: msg("Black and white"), summary: msg("Take the colour out of the shot.") },
      { kind: "bars", label: msg("Cinematic bars"), summary: msg("Black bars that slide in for a film look.") },
    ],
  },
];

export const EFFECTS: EffectInfo[] = EFFECT_GROUPS.flatMap((group) => group.effects);

export function effectFailed(reason: EffectFailure) {
  if (reason === "no-scene") toast(t("Open a scene first"));
  else if (reason === "too-short") toast(t("Not enough clip left"), { description: t("Move the playhead earlier, or pick a shorter length.") });
  else if (reason === "no-video") toast(t("Pick a video clip"), { description: t("Slow motion changes a clip's own speed, so it needs a clip, not a group.") });
  else toast(t("No clip here"), { description: t("Select a clip, or move the playhead over one.") });
}

export function EffectsPanel() {
  const world = useWorld();
  const selection = useSelection();
  const [busy, setBusy] = createSignal(false);

  const current = useDerived(() => {
    const nodes = selection.nodes();
    return nodes.length === 1 ? (effectOf(world, nodes[0]!)?.kind ?? null) : null;
  });

  const handlePick = async (kind: EffectKind) => {
    if (busy()) return;
    if (kind === "autoZoom") {
      setBusy(true);
      await runAutoZoom(world).finally(() => setBusy(false));
      return;
    }
    const result = addEffect(world, kind);
    if (!result.ok) effectFailed(result.reason);
  };

  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <div class="flex min-w-0 flex-1 items-center">
          <SidebarTabs />
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-5 p-4">
          <For each={EFFECT_GROUPS}>
            {(group) => (
              <PresetSection title={t(group.label)}>
                <PresetGrid>
                  <For each={group.effects}>
                    {(effect) => (
                      <PresetTile
                        label={t(effect.label)}
                        title={t(effect.summary)}
                        selected={current() === effect.kind}
                        onClick={() => void handlePick(effect.kind)}
                      >
                        {() => <EffectPreview kind={effect.kind} />}
                      </PresetTile>
                    )}
                  </For>
                </PresetGrid>
              </PresetSection>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
