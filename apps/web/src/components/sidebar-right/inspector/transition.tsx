/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { TransitionPreview } from "@/components/editor/transition-preview";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { FrameRate, framesToSeconds } from "@plan.video/runtime";
import { useDerived } from "@/engine/hooks";
import { clearTransition, requestTransitionEnd, spotAt, spotTransition, transitionEndRequest, writeTransition } from "@/engine/transitions";
import { t } from "@/lib/i18n";
import { TransitionControls } from "./transition-controls";
import { DEFAULT_TRANSITION_DURATION, TRANSITION_OPTIONS, transitionOption } from "./transition-types";

import type { TransitionOption } from "./transition-types";
import type { ClipEdge, Spot } from "@/engine/transitions";
import type { Entity } from "koota";

type TransitionSettingsProps = {
  selection: Entity[];
};

/** One end of the clip: where its transition is written, and what plays there, if anything. */
type End = {
  spot: Spot;
  type: number | undefined;
  frames: number;
};

const sameEnd = (a: End, b: End) =>
  a.spot.clip === b.spot.clip &&
  a.spot.prop === b.spot.prop &&
  a.spot.partner === b.spot.partner &&
  a.type === b.type &&
  a.frames === b.frames;

/**
 * The clip's two ends, In and Out, each a row showing what plays there. An
 * end that is a cut shows the transition between the two clips, which the
 * clip going out carries; any other end plays the clip in or out on its own
 * (see `Spot`). Clicking a row opens the styles and the settings (see
 * `TransitionControls`), the one place they are changed: the Transitions
 * panel only puts transitions on, then asks for the end it filled to open.
 *
 * The prop is written whole every time (see `writeTransition`). The document
 * merges a partial into the transition already set while the file would
 * spell only what it was handed, so a partial write would leave the two
 * saying different things.
 */
export function TransitionSettings(props: TransitionSettingsProps) {
  const world = useWorld();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [open, setOpen] = createSignal<ClipEdge | null>(null);
  const frameRate = useTrait(world, FrameRate);

  // The Transitions panel put one on: bring the rows into view, then open
  // that end, a frame later, so the panel places itself by where they ended up.
  createEffect(() => {
    const request = transitionEndRequest();
    if (!request) return;
    requestTransitionEnd(null);
    if (request.clip !== entity()) return;
    anchorRef?.scrollIntoView({ block: "start" });
    requestAnimationFrame(() => setOpen(request.edge));
  });

  const readEnd = (edge: ClipEdge): End => {
    const spot = spotAt(world, entity(), edge);
    const current = spotTransition(spot);
    return { spot, type: current?.type, frames: current?.duration ?? 0 };
  };
  const ends = {
    in: useDerived(() => readEnd("in"), sameEnd),
    out: useDerived(() => readEnd("out"), sameEnd),
  };

  // With nothing at either end the section is just its header and a +, which
  // brings the two rows up to pick from.
  const [adding, setAdding] = createSignal(false);
  const empty = () => !adding() && ends.in().type === undefined && ends.out().type === undefined;

  const openEnd = createMemo(() => {
    const edge = open();
    return edge ? ends[edge]() : null;
  });
  const option = createMemo(() => transitionOption(openEnd()?.type));
  const duration = createMemo(() => framesToSeconds(openEnd()?.frames ?? 0, frameRate()?.value ?? 30));

  const handleTypeChange = (next: TransitionOption) => {
    const end = openEnd();
    if (!end || (end.type !== undefined && next.name === option().name)) return;
    if (end.type === undefined) writeTransition(world, end.spot, next.name, DEFAULT_TRANSITION_DURATION, {});
    else writeTransition(world, end.spot, next.name, duration());
  };

  const handleRemove = (edge: ClipEdge) => {
    clearTransition(world, ends[edge]().spot);
    if (open() === edge) setOpen(null);
  };

  const row = (edge: ClipEdge, label: string) => {
    const end = ends[edge];
    return (
      <ItemRow
        label={label}
        value={end().type === undefined ? t("None") : t(transitionOption(end().type).label)}
        icon={<Icon name="video-transition" />}
        onClick={() => setOpen(edge)}
      >
        <Show when={end().type !== undefined}>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => handleRemove(edge)}
            >
              <Icon name="close-remove-small" />
            </TooltipTrigger>
            <TooltipContent>{t("Remove transition")}</TooltipContent>
          </Tooltip>
        </Show>
      </ItemRow>
    );
  };

  return (
    <>
      <PanelSection
        title={t("Transition")}
        ref={anchorRef}
        empty={empty()}
        actions={
          <Show when={empty()}>
            <Tooltip>
              <TooltipTrigger
                as={Button}
                size="icon"
                variant="ghost"
                class="text-muted-foreground"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus-add" />
              </TooltipTrigger>
              <TooltipContent>{t("Add transition")}</TooltipContent>
            </Tooltip>
          </Show>
        }
      >
        <Show when={!empty()}>
          {row("in", t("In"))}
          {row("out", t("Out"))}
        </Show>
      </PanelSection>

      <Show when={openEnd()}>
        {(end) => (
          <FloatingInspector open anchorRef={anchorRef} width={328}>
            <FloatingInspectorHeader class="items-center justify-between">
              <FloatingInspectorTitle>
                {open() === "in" ? t("In") : t("Out")}
                <Show when={end().type !== undefined}>{` · ${t(option().label)}`}</Show>
              </FloatingInspectorTitle>
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => setOpen(null)}
                >
                  <Icon name="close-remove" />
                </TooltipTrigger>
                <TooltipContent>{t("Close")}</TooltipContent>
              </Tooltip>
            </FloatingInspectorHeader>
            <FloatingInspectorSeparator />
            <FloatingInspectorContent class="flex flex-col gap-3 p-3">
              <div class="max-h-[352px] overflow-y-auto">
                <PresetGrid columns={3}>
                  <For each={TRANSITION_OPTIONS}>
                    {(next) => (
                      <PresetTile
                        label={t(next.label)}
                        selected={end().type !== undefined && next.name === option().name}
                        onClick={() => handleTypeChange(next)}
                      >
                        {() => <TransitionPreview type={next.name} />}
                      </PresetTile>
                    )}
                  </For>
                </PresetGrid>
              </div>
              <Show when={end().type !== undefined}>
                <TransitionControls spots={[end().spot]} />
              </Show>
            </FloatingInspectorContent>
          </FloatingInspector>
        )}
      </Show>
    </>
  );
}
