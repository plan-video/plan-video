/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, Show, type JSX } from "solid-js";

import { cx } from "@/lib/cva";

import "./preset-tile.css";

export type PresetTileProps = {
  label?: string;
  tag?: string;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  aspect?: string;
  class?: string;
  onClick?: (event: MouseEvent) => void;
  drag?: { type: string; data: string };
  /** Redrawn whenever `playing` flips, so CSS previews restart from their first frame (see preset-tile.css). */
  children: (playing: boolean) => JSX.Element;
};

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PresetTile(props: PresetTileProps) {
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  const playing = createMemo(() => (hovered() || focused()) && !reducedMotion());

  const preview = createMemo(() => {
    const play = playing();
    return props.children(play);
  });

  let dragImage: HTMLDivElement | undefined;

  const handleDragStart = (event: DragEvent) => {
    const drag = props.drag;
    if (!drag || !event.dataTransfer) return;
    event.dataTransfer.setData(drag.type, drag.data);
    event.dataTransfer.effectAllowed = "copy";
    if (dragImage) event.dataTransfer.setDragImage(dragImage, dragImage.offsetWidth / 2, dragImage.offsetHeight / 2);
  };

  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.label ? undefined : props.title}
      disabled={props.disabled}
      aria-pressed={props.selected ?? false}
      draggable={props.drag !== undefined}
      class={cx(
        "group/tile flex w-full min-w-0 flex-col gap-1.5 rounded-md text-left focus-ring disabled:pointer-events-none disabled:opacity-50",
        props.class,
      )}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
      onDragStart={handleDragStart}
      onClick={(event) => props.onClick?.(event)}
    >
      <div
        ref={dragImage}
        class="preset-preview relative w-full overflow-hidden rounded-md bg-black"
        data-playing={playing() ? "" : undefined}
        style={{ "aspect-ratio": props.aspect ?? "16 / 9" }}
      >
        {preview()}
        {/* Over the preview, which would paint over a ring on the box itself. */}
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 rounded-md transition-shadow"
          classList={{
            "inset-ring-2 inset-ring-primary": props.selected,
            "inset-ring-1 inset-ring-white/6 group-hover/tile:inset-ring-white/16": !props.selected,
          }}
        />
      </div>
      <Show when={props.label}>
        <div class="flex w-full min-w-0 items-center gap-1.5 px-0.5">
          <span class="min-w-0 truncate text-xs text-foreground">{props.label}</span>
          <Show when={props.tag}>
            {(tag) => (
              <span class="shrink-0 rounded-[4px] bg-foreground/10 px-1.5 py-px text-xxs font-450 text-muted-foreground">
                {tag()}
              </span>
            )}
          </Show>
        </div>
      </Show>
    </button>
  );
}

export function PresetGrid(props: { children: JSX.Element; class?: string; columns?: number }) {
  return (
    <div
      class={cx("grid gap-x-2 gap-y-2.5", props.class)}
      style={{ "grid-template-columns": `repeat(${props.columns ?? 2}, minmax(0, 1fr))` }}
    >
      {props.children}
    </div>
  );
}

export function usePreviewClock(playing: () => boolean, options: { loop: number; still: number }) {
  const [time, setTime] = createSignal(options.still);
  let frame = 0;
  let begun = 0;

  const tick = (now: number) => {
    if (!begun) begun = now;
    setTime(((now - begun) / 1000) % options.loop);
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    begun = 0;
  };

  createEffect(() => {
    stop();
    if (playing()) frame = requestAnimationFrame(tick);
    else setTime(options.still);
  });
  onCleanup(stop);

  return time;
}
