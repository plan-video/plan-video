/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assert } from "@/utils";
import * as cfg from "./config";

import type { Marquee } from "./surface";

type MousePosition = {
  state: 'idle';
  currentX: number;
  currentY: number;
} | {
  state: 'pressed' | 'pressing' | 'lifted';
  initialX: number;
  initialY: number;
  timestamp: number;
  currentX: number;
  currentY: number;
  deltaX: number;
  deltaY: number;
}

type TransformedRegion = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  passthrough: boolean;
}

type HitRegions = {
  prev: Array<TransformedRegion>;
  next: Array<TransformedRegion>;
  id: string;
  index: number;
};

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export type TimelinePointer = ReturnType<typeof createPointer>;

type PointerOptions = {
  marquee?: Marquee | null;
  canvas?: HTMLCanvasElement | null;
  ctx?: CanvasRenderingContext2D | null;
};

export function createPointer(options: PointerOptions) {
  let position: MousePosition | null = null;
  let pressRegionID: string | null = null;
  let hitRegions: HitRegions = {
    prev: [],
    next: [],
    id: '',
    index: 0,
  };
  let lastClickPosition: {
    x: number;
    y: number;
    timestamp: number;
  } | null = null;

  let shiftPressed = false;
  // Cmd on a Mac, Ctrl elsewhere: the other key that adds to a selection.
  // (Ctrl-click on a Mac is a right click.)
  let modPressed = false;

  function down(event: PointerEvent) {
    const rect = options.canvas?.getBoundingClientRect();
    if (!rect || event.button !== 0) return;

    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    position = {
      state: 'pressed',
      timestamp: performance.now(),
      initialX: currentX,
      initialY: currentY,
      currentX,
      currentY,
      deltaX: 0,
      deltaY: 0,
    };

    shiftPressed = event.shiftKey;
    modPressed = MAC ? event.metaKey : event.ctrlKey;
  }

  function move(event: PointerEvent) {
    const rect = options.canvas?.getBoundingClientRect();
    if (!rect) return;

    shiftPressed = event.shiftKey;
    modPressed = MAC ? event.metaKey : event.ctrlKey;

    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    if (!position) {
      position = {
        state: 'idle',
        currentX,
        currentY,
      };
      return;
    }

    if (position.state != 'idle') {
      position.deltaX = currentX - position.initialX;
      position.deltaY = currentY - position.initialY;
    }

    position.currentX = currentX;
    position.currentY = currentY;
  }

  function up(event: PointerEvent) {
    const rect = options.canvas?.getBoundingClientRect();
    if (!rect) return;
    if (!position || position.state === 'idle') return;

    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    position = {
      ...position,
      state: 'lifted',
      currentX,
      currentY,
      deltaX: currentX - position.initialX,
      deltaY: currentY - position.initialY,
    };
    pressRegionID = null;
    shiftPressed = event.shiftKey;
    modPressed = MAC ? event.metaKey : event.ctrlKey;
  }


  function scope(id: string) {
    hitRegions.id = id;
    hitRegions.index = 0;

    return pointer;
  }

  function region(x = 0, y = 0, w: number, h: number, id?: string, passthrough = false) {
    assert(options.ctx, 'Canvas context must be set');

    if (!position) return {
      hovering: false,
      clicked: false,
      pressing: false,
      pressed: false,
      dragging: false,
      doubleClicked: false,
      intersectsMarquee: false,
    };

    const regionData = {
      id: `${hitRegions.id}/${id ?? hitRegions.index}`,
      ...transformRegionToCanvas(options.ctx, x, y, w, h),
      passthrough,
    };

    hitRegions.index++;
    hitRegions.next.push(regionData);

    // Mouse position is in CSS pixels, scale to device pixels to match canvas coordinates
    const mouseX = position.currentX * window.devicePixelRatio;
    const mouseY = position.currentY * window.devicePixelRatio;

    const matches = hitRegions.prev.filter(({ minX, minY, maxX, maxY }) => (
      mouseX >= minX &&
      mouseX < maxX &&
      mouseY >= minY &&
      mouseY < maxY
    ));

    const lastMatch = matches.findLast(({ passthrough }) => !passthrough);

    let isPrimary = lastMatch?.id === regionData.id;
    let isPassive = matches.some(({ passthrough, id }) => passthrough && id == regionData.id);
    let hovering = isPrimary || isPassive;
    let pressing = hovering && position?.state == 'pressing';
    let pressed = hovering && position?.state == 'pressed';

    if (pressed) {
      pressRegionID = lastMatch?.id ?? null;
    }

    let dragging = false;
    if (position?.state == 'pressing' && pressRegionID == regionData.id) {
      const distance = Math.sqrt(position.deltaX ** 2 + position.deltaY ** 2);
      dragging = distance >= cfg.CLICK_DISTANCE_THRESHOLD;
    }

    let clicked = false;
    if (position?.state == 'lifted') {
      const distance = Math.sqrt(position.deltaX ** 2 + position.deltaY ** 2);
      clicked = distance < cfg.CLICK_DISTANCE_THRESHOLD && hovering;
    }

    let doubleClicked = false;
    if (clicked && lastClickPosition) {
      const delta = performance.now() - lastClickPosition.timestamp;
      const distance = Math.sqrt(
        Math.pow(position.currentX - lastClickPosition.x, 2) +
        Math.pow(position.currentY - lastClickPosition.y, 2)
      );
      doubleClicked = delta < cfg.DOUBLE_CLICK_THRESHOLD && hovering && distance < 10;
    }

    let intersectsMarquee = false;
    if (options.marquee) {
      const marqueeMinX = options.marquee.x * window.devicePixelRatio;
      const marqueeMaxX = (options.marquee.x + options.marquee.width) * window.devicePixelRatio;
      const marqueeMinY = options.marquee.y * window.devicePixelRatio;
      const marqueeMaxY = (options.marquee.y + options.marquee.height) * window.devicePixelRatio;

      intersectsMarquee = !(
        regionData.maxX < marqueeMinX ||
        regionData.minX > marqueeMaxX ||
        regionData.maxY < marqueeMinY ||
        regionData.minY > marqueeMaxY
      );
    }

    return {
      hovering,
      clicked,
      pressing,
      pressed,
      dragging,
      doubleClicked,
      intersectsMarquee,
    };
  }

  function reset() {
    hitRegions.prev = [...hitRegions.next];
    hitRegions.next.length = 0;

    if (position?.state == 'lifted') {
      position = {
        ...position,
        state: 'idle',
      };
      lastClickPosition = {
        x: position.currentX,
        y: position.currentY,
        timestamp: performance.now(),
      };
    }

    if (position?.state == 'pressed') {
      position = {
        ...position,
        state: 'pressing',
      };
    }
  }

  const pointer = {
    get position() {
      return position;
    },
    get shiftPressed() {
      return shiftPressed;
    },
    /** Whether Shift, Cmd or Ctrl is down: a press that adds to the selection rather than replacing it. */
    get extending() {
      return shiftPressed || modPressed;
    },
    down,
    move,
    up,
    scope,
    region,
    reset,
  };

  return pointer;
}

function transformRegionToCanvas(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const transform = ctx.getTransform();

  const topLeft = transform.transformPoint(new DOMPoint(x, y));
  const topRight = transform.transformPoint(new DOMPoint(x + w, y));
  const bottomLeft = transform.transformPoint(new DOMPoint(x, y + h));
  const bottomRight = transform.transformPoint(new DOMPoint(x + w, y + h));

  return {
    minX: Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    maxX: Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
    maxY: Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
  };
}
