/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cx } from "@/lib/cva";

export type ColorWheelProps = {
  /** Degrees, counterclockwise from red at the right. */
  hue: number;
  /** How far from the middle, 0..100. */
  amount: number;
  onChange(hue: number, amount: number): void;
  /** A double-click puts the puck back in the middle. */
  onReset?(): void;
  label: string;
  class?: string;
};

const round = (value: number) => Math.round(value);

export function ColorWheel(props: ColorWheelProps) {
  let wheel!: HTMLDivElement;

  const pick = (event: PointerEvent) => {
    const rect = wheel.getBoundingClientRect();
    const radius = rect.width / 2;
    const x = event.clientX - rect.left - radius;
    const y = rect.top + radius - event.clientY;
    const hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    const amount = Math.min(100, (Math.hypot(x, y) / radius) * 100);
    props.onChange(round(hue), round(amount));
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    wheel.focus();
    wheel.setPointerCapture(event.pointerId);
    pick(event);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (wheel.hasPointerCapture(event.pointerId)) pick(event);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    let hue = props.hue;
    let amount = props.amount;
    if (event.key === "ArrowLeft") hue = (hue + step) % 360;
    else if (event.key === "ArrowRight") hue = (hue - step + 360) % 360;
    else if (event.key === "ArrowUp") amount = Math.min(100, amount + step);
    else if (event.key === "ArrowDown") amount = Math.max(0, amount - step);
    else return;
    event.preventDefault();
    props.onChange(hue, amount);
  };

  const puck = () => {
    const radians = (props.hue * Math.PI) / 180;
    const distance = Math.min(100, Math.max(0, props.amount)) / 2;
    return {
      left: `${50 + Math.cos(radians) * distance}%`,
      top: `${50 - Math.sin(radians) * distance}%`,
    };
  };

  return (
    <div
      ref={wheel}
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuetext={`${round(props.hue)}°, ${round(props.amount)}%`}
      class={cx("relative aspect-square touch-none rounded-full outline-none focus-ring cursor-crosshair", props.class)}
      style={{
        // Hues counterclockwise from red at the right, fading to grey in the middle.
        background:
          "radial-gradient(circle closest-side, rgb(128 128 128) 0%, rgb(128 128 128 / 0) 100%), conic-gradient(from 90deg, #f55, #f5f, #55f, #5ff, #5f5, #ff5, #f55)",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDblClick={() => props.onReset?.()}
      onKeyDown={handleKeyDown}
    >
      <span class="pointer-events-none absolute inset-0 rounded-full inset-ring-1 inset-ring-white/10" />
      <span class="pointer-events-none absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/30" />
      <span
        class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
        style={puck()}
      />
    </div>
  );
}
