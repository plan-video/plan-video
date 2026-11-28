/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, onCleanup, onMount } from "solid-js";

import { clock } from "@/lib/clip-studio";
import { t } from "@/lib/i18n";

import type { ClipPeaks } from "./clip-media";

type TrimBarProps = {
  /** Broadcast seconds that can be shown. */
  range: { start: number; end: number };
  start: number;
  end: number;
  /** Seconds into the clip. */
  time: number;
  peaks: ClipPeaks | undefined;
  /** Where the range starts in the waveform's file. */
  fileStart: number | undefined;
  /** Seconds into the clip where words are said, as faint ticks. */
  words: number[];
  onTrim(start: number, end: number): void;
  onSeek(time: number): void;
};

const NUDGE = 0.1;

export function TrimBar(props: TrimBarProps) {
  let track!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  const span = () => Math.max(1, props.range.end - props.range.start);
  const at = (seconds: number) => ((seconds - props.range.start) / span()) * 100;

  const secondsAt = (clientX: number) => {
    const box = track.getBoundingClientRect();
    return props.range.start + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * span();
  };

  const draw = () => {
    const ctx = canvas.getContext("2d");
    const peaks = props.peaks;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!ctx || !width) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!peaks || props.fileStart === undefined) return;
    const color = getComputedStyle(canvas).color;
    ctx.fillStyle = color;
    const bars = Math.floor(width / 3);
    for (let i = 0; i < bars; i++) {
      const seconds = props.fileStart + (i / bars) * span();
      const index = Math.floor((seconds / peaks.duration) * peaks.values.length);
      const value = peaks.values[Math.min(peaks.values.length - 1, Math.max(0, index))] ?? 0;
      const bar = Math.max(1.5, value * (height - 6));
      ctx.fillRect(i * 3, (height - bar) / 2, 2, bar);
    }
  };

  createEffect(() => {
    void props.peaks;
    void props.fileStart;
    void props.range.start;
    void props.range.end;
    draw();
  });
  onMount(() => {
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    onCleanup(() => observer.disconnect());
  });

  const drag = (edge: "start" | "end" | "seek") => (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      const seconds = secondsAt(next.clientX);
      if (edge === "start") props.onTrim(Math.min(seconds, props.end - 1), props.end);
      else if (edge === "end") props.onTrim(props.start, Math.max(seconds, props.start + 1));
      else props.onSeek(Math.min(props.end, Math.max(props.start, seconds)) - props.start);
    };
    move(event);
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const nudge = (edge: "start" | "end") => (event: KeyboardEvent) => {
    const step = (event.shiftKey ? 1 : NUDGE) * (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0);
    if (!step) return;
    event.preventDefault();
    if (edge === "start") props.onTrim(props.start + step, props.end);
    else props.onTrim(props.start, props.end + step);
  };

  return (
    <div class="flex flex-col gap-2">
      <div
        ref={track}
        class="relative h-14 cursor-pointer touch-none select-none overflow-hidden rounded-lg bg-(--plane-layer-1) ring-1 ring-inset ring-(--plane-border-subtle)"
        onPointerDown={drag("seek")}
      >
        <canvas ref={canvas} class="absolute inset-0 size-full text-(--plane-text-placeholder)" aria-hidden="true" />
        <div class="pointer-events-none absolute inset-y-0 left-0 bg-(--plane-surface-1)/70" style={{ width: `${at(props.start)}%` }} />
        <div class="pointer-events-none absolute inset-y-0 right-0 bg-(--plane-surface-1)/70" style={{ width: `${100 - at(props.end)}%` }} />
        <div class="pointer-events-none absolute inset-y-0 rounded-md ring-2 ring-inset ring-primary" style={{ left: `${at(props.start)}%`, width: `${at(props.end) - at(props.start)}%` }}>
          <div class="absolute inset-x-0 bottom-0 h-2">
            {props.words.map((word) => (
              <span class="absolute bottom-1 h-1 w-px bg-primary/60" style={{ left: `${(word / Math.max(0.1, props.end - props.start)) * 100}%` }} />
            ))}
          </div>
        </div>
        <div class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${at(props.start + props.time)}%` }} />
        <button
          type="button"
          aria-label={t("Clip start")}
          class="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded-l-md bg-primary outline-none focus-ring"
          style={{ left: `${at(props.start)}%` }}
          onPointerDown={drag("start")}
          onKeyDown={nudge("start")}
        >
          <span class="mx-auto block h-5 w-0.5 rounded-full bg-primary-foreground/80" />
        </button>
        <button
          type="button"
          aria-label={t("Clip end")}
          class="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize rounded-r-md bg-primary outline-none focus-ring"
          style={{ left: `${at(props.end)}%` }}
          onPointerDown={drag("end")}
          onKeyDown={nudge("end")}
        >
          <span class="mx-auto block h-5 w-0.5 rounded-full bg-primary-foreground/80" />
        </button>
        <Show when={!props.peaks}>
          <span class="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">{t("Loading the sound…")}</span>
        </Show>
      </div>
      <div class="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
        <span>{clock(props.range.start)}</span>
        <span class="text-foreground">
          {clock(props.start, true)} – {clock(props.end, true)} · {t("{seconds} s", { seconds: (props.end - props.start).toFixed(1) })}
        </span>
        <span>{clock(props.range.end)}</span>
      </div>
    </div>
  );
}
