/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { loadWebFont } from "@plan.video/runtime";
import { useWorld } from "@plan.video/koota-solid";

import { textStyleWords, type TextStyle } from "@/engine/text-presets";
import { t } from "@/lib/i18n";

/** How much of the tile the words may take, across and down. */
const ACROSS = 0.8;
const DOWN = 0.36;

/**
 * A text style drawn on a canvas the size of its tile, in the order the
 * renderer draws a text (runtime utils/text.ts): every shadow, cast by the
 * widest outline when there is one, then the outlines, widest first, then
 * the fill, a gradient running from the top of the line to its foot. So the
 * tile is what the scene gets.
 */
export function TextStyleLook(props: { style: TextStyle }) {
  const world = useWorld();
  let canvas!: HTMLCanvasElement;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [loaded, setLoaded] = createSignal(false);

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const style = props.style;
    setLoaded(false);
    void loadWebFont(world, style.font)
      .catch(() => {})
      .then(() => document.fonts.load(fontOf(style, 100)))
      .catch(() => {})
      .then(() => setLoaded(true));
  });

  createEffect(() => {
    const { width, height } = size();
    const words = textStyleWords(props.style, t(props.style.sample));
    if (!loaded() || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx, props.style, words, canvas.width, canvas.height);
  });

  return <canvas ref={canvas} aria-hidden="true" class="absolute inset-0 size-full" />;
}

function fontOf(style: TextStyle, size: number): string {
  return `${style.italic ? "italic " : ""}${style.weight} ${size}px "${style.font}"`;
}

function draw(ctx: CanvasRenderingContext2D, style: TextStyle, words: string, width: number, height: number) {
  const strokes = style.strokes ?? [];
  const widest = strokes.reduce((most, stroke) => Math.max(most, stroke.width), 0);

  // Sized at 100px, then fitted so the words and their outline sit in the tile.
  // Measured by their ink, not the line box: that box keeps room for
  // descenders and a line gap, and words centred on it sit high.
  ctx.font = fontOf(style, 100);
  ctx.letterSpacing = `${(style.letterSpacing ?? 0) * 100}px`;
  ctx.textBaseline = "alphabetic";
  const probe = ctx.measureText(words);
  const across = (probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight) / 100 + widest;
  const down = (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent) / 100 + widest;
  const size = Math.min((width * ACROSS) / across, (height * DOWN) / down);
  const em = (value: number) => value * size;

  ctx.font = fontOf(style, size);
  ctx.letterSpacing = `${em(style.letterSpacing ?? 0)}px`;
  ctx.lineJoin = "round";
  const metrics = ctx.measureText(words);
  // x and y put the ink's middle on the tile's; y is the baseline.
  const x = (width - metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2 + metrics.actualBoundingBoxLeft;
  const y = (height - metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2 + metrics.actualBoundingBoxAscent;
  // The line box, which a gradient runs down as the renderer's does.
  const top = y - metrics.fontBoundingBoxAscent;
  const boxHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;

  for (const shadow of style.shadows ?? []) {
    ctx.save();
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = em(shadow.blur);
    ctx.shadowOffsetX = em(shadow.x ?? 0);
    ctx.shadowOffsetY = em(shadow.y ?? 0);
    ctx.globalAlpha = shadow.opacity ?? 1;
    ctx.fillStyle = shadow.color;
    ctx.strokeStyle = shadow.color;
    if (widest > 0) {
      ctx.lineWidth = em(widest);
      ctx.strokeText(words, x, y);
    } else {
      ctx.fillText(words, x, y);
    }
    ctx.restore();
  }

  for (const stroke of strokes) {
    ctx.lineWidth = em(stroke.width);
    ctx.strokeStyle = stroke.color;
    ctx.strokeText(words, x, y);
  }

  const fill = style.fill;
  if (typeof fill === "string") {
    ctx.fillStyle = fill;
  } else {
    const gradient = ctx.createLinearGradient(0, top, 0, top + boxHeight);
    gradient.addColorStop(0, fill.from);
    gradient.addColorStop(1, fill.to);
    ctx.fillStyle = gradient;
  }
  ctx.fillText(words, x, y);
}
