/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, type JSX } from "solid-js";
import { Slider as SliderPrimitive } from "@kobalte/core/slider";
import { cx } from "@/lib/cva";

type SliderRowProps = {
  label: string;
  hideLabel?: boolean;
  value: number;
  min: number;
  max: number;
  step?: number;
  ticks?: number[];
  trackClass?: string;
  values?: JSX.Element;
  onChange(value: number): void;
};

export function SliderRow(props: SliderRowProps) {
  const clamp = (value: number) => Math.max(props.min, Math.min(props.max, value));
  const percent = (value: number) => `${((value - props.min) / (props.max - props.min)) * 100}%`;

  // Kobalte re-emits its controlled value after each drag step, and `props.value` comes
  // from Computed, a frame behind: controlling it directly snaps the thumb back.
  const [position, setPosition] = createSignal(clamp(props.value));
  let dragging = false;

  createEffect(() => {
    const next = clamp(props.value);
    if (!dragging) setPosition(next);
  });

  const handleChange = (value: number) => {
    if (value === position()) return;
    setPosition(value);
    props.onChange(value);
  };

  const startDrag = () => {
    dragging = true;
  };

  // A pointer leaves focus on the thumb, where the editor's shortcuts (undo, play) don't fire.
  // Kobalte refocuses it right after onChangeEnd, so this has to run later. Keyboard use keeps focus.
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    queueMicrotask(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  };

  return (
    <div class="flex min-w-0 flex-col gap-1">
      <Show when={!props.hideLabel}>
        <div class="flex h-7 items-center justify-between gap-2">
          <span class="truncate text-xs text-muted-foreground">{props.label}</span>
          <div class="flex shrink-0 items-center gap-1.5">{props.values}</div>
        </div>
      </Show>
      <SliderPrimitive
        class="w-full touch-none select-none"
        minValue={props.min}
        maxValue={props.max}
        step={props.step ?? 1}
        value={[position()]}
        onChange={([value]) => handleChange(value!)}
        onChangeEnd={endDrag}
      >
        <SliderPrimitive.Track class="relative h-5 w-full" onPointerDown={startDrag}>
          <span class={cx("absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-input", props.trackClass)} />
          <For each={props.ticks}>
            {(tick) => (
              <span
                class="absolute top-1/2 h-1.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-foreground/20"
                style={{ left: percent(tick) }}
              />
            )}
          </For>
          <SliderPrimitive.Thumb class="top-px block h-4.5 w-1 rounded-full bg-foreground outline-none focus-ring" onPointerDown={startDrag}>
            <SliderPrimitive.Input aria-label={props.label} />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Track>
      </SliderPrimitive>
    </div>
  );
}
