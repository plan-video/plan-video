/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onCleanup } from "solid-js";

export type MarqueeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DRAG_THRESHOLD_PX = 4;
const SCROLL_EDGE_PX = 32;
const SCROLL_MAX_STEP_PX = 18;

type ProjectMarqueeOptions = {
  /** The selection as it stands, snapshotted when a drag actually starts. */
  selection: () => ReadonlySet<string>;
  /** `base` is the selection kept under the rectangle: empty for a plain drag, the selection at drag start with shift or cmd/ctrl. */
  onChange: (indexes: string[], base: ReadonlySet<string>) => void;
  /** The selection has not moved yet. */
  onBegin?: () => void;
  onRevert: (previous: ReadonlySet<string>) => void;
  grabs?: (index: string) => boolean;
};

/** Call during a component's setup: it owns a signal and a cleanup. */
export function createProjectMarquee(options: ProjectMarqueeOptions) {
  const [rect, setRect] = createSignal<MarqueeRect | null>(null);

  let scroller: HTMLElement | null = null;
  let pointerId = -1;
  let originX = 0;
  let originY = 0;
  let pointerX = 0;
  let pointerY = 0;
  let listening = false;
  let dragging = false;
  let additive = false;
  let previous: ReadonlySet<string> = new Set();
  let base: ReadonlySet<string> = new Set();
  let raf = 0;

  const projectsInRect = (box: MarqueeRect): string[] => {
    const root = scroller;
    if (!root) return [];

    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const dirs: string[] = [];

    for (const node of root.querySelectorAll<HTMLElement>("[data-marquee-index]")) {
      const bounds = node.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      if (bounds.right < box.x || bounds.left > right || bounds.bottom < box.y || bounds.top > bottom) {
        continue;
      }
      const index = node.dataset.marqueeIndex;
      if (index !== undefined) dirs.push(index);
    }

    return dirs;
  };

  const publish = () => {
    const box: MarqueeRect = {
      x: Math.min(originX, pointerX),
      y: Math.min(originY, pointerY),
      width: Math.abs(pointerX - originX),
      height: Math.abs(pointerY - originY),
    };
    setRect(box);
    options.onChange(projectsInRect(box), base);
  };

  const edgeStep = (): number => {
    const root = scroller;
    if (!root) return 0;

    const bounds = root.getBoundingClientRect();
    if (pointerY < bounds.top + SCROLL_EDGE_PX) {
      const depth = Math.min(SCROLL_EDGE_PX, bounds.top + SCROLL_EDGE_PX - pointerY);
      return -SCROLL_MAX_STEP_PX * (depth / SCROLL_EDGE_PX);
    }
    if (pointerY > bounds.bottom - SCROLL_EDGE_PX) {
      const depth = Math.min(SCROLL_EDGE_PX, pointerY - (bounds.bottom - SCROLL_EDGE_PX));
      return SCROLL_MAX_STEP_PX * (depth / SCROLL_EDGE_PX);
    }
    return 0;
  };

  const tick = () => {
    raf = 0;
    if (!dragging) return;

    const root = scroller;
    const step = edgeStep();
    if (root && step) {
      const before = root.scrollTop;
      root.scrollTop += step;
      if (root.scrollTop !== before) publish();
    }

    raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    listening = false;
    dragging = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (scroller?.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId);
    document.documentElement.style.userSelect = "";
    setRect(null);
  };

  const swallowClick = () => {
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener("click", swallow, true);
    };
    window.addEventListener("click", swallow, true);
  };

  const beginDrag = () => {
    dragging = true;
    previous = new Set(options.selection());
    base = additive ? previous : new Set();
    options.onBegin?.();
    scroller?.setPointerCapture(pointerId);
    publish();
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!listening || event.pointerId !== pointerId) return;

    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!dragging) {
      if (Math.hypot(pointerX - originX, pointerY - originY) < DRAG_THRESHOLD_PX) return;
      beginDrag();
    }

    event.preventDefault();
    publish();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    // A finished drag has already selected; the click under the pointer
    // would replace that with whichever card it landed on.
    if (dragging) swallowClick();
    stop();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !listening) return;
    event.preventDefault();
    if (dragging) options.onRevert(previous);
    swallowClick();
    stop();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (listening || event.button !== 0 || event.pointerType === "touch") return;

    const target = event.target as HTMLElement | null;
    if (!target) return;
    // A control stays a control, unless it is the selectable item itself (a media tile is a button)
    // or a part of one marked `data-marquee-grab`, like a vault card's text.
    const control = target.closest<HTMLElement>("input, textarea, button, a, [contenteditable='true']");
    if (control && control.dataset.marqueeIndex === undefined && control.dataset.marqueeGrab === undefined) return;

    const card = target.closest<HTMLElement>('[data-slot="card-button"]');
    if (card && card.dataset.marqueeIndex === undefined) return;
    if (card && options.grabs?.(card.dataset.marqueeIndex!)) return;

    const root = event.currentTarget as HTMLElement;
    // The scrollbar lives in the scroller's padding box; dragging it scrolls.
    if (target === root && (event.offsetX > root.clientWidth || event.offsetY > root.clientHeight)) return;

    scroller = root;
    pointerId = event.pointerId;
    originX = pointerX = event.clientX;
    originY = pointerY = event.clientY;
    additive = event.shiftKey || event.metaKey || event.ctrlKey;
    listening = true;
    document.documentElement.style.userSelect = "none";

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
  };

  onCleanup(stop);

  return { rect, onPointerDown };
}
