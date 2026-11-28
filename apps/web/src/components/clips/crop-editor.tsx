/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, createEffect } from "solid-js";

import { postLayout } from "@/lib/post-builder";
import { CROP_COLORS, CROP_LABELS, type Box, type CropId, type Crops } from "@/lib/stream-layouts";
import { t } from "@/lib/i18n";

type CropEditorProps = {
  layout: string;
  /** Shares of the source; ones left out use the layout's own. */
  crops: Crops;
  /** The picture to crop, drawn as it is now. */
  source: HTMLVideoElement | null;
  /** Bumped to redraw the picture. */
  frame: number;
  onChange(id: CropId, box: Box): void;
};

const LEAST = 0.05;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function CropEditor(props: CropEditorProps) {
  let canvas!: HTMLCanvasElement;
  let area!: HTMLDivElement;
  const aspect = () => (props.source?.videoWidth && props.source.videoHeight ? props.source.videoWidth / props.source.videoHeight : 16 / 9);

  /** Every crop the layout uses, as shares of the source. */
  const boxes = (): { id: CropId; box: Box }[] => {
    const width = props.source?.videoWidth || 1920;
    const height = props.source?.videoHeight || 1080;
    const { crops } = postLayout(props.layout, { width, height }, props.crops);
    return (Object.entries(crops) as [CropId, Box][]).map(([id, box]) => ({
      id,
      box: { x: box.x / width, y: box.y / height, width: box.width / width, height: box.height / height },
    }));
  };

  createEffect(() => {
    void props.frame;
    const source = props.source;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.clientWidth || 300;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round((width / aspect()) * ratio);
    if (source && source.readyState >= 2) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    else {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  });

  const grab = (id: CropId, start: Box, mode: "move" | "nw" | "ne" | "sw" | "se") => (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const bounds = area.getBoundingClientRect();
    const x0 = event.clientX;
    const y0 = event.clientY;
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - x0) / bounds.width;
      const dy = (next.clientY - y0) / bounds.height;
      let { x, y, width, height } = start;
      if (mode === "move") {
        x = clamp(x + dx, 0, 1 - width);
        y = clamp(y + dy, 0, 1 - height);
      } else {
        const right = x + width;
        const bottom = y + height;
        if (mode.includes("w")) x = clamp(x + dx, 0, right - LEAST);
        if (mode.includes("e")) width = clamp(width + dx, LEAST, 1 - x);
        if (mode.includes("n")) y = clamp(y + dy, 0, bottom - LEAST);
        if (mode.includes("s")) height = clamp(height + dy, LEAST, 1 - y);
        if (mode.includes("w")) width = right - x;
        if (mode.includes("n")) height = bottom - y;
      }
      props.onChange(id, { x, y, width, height });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const nudge = (id: CropId, box: Box) => (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    props.onChange(id, { ...box, x: clamp(box.x + dx, 0, 1 - box.width), y: clamp(box.y + dy, 0, 1 - box.height) });
  };

  return (
    <div ref={area} class="relative w-full touch-none select-none overflow-hidden rounded-lg bg-black" style={{ "aspect-ratio": String(aspect()) }}>
      <canvas ref={canvas} class="absolute inset-0 size-full" aria-hidden="true" />
      <For each={boxes()}>
        {(entry) => (
          <div
            role="slider"
            tabIndex={0}
            aria-label={t("{name} crop", { name: t(CROP_LABELS[entry.id]) })}
            aria-valuetext={`${Math.round(entry.box.x * 100)}%, ${Math.round(entry.box.y * 100)}%`}
            class="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              left: `${entry.box.x * 100}%`,
              top: `${entry.box.y * 100}%`,
              width: `${entry.box.width * 100}%`,
              height: `${entry.box.height * 100}%`,
              "box-shadow": `inset 0 0 0 2px ${CROP_COLORS[entry.id]}`,
              "background-color": `color-mix(in srgb, ${CROP_COLORS[entry.id]} 12%, transparent)`,
            }}
            onPointerDown={grab(entry.id, entry.box, "move")}
            onKeyDown={nudge(entry.id, entry.box)}
          >
            <span class="absolute top-1 left-1 rounded px-1 py-px text-[10px] font-medium text-white" style={{ "background-color": CROP_COLORS[entry.id] }}>
              {t(CROP_LABELS[entry.id])}
            </span>
            <For each={["nw", "ne", "sw", "se"] as const}>
              {(corner) => (
                <span
                  class="absolute size-3 rounded-full border-2 border-white"
                  classList={{
                    "-top-1.5 -left-1.5 cursor-nwse-resize": corner === "nw",
                    "-top-1.5 -right-1.5 cursor-nesw-resize": corner === "ne",
                    "-bottom-1.5 -left-1.5 cursor-nesw-resize": corner === "sw",
                    "-bottom-1.5 -right-1.5 cursor-nwse-resize": corner === "se",
                  }}
                  style={{ "background-color": CROP_COLORS[entry.id] }}
                  onPointerDown={grab(entry.id, entry.box, corner)}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
