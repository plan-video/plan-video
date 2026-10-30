/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { getActiveEntity, isScene } from "@plan.video/runtime";

import { SidebarTabs } from "@/agent-chat";
import { TransitionPreview } from "@/components/editor/transition-preview";
import { TRANSITION_OPTIONS, transitionOption } from "@/components/sidebar-right/inspector/transition-types";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { useDerived, useSelection } from "@/engine/hooks";
import {
  TRANSITION_DRAG_TYPE,
  applyTransition,
  applyTransitionEverywhere,
  clearTransition,
  clipSpots,
  pickedTransition,
  requestTransitionEnd,
  sceneJoins,
  setPickedTransition,
  spotTransition,
  takesTransition,
} from "@/engine/transitions";
import { t } from "@/lib/i18n";
import { AddButton } from "./extension-ui";

import type { TransitionOption } from "@/components/sidebar-right/inspector/transition-types";
import type { Spot } from "@/engine/transitions";

/**
 * The left sidebar's Transitions tab: each style as a tile that plays on
 * hover. Clicking one picks it and puts it on both ends of the selected
 * clips, a cut or the clip's own start and end; dragging one onto either end
 * of a clip in the timeline puts it there. The button under them takes the
 * selected clips' transitions off again, or with none to take off and cuts
 * in the scene, puts the picked one on every cut. Its settings are the
 * inspector's: putting one on a single clip opens that clip's Out there.
 */
export function TransitionsPanel() {
  const world = useWorld();
  const selection = useSelection();

  /** Both ends of the selected clips. */
  const selectedSpots = useDerived(
    () => clipSpots(world, selection.nodes()),
    (a, b) =>
      a.length === b.length &&
      a.every((spot, index) => spot.clip === b[index]!.clip && spot.prop === b[index]!.prop && spot.partner === b[index]!.partner),
  );

  /** What the selected clips already play, so its tile shows as the one in use. */
  const current = useDerived(() => {
    for (const spot of selectedSpots()) {
      const type = spotTransition(spot)?.type;
      if (type !== undefined) return transitionOption(type).name;
    }
    return null;
  });

  const cuts = useDerived(() => {
    const scene = getActiveEntity(world);
    return scene && isScene(scene) ? sceneJoins(world, scene).length : 0;
  });

  // With clips selected, the tile lit is what they play, none if nothing:
  // a lit tile never claims a transition that is not there.
  const picked = createMemo(() => (selectedSpots().length > 0 ? current() : pickedTransition()));
  const pickedLabel = createMemo(() => TRANSITION_OPTIONS.find((option) => option.name === pickedTransition())?.label ?? "");

  const handlePick = (option: TransitionOption) => {
    setPickedTransition(option.name);
    const spots: Spot[] = selectedSpots();
    if (!spots.length) return;
    applyTransition(world, spots, option.name);
    const clips = selection.nodes().filter(takesTransition);
    if (clips.length === 1) requestTransitionEnd({ clip: clips[0]!, edge: "out" });
  };

  const handleRemove = () => {
    for (const spot of selectedSpots()) {
      if (spotTransition(spot)) clearTransition(world, spot);
    }
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
            <For each={TRANSITION_OPTIONS}>
              {(option) => (
                <PresetTile
                  label={t(option.label)}
                  selected={picked() === option.name}
                  drag={{ type: TRANSITION_DRAG_TYPE, data: option.name }}
                  onClick={() => handlePick(option)}
                >
                  {() => <TransitionPreview type={option.name} />}
                </PresetTile>
              )}
            </For>
          </PresetGrid>
        </div>
      </div>

      <Show
        when={current() === null}
        fallback={
          <div class="shrink-0 border-t border-border p-3">
            <button
              type="button"
              class="flex h-8 w-full min-w-0 items-center justify-center rounded-md bg-secondary px-2 text-xs font-450 text-secondary-foreground transition-colors hover:bg-secondary-hover focus-ring"
              onClick={handleRemove}
            >
              <span class="min-w-0 truncate">{t("Remove transitions")}</span>
            </button>
          </div>
        }
      >
        <Show when={cuts() > 0}>
          <AddButton
            label={t("Add {name} to every cut", { name: t(pickedLabel()) })}
            onClick={() => applyTransitionEverywhere(world, pickedTransition())}
          />
        </Show>
      </Show>
    </div>
  );
}
