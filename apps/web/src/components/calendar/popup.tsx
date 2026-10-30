/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onCleanup, onMount, type JSX, type ParentProps } from "solid-js";
import { Portal } from "solid-js/web";
import { cn } from "./utils";

export type PopupPlacement = "right-start" | "bottom-start" | "bottom-end";

type CalendarPopupProps = ParentProps<{
  anchor: DOMRect | null;
  class?: string;
  label: string;
  onClose(): void;
  placement: PopupPlacement;
}>;

const VIEWPORT_PADDING = 16;
const GUTTER = 10;

function popupOrigin(anchor: DOMRect | null, left: number, top: number, width: number, height: number) {
  if (!anchor || width <= 0 || height <= 0) return "top center";
  const ax = anchor.left + anchor.width / 2;
  const ay = anchor.top + anchor.height / 2;
  const x = Math.abs(ax - (left + width)) <= Math.abs(ax - left) ? "right" : "left";
  const y = Math.abs(ay - (top + height)) <= Math.abs(ay - top) ? "bottom" : "top";
  return `${y} ${x}`;
}

/** Popups stack; only the top one answers Escape. */
const openPopups: HTMLElement[] = [];

export const popupSurface =
  "flex flex-col overflow-hidden rounded-xl border border-border-strong bg-popover text-popover-foreground shadow-[0px_0px_1px_2px_rgba(0,0,0,0.12),0px_4px_12px_8px_rgba(0,0,0,0.12),0px_12px_16px_0px_rgba(0,0,0,0.16)]";

export function CalendarPopup(props: CalendarPopupProps) {
  let panel!: HTMLDivElement;
  const [position, setPosition] = createSignal<{ left: number; top: number; origin: string } | null>(null);
  const [enter, setEnter] = createSignal(false);
  const [offset, setOffset] = createSignal({ x: 0, y: 0 });
  let drag: { originX: number; originY: number; pointerId: number; startX: number; startY: number } | null = null;

  const place = () => {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const anchor = props.anchor;
    let left: number;
    let top: number;

    if (!anchor) {
      left = (viewportWidth - width) / 2;
      top = viewportHeight * 0.2;
    } else if (props.placement === "right-start") {
      left = anchor.right + GUTTER;
      if (left + width > viewportWidth - VIEWPORT_PADDING) left = anchor.left - GUTTER - width;
      top = anchor.top;
    } else {
      left = props.placement === "bottom-end" ? anchor.right - width : anchor.left;
      top = anchor.bottom + GUTTER;
      if (top + height > viewportHeight - VIEWPORT_PADDING) top = anchor.top - GUTTER - height;
    }

    const placedLeft = Math.max(VIEWPORT_PADDING, Math.min(left, viewportWidth - width - VIEWPORT_PADDING));
    const placedTop = Math.max(VIEWPORT_PADDING, Math.min(top, viewportHeight - height - VIEWPORT_PADDING));
    setPosition({
      left: placedLeft,
      top: placedTop,
      origin: popupOrigin(anchor, placedLeft, placedTop, width, height),
    });
  };

  onMount(() => {
    openPopups.push(panel);
    place();
    // Show on the next frame, after the measured position is committed, so the
    // entrance plays in place instead of from the corner of the window.
    const frame = requestAnimationFrame(() => {
      setEnter(true);
      panel.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    });

    const observer = new ResizeObserver(() => place());
    observer.observe(panel);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || openPopups.at(-1) !== panel) return;
      if ((event.target as Element | null)?.closest?.("[data-calendar-keep-popup]")) return;
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (openPopups.at(-1) !== panel) return;
      const target = event.target as Element | null;
      if (target && (panel.contains(target) || target.closest("[data-calendar-keep-popup]"))) return;
      props.onClose();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", place);

    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", place);
      openPopups.splice(openPopups.indexOf(panel), 1);
    });
  });

  const onPointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Solid bubbles a press in a portal, such as a menu opened from here, up to this handler.
    // Capturing the pointer then would take the release from the menu's item, so only a press on the panel itself drags it.
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, textarea, select, label, [role=listbox]")) return;
    drag = { originX: offset().x, originY: offset().y, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
  };
  const onPointerUp: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (drag?.pointerId === event.pointerId) drag = null;
  };

  return (
    <Portal>
      <div
        ref={panel}
        role="dialog"
        aria-label={props.label}
        data-calendar-editing
        class={cn(popupSurface, "fixed z-[150]", enter() && "cal-popup", props.class)}
        style={{
          left: `${(position()?.left ?? 0) + offset().x}px`,
          top: `${(position()?.top ?? 0) + offset().y}px`,
          visibility: enter() ? "visible" : "hidden",
          "--cal-popup-origin": position()?.origin ?? "top center",
          "max-height": `calc(100dvh - ${VIEWPORT_PADDING * 2}px)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {props.children}
      </div>
    </Portal>
  );
}

export const popupHeader = "flex min-h-11 shrink-0 cursor-grab items-start justify-between gap-3 border-b border-border-strong px-3.5 py-2.5 active:cursor-grabbing";
export const popupFooter = "flex shrink-0 justify-end gap-1.5 border-t border-border-strong px-3.5 py-2.5";
export const fieldLabel = "mb-1 block text-xs text-muted-foreground";
export const fieldControlBase =
  "w-full min-w-0 rounded-md border border-(--border-input) bg-input px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:dark]";
export const fieldControl = `h-7 ${fieldControlBase}`;
