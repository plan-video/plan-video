/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { loadStyleFonts, paintSubtlePage, subtlePageAt, subtlePages, SUBTLE_STYLES } from "@plan.video/runtime";

import type { SubtleFrame, SubtleStyleName } from "@plan.video/runtime";

/** The style's own drawing on a tall frame as wide as the tile, its line at the tile's middle. */
export function SubtleTemplateLook(props: { name: SubtleStyleName; words: string[]; wordSeconds: number; time: () => number }) {
  let canvas!: HTMLCanvasElement;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [loaded, setLoaded] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  const style = () => SUBTLE_STYLES[props.name];

  onMount(() => {
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    const seen = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    resize.observe(canvas);
    seen.observe(canvas);
    onCleanup(() => {
      resize.disconnect();
      seen.disconnect();
    });
  });

  createEffect(() => {
    setLoaded(false);
    void loadStyleFonts(style()).then(() => setLoaded(true));
  });

  // Built after the fonts load, so the cached layouts measure the real faces.
  const pages = createMemo(() => {
    if (!loaded()) return [];
    const words = props.words.map((text, i) => ({
      text,
      startMs: i * props.wordSeconds * 1000,
      endMs: (i + 1) * props.wordSeconds * 1000 - 40,
    }));
    const list = subtlePages(style(), words, false);
    // Held until the loop starts over, so a tile is never blank.
    const last = list[list.length - 1];
    if (last) last.endMs = Infinity;
    return list;
  });

  createEffect(() => {
    const { width, height } = size();
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  });

  let drawn = "";
  createEffect(() => {
    const list = pages();
    if (!visible() || !list.length || !canvas.width) {
      drawn = "";
      return;
    }
    const ms = props.time() * 1000;
    // 30 drawings a second is what the style is timed in.
    const key = `${canvas.width}:${Math.floor(ms / (1000 / 30))}`;
    if (key === drawn) return;
    drawn = key;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const index = subtlePageAt(list, ms);
    if (index === -1) return;
    const st = style().style;
    const W = canvas.width;
    // A frame taller than a phone's, so the words fill the tile as the other tiles' do; wide styles still fit its width.
    const f: SubtleFrame = { W, H: W * 2.8, fps: 30, wide: false, unit: 1 };
    ctx.save();
    ctx.translate(0, canvas.height / 2 - (f.H * st.position.y) / 100);
    paintSubtlePage(ctx, style(), st, f, list[index]!, index, ms);
    ctx.restore();
  });

  return <canvas ref={canvas} aria-hidden="true" class="absolute inset-0 size-full" />;
}
