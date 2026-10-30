/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, createSignal } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { SidebarTabs } from "@/agent-chat";
import { EffectPreview } from "@/components/editor/effect-preview";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { addEffect, effectOf, type EffectFailure, type EffectKind } from "@/engine/effects";
import { useDerived, useSelection } from "@/engine/hooks";
import { msg, t } from "@/lib/i18n";
import { runAutoZoom } from "./auto-zoom-panel";

type EffectInfo = { kind: EffectKind; label: string; summary: string };

/** In rows of two: the zooms, then the moments, then the looks. */
export const EFFECTS: EffectInfo[] = [
  { kind: "zoomIn", label: msg("Zoom in"), summary: msg("Push in on a moment, then back out.") },
  { kind: "autoZoom", label: msg("Auto zoom"), summary: msg("Punch in wherever your voice lands, across the whole clip.") },
  { kind: "slowZoom", label: msg("Slow zoom"), summary: msg("A slow push in or out that keeps a still shot moving.") },
  { kind: "shake", label: msg("Shake"), summary: msg("Shake the shot on a hit, a drop or a punchline.") },
  { kind: "slowMotion", label: msg("Slow motion"), summary: msg("Slow a moment down, then back up to speed.") },
  { kind: "flash", label: msg("Flash"), summary: msg("A flash of white or black, on a beat or a cut.") },
  { kind: "blur", label: msg("Blur"), summary: msg("Bring the shot into focus, or let it drift out.") },
  { kind: "bars", label: msg("Cinematic bars"), summary: msg("Black bars that slide in for a film look.") },
];

/** Says why an effect could not go on. */
export function effectFailed(reason: EffectFailure) {
  if (reason === "no-scene") toast(t("Open a scene first"));
  else if (reason === "too-short") toast(t("Not enough clip left"), { description: t("Move the playhead earlier, or pick a shorter length.") });
  else if (reason === "no-video") toast(t("Pick a video clip"), { description: t("Slow motion changes a clip's own speed, so it needs a clip, not a group.") });
  else toast(t("No clip here"), { description: t("Select a clip, or move the playhead over one.") });
}

/**
 * The left sidebar's Effects tab: each effect as a tile that plays on hover.
 * Clicking one puts it on at the playhead, on the selected clip or the one
 * under the playhead, and selects it, so its settings open in the inspector,
 * the way a transition's do. The tile of the selected effect shows lit.
 */
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
        <div class="p-3">
          <PresetGrid>
            <For each={EFFECTS}>
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
        </div>
      </div>
    </div>
  );
}
