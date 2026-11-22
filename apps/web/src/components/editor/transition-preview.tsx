/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { TRANSITION_TYPES } from "@plan.video/reconciler";
import { TransitionType, drawTransitionCut, posedDraw, transitionLook } from "@plan.video/runtime";

import { usePreviewClock } from "@/components/ui/preset-tile";

import type { TransitionType as TransitionName } from "@plan.video/jsx";

/** Out of a 2.4s loop: the first shot holds, the transition plays, the second shot holds. */
const LOOP = 2.4;
const FROM = 0.55;
const LENGTH = 0.9;

/** How far into the transition the tile rests, where it shows the style best. */
const STILLS: Partial<Record<TransitionName, number>> = {
  fadeToBlack: 0.35,
  fadeToWhite: 0.35,
  flash: 0.4,
  whip: 0.4,
  crossZoom: 0.4,
  split: 0.4,
  bloom: 0.4,
  impact: 0.58,
  glitch: 0.47,
};

const FOOTAGE = ["/site/surf.webp", "/site/sunset.webp"];
let footage: Promise<HTMLImageElement[]> | null = null;

function loadFootage(): Promise<HTMLImageElement[]> {
  footage ??= Promise.all(
    FOOTAGE.map(
      (src) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.decoding = "async";
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        }),
    ),
  ).catch((error) => {
    footage = null;
    throw error;
  });
  return footage;
}

function cover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/**
 * The real transition, drawn by the runtime over two stills. It plays while the
 * nearest `.preset-preview` has `data-playing` (PresetTile sets it on hover).
 */
export function TransitionPreview(props: { type: TransitionName }) {
  let canvas!: HTMLCanvasElement;
  const [playing, setPlaying] = createSignal(false);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [images, setImages] = createSignal<HTMLImageElement[] | null>(null);

  const still = () => FROM + LENGTH * (STILLS[props.type] ?? 0.5);
  const time = usePreviewClock(playing, { loop: LOOP, still: still() });

  onMount(() => {
    const holder = canvas.closest(".preset-preview");
    const read = () => setPlaying(holder?.hasAttribute("data-playing") ?? false);
    read();
    const watch = holder ? new MutationObserver(read) : null;
    if (holder) watch!.observe(holder, { attributes: true, attributeFilter: ["data-playing"] });

    const resize = new ResizeObserver(() => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      setSize({ width: Math.round(canvas.clientWidth * ratio), height: Math.round(canvas.clientHeight * ratio) });
    });
    resize.observe(canvas);

    let live = true;
    loadFootage().then((loaded) => live && setImages(loaded), () => undefined);

    onCleanup(() => {
      live = false;
      watch?.disconnect();
      resize.disconnect();
    });
  });

  createEffect(() => {
    const loaded = images();
    const { width, height } = size();
    if (!loaded || width === 0 || height === 0) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const completion = Math.min(1, Math.max(0, (time() - FROM) / LENGTH));
    const box = { x: 0, y: 0, width, height };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    const look = transitionLook(TRANSITION_TYPES[props.type] ?? TransitionType.DISSOLVE);
    const draw = posedDraw(ctx, box, (side) => cover(ctx, loaded[side]!, width, height));
    drawTransitionCut({ ctx, box, frame: box, draw }, look, completion);
  });

  return <canvas ref={canvas} aria-hidden="true" class="absolute inset-0 size-full" />;
}
