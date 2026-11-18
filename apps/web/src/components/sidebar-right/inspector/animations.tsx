/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { ItemRow } from "@/components/ui/item-row";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectSection,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { Animation as AnimationElement } from "@plan.video/reconciler";
import {
  Animation,
  AnimationPhase,
  Cache,
  FrameRate,
  Paint,
  PaintType,
  framesToSeconds,
  getIntrinsicPaint,
  isAudio,
  isText,
} from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { t } from "@/lib/i18n";
import { ANIMATION_GROUPS, DEFAULT_ANIMATION, LOOP_ANIMATIONS, POP_MOTION_DURATION, animationOption } from "./animation-types";
import { MixedTag, useMixed } from "./word-mix";

import type { AnimationGroup, AnimationOption } from "./animation-types";
import type { Entity } from "koota";

/** `<animation>`'s defaults; a control left at one of these unsets its prop. */
const DEFAULT_DURATION = 1;
const DEFAULT_DELAY = 0;

// Stable identity, so a node without animations does not resample every tick.
const NO_ANIMATIONS: Entity[] = [];

const PHASE_RANK: Record<AnimationPhase, number> = {
  [AnimationPhase.IN]: 0,
  [AnimationPhase.LOOP]: 1,
  [AnimationPhase.OUT]: 2,
};

const phaseRank = (animation: Entity) => PHASE_RANK[animation.get(Animation)?.phase ?? AnimationPhase.IN];

type PhaseName = "in" | "out" | "loop";

const PHASE_NAMES: Record<AnimationPhase, PhaseName> = {
  [AnimationPhase.IN]: "in",
  [AnimationPhase.OUT]: "out",
  [AnimationPhase.LOOP]: "loop",
};

const phaseLabel = (phase: PhaseName) => (phase === "out" ? t("Out") : phase === "loop" ? t("Loop") : t("In"));

const sameOrder = (a: Entity[], b: Entity[]) =>
  a.length === b.length && a.every((entity, index) => entity === b[index]);

type AnimationsSettingsProps = {
  selection: Entity[];
  words?: boolean;
};

export function AnimationsSettings(props: AnimationsSettingsProps) {
  const editor = useEditor();
  const mixed = useMixed();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const [picked, setPicked] = createSignal<Entity>();

  // Cache is derived state, written without change events.
  const animations = useDerived(() => {
    const list = entity().get(Cache)?.animations ?? NO_ANIMATIONS;
    // Sorting is stable, so the file's order survives within each phase.
    return list.length < 2 ? list : [...list].sort((a, b) => phaseRank(a) - phaseRank(b));
  }, sameOrder);

  const handleAppendAnimation = () => {
    const [animation] = editor.insertElement(entity(), () => (
      <AnimationElement type={DEFAULT_ANIMATION.name} />
    ));
    if (animation) setPicked(animation);
  };

  // Read back off the list, so removing an animation closes the inspector on it.
  const editing = createMemo(() => {
    const animation = picked();
    return animation !== undefined && animations().includes(animation) ? animation : undefined;
  });

  return (
    <>
      <PanelSection
        title={t("Animations")}
        empty={animations().length === 0}
        subtitle={<MixedTag when={mixed("animations")} />}
        ref={anchorRef}
        actions={
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={handleAppendAnimation}
            >
              <Icon name="plus-add" />
            </TooltipTrigger>
            <TooltipContent>{t("Add animation")}</TooltipContent>
          </Tooltip>
        }
      >
        <For each={animations()}>
          {(animation) => (
            <AnimationRow
              animation={animation}
              onSelect={() => setPicked(animation)}
              onRemove={() => editor.remove(animation)}
            />
          )}
        </For>
      </PanelSection>

      <Show when={editing() !== undefined}>
        <AnimationInspector
          animation={editing()!}
          node={entity()}
          words={props.words ?? false}
          anchorRef={anchorRef}
          onClose={() => setPicked(undefined)}
        />
      </Show>
    </>
  );
}

type AnimationRowProps = {
  animation: Entity;
  onSelect(): void;
  onRemove(): void;
};

function AnimationRow(props: AnimationRowProps) {
  const animation = useTrait(() => props.animation, Animation);

  const label = createMemo(() => t(animationOption(animation()?.type).label));
  const phase = createMemo(() => {
    const value = animation()?.phase;
    return value === AnimationPhase.OUT ? t("OUT") : value === AnimationPhase.LOOP ? t("LOOP") : t("IN");
  });

  return (
    <ItemRow
      label={phase()}
      value={label()}
      icon={<Icon name="preferences-adjust" />}
      onClick={props.onSelect}
    >
      <Tooltip>
        <TooltipTrigger
          as={Button}
          size="icon"
          variant="ghost"
          class="text-muted-foreground"
          onClick={props.onRemove}
        >
          <Icon name="close-remove-small" />
        </TooltipTrigger>
        <TooltipContent>{t("Remove animation")}</TooltipContent>
      </Tooltip>
    </ItemRow>
  );
}

function hasAudio(node: Entity): boolean {
  if (isAudio(node) || getIntrinsicPaint(node) === PaintType.VIDEO) return true;
  return (node.get(Cache)?.fills ?? []).some((fill) => fill.get(Paint)?.value === PaintType.VIDEO);
}

type AnimationInspectorProps = {
  animation: Entity;
  node: Entity;
  words: boolean;
  anchorRef: HTMLElement;
  onClose(): void;
};

// `type` is required and always written; the other three unset at their defaults.
function AnimationInspector(props: AnimationInspectorProps) {
  const world = useWorld();
  const editor = useEditor();

  const animation = useTrait(() => props.animation, Animation);
  const frameRate = useTrait(world, FrameRate);

  const option = createMemo(() => animationOption(animation()?.type));
  const fps = () => frameRate()?.value ?? 30;
  const duration = createMemo(() => framesToSeconds(animation()?.duration ?? 0, fps()));
  const delay = createMemo(() => framesToSeconds(animation()?.delay ?? 0, fps()));
  const phase = createMemo(() => PHASE_NAMES[animation()?.phase ?? AnimationPhase.IN]);

  // Plus whichever group holds the current preset: a `gain` on a node that has since lost its audio
  // must still show, or the select would have no value to display.
  const groups = createMemo(() =>
    ANIMATION_GROUPS.filter(
      (group) =>
        group.kind === undefined ||
        (!props.words && (group.kind === "text" ? isText(props.node) : hasAudio(props.node))) ||
        group.options.includes(option()),
    ),
  );

  const handleTypeChange = (next: AnimationOption | null) => {
    if (next === null || next.name === option().name) return;
    editor.editProperty(props.animation, "type", next.name);
    if ((next.name === "pop" || next.name === "bounce") && duration() === DEFAULT_DURATION) {
      editor.editProperty(props.animation, "duration", POP_MOTION_DURATION);
    }
    if (LOOP_ANIMATIONS.has(next.name) && phase() !== "loop") handlePhaseChange("loop");
  };

  const handlePhaseChange = (next: PhaseName) => {
    editor.editProperty(props.animation, "phase", next === "in" ? false : next);
  };

  const handleDurationChange = (seconds: number) => {
    const next = Math.round(seconds * 10) / 10;
    editor.editProperty(props.animation, "duration", next === DEFAULT_DURATION ? false : next);
  };

  const handleDelayChange = (seconds: number) => {
    const next = Math.round(seconds * 10) / 10;
    editor.editProperty(props.animation, "delay", next === DEFAULT_DELAY ? false : next);
  };

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={248}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select<AnimationOption, AnimationGroup>
          value={option()}
          onChange={handleTypeChange}
          options={groups()}
          optionValue="name"
          optionTextValue="label"
          optionGroupChildren="options"
          itemComponent={(itemProps) => (
            <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.label)}</SelectItem>
          )}
          sectionComponent={(sectionProps) => (
            <SelectSection>{t(sectionProps.section.rawValue.label)}</SelectSection>
          )}
        >
          <SelectTrigger>
            <SelectValue<AnimationOption>>
              {(state) => t(state.selectedOption()?.label ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
        <Tooltip>
          <TooltipTrigger
            as={Button}
            size="icon"
            variant="ghost"
            class="text-muted-foreground"
            onClick={props.onClose}
          >
            <Icon name="close-remove" />
          </TooltipTrigger>
          <TooltipContent>{t("Close")}</TooltipContent>
        </Tooltip>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="flex flex-col gap-2 p-4">
        <ControlRow label={t("Phase")}>
          {/* Kobalte keys only strings, numbers and objects: booleans all got the same empty key. */}
          <Select<PhaseName>
            value={phase()}
            onChange={(value) => value !== null && handlePhaseChange(value)}
            options={["in", "loop", "out"]}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>{phaseLabel(itemProps.item.rawValue)}</SelectItem>
            )}
          >
            <SelectTrigger>
              <SelectValue class="text-xs">{phaseLabel(phase())}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        </ControlRow>

        <ControlRow label={t("Duration")}>
          <SliderInput
            value={duration()}
            onChange={handleDurationChange}
            min={0.1}
            max={5}
            step={0.1}
            format={(value) => `${value.toFixed(1)}s`}
          />
        </ControlRow>

        <ControlRow label={t("Delay")}>
          <SliderInput
            value={delay()}
            onChange={handleDelayChange}
            min={0}
            max={5}
            step={0.1}
            format={(value) => `${value.toFixed(1)}s`}
          />
        </ControlRow>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}
