/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal } from "solid-js";
import ArrowDownLucide from "lucide-solid/icons/arrow-down";
import ArrowLeftLucide from "lucide-solid/icons/arrow-left";
import ArrowRightLucide from "lucide-solid/icons/arrow-right";
import ArrowUpLucide from "lucide-solid/icons/arrow-up";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { FrameRate, framesToSeconds, parseColor } from "@plan.video/runtime";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ControlRow } from "@/components/ui/control-group";
import { Popover, PopoverContent, PopoverPortal } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SliderInput } from "@/components/ui/slider-input";
import { useDerived } from "@/engine/hooks";
import { setTransitionFinish, setTransitionLength, spotFinish, spotTransition } from "@/engine/transitions";
import { colorToHex } from "@/utils/color";
import { msg, t } from "@/lib/i18n";
import { transitionOption } from "./transition-types";

import type { Component } from "solid-js";
import type { TransitionType as TransitionName } from "@plan.video/jsx";
import type { Spot, TransitionFinish } from "@/engine/transitions";

type Way = "left" | "right" | "up" | "down";

/** The way each style that moves goes on its own, which its direction cell shows lit until another is set. */
const OWN_WAY: Partial<Record<TransitionName, Way>> = {
  slideFromRight: "left",
  slideFromLeft: "right",
  pushLeft: "left",
  pushUp: "up",
  whip: "left",
  wipe: "right",
};

/** The colour each fade or flash goes through on its own. */
const OWN_COLOR: Partial<Record<TransitionName, number>> = {
  fadeToBlack: 0x000000,
  fadeToWhite: 0xffffff,
  flash: 0xffffff,
};

const WAYS: { way: Way; label: string; icon: Component<{ class?: string; "aria-hidden"?: "true" }> }[] = [
  { way: "left", label: msg("Left"), icon: ArrowLeftLucide },
  { way: "right", label: msg("Right"), icon: ArrowRightLucide },
  { way: "up", label: msg("Up"), icon: ArrowUpLucide },
  { way: "down", label: msg("Down"), icon: ArrowDownLucide },
];

/** "auto" is the style's own curve: Kobalte keys only strings, so it cannot be null. */
const EASINGS: { value: string; label: string }[] = [
  { value: "auto", label: msg("Default") },
  { value: "linear", label: msg("Linear") },
  { value: "easeIn", label: msg("Ease in") },
  { value: "easeOut", label: msg("Ease out") },
  { value: "easeInOut", label: msg("Ease in and out") },
];

type Shown = { name: TransitionName; frames: number; finish: TransitionFinish };

const sameShown = (a: Shown | null, b: Shown | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.name === b.name &&
    a.frames === b.frames &&
    a.finish.direction === b.finish.direction &&
    a.finish.easing === b.finish.easing &&
    a.finish.color === b.finish.color);

type TransitionControlsProps = {
  /** The spots to change, each playing a transition; the first one's settings show. */
  spots: Spot[];
};

/**
 * A transition's settings: how long it lasts, the curve it plays along, and
 * for the styles they apply to, which way it goes and the colour it goes
 * through. Each change goes on every spot handed in, as one step to undo.
 */
export function TransitionControls(props: TransitionControlsProps) {
  const world = useWorld();
  const frameRate = useTrait(world, FrameRate);

  const shown = useDerived((): Shown | null => {
    const spot = props.spots[0];
    const current = spot && spotTransition(spot);
    if (!spot || !current) return null;
    return { name: transitionOption(current.type).name, frames: current.duration, finish: spotFinish(spot) };
  }, sameShown);

  const duration = createMemo(() => framesToSeconds(shown()?.frames ?? 0, frameRate()?.value ?? 30));
  const easing = createMemo(() => EASINGS.find((option) => option.value === (shown()?.finish.easing ?? "auto")) ?? EASINGS[0]!);
  const ownWay = createMemo(() => {
    const name = shown()?.name;
    return name ? OWN_WAY[name] : undefined;
  });
  const way = createMemo(() => (shown()?.finish.direction as Way | undefined) ?? ownWay());
  const ownColor = createMemo(() => {
    const name = shown()?.name;
    return name ? OWN_COLOR[name] : undefined;
  });
  const color = createMemo(() => parseColor(shown()?.finish.color) ?? ownColor() ?? 0);

  const [picking, setPicking] = createSignal(false);
  let colorRow: HTMLDivElement | undefined;

  const handleWay = (next: Way) => {
    if (next === way()) return;
    setTransitionFinish(world, props.spots, { direction: next === ownWay() ? null : next });
  };

  const handleColor = (next: number) => {
    if (next === color()) return;
    setTransitionFinish(world, props.spots, { color: next === ownColor() ? null : colorToHex(next) });
  };

  return (
    <Show when={shown()}>
      <div class="flex flex-col gap-2">
        <ControlRow label={t("Duration")}>
          <SliderInput
            value={duration()}
            onChange={(seconds) => setTransitionLength(world, props.spots, seconds)}
            min={0.1}
            max={10}
            step={0.1}
            format={(value) => `${value.toFixed(1)}s`}
          />
        </ControlRow>

        <ControlRow label={t("Easing")}>
          <Select<(typeof EASINGS)[number]>
            value={easing()}
            onChange={(next) => next && setTransitionFinish(world, props.spots, { easing: next.value === "auto" ? null : next.value })}
            options={EASINGS}
            optionValue="value"
            optionTextValue="label"
            itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.label)}</SelectItem>}
          >
            <SelectTrigger>
              <SelectValue class="text-xs">{t(easing().label)}</SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent />
            </SelectPortal>
          </Select>
        </ControlRow>

        <Show when={ownWay()}>
          <ControlRow label={t("Direction")}>
            <div class="grid grid-cols-4 gap-1">
              <For each={WAYS}>
                {(option) => (
                  <button
                    type="button"
                    aria-label={t(option.label)}
                    title={t(option.label)}
                    aria-pressed={way() === option.way}
                    class="flex h-7 min-w-0 items-center justify-center rounded-md transition-colors focus-ring"
                    classList={{
                      "bg-secondary text-foreground inset-ring-1 inset-ring-primary": way() === option.way,
                      "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground": way() !== option.way,
                    }}
                    onClick={() => handleWay(option.way)}
                  >
                    <option.icon class="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </For>
            </div>
          </ControlRow>
        </Show>

        <Show when={ownColor() !== undefined}>
          <ControlRow label={t("Color")} ref={colorRow}>
            <ColorOpacityRow color={color()} onChangeColor={handleColor} onClick={() => setPicking(true)} />
          </ControlRow>
          <Popover open={picking()} onOpenChange={setPicking} anchorRef={() => colorRow} placement="left" gutter={16}>
            <PopoverPortal>
              <PopoverContent class="w-auto p-0">
                <ColorOpacityPicker
                  color={color()}
                  opacity={1}
                  onColorChange={handleColor}
                  withoutOpacity
                  defaultColor={ownColor()}
                />
              </PopoverContent>
            </PopoverPortal>
          </Popover>
        </Show>
      </div>
    </Show>
  );
}
