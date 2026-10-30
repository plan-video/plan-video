/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Frame from "lucide-solid/icons/frame";
import SquareRoundCorner from "lucide-solid/icons/square-round-corner";
import Trash from "lucide-solid/icons/trash";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { SliderInput } from "@/components/ui/slider-input";
import { Switch, SwitchControl, SwitchInput, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import {
  activeLayout,
  applyStreamLayout,
  closeStreamLayout,
  deleteLayoutCrop,
  getLayoutFrame,
  layoutCropStyles,
  layoutCrops,
  layoutSlots,
  layoutTarget,
  setLayoutCrop,
  setLayoutCropRounding,
  setLayoutCropShape,
} from "@/engine/stream-layout";
import { CROP_COLORS, CROP_LABELS, CROP_SHAPES, coverRect, cropStyle, slotRounding } from "@/lib/stream-layouts";
import { t } from "@/lib/i18n";

import type { Box, CropId, CropShape } from "@/lib/stream-layouts";
import type { JSX } from "solid-js";

/** Smallest crop, as a fraction of the source side. */
const MIN_CROP = 0.03;
const FRAME_PADDING = 32;
/** How close, in screen pixels, an edge has to come to a line to snap to it. */
const SNAP_DISTANCE = 6;
const GUIDE_COLOR = "#FF3DA5";

const [snapping, setSnapping] = createSignal(true);

type Handle = { x: -1 | 0 | 1; y: -1 | 0 | 1; cursor: string };
type Guides = { x: number[]; y: number[] };

const HANDLES: Handle[] = [
  { x: -1, y: -1, cursor: "nwse-resize" },
  { x: 0, y: -1, cursor: "ns-resize" },
  { x: 1, y: -1, cursor: "nesw-resize" },
  { x: 1, y: 0, cursor: "ew-resize" },
  { x: 1, y: 1, cursor: "nwse-resize" },
  { x: 0, y: 1, cursor: "ns-resize" },
  { x: -1, y: 1, cursor: "nesw-resize" },
  { x: -1, y: 0, cursor: "ew-resize" },
];

/**
 * The source video, whole, with one box per crop of the layout being set
 * up. Each box moves and resizes freely, and snaps to the frame's edges and
 * middle and to the other boxes unless snapping is off or Alt is held. The
 * dashed line inside a box is the part its slot shows, when the box is
 * shaped unlike the slot. The box picked last gets a toolbar: its shape,
 * its corner rounding, and delete.
 */
export function LayoutCropOverlay(): JSX.Element {
  return (
    <Show when={layoutTarget()}>
      <CropEditor />
    </Show>
  );
}

function CropEditor(): JSX.Element {
  const world = useWorld();
  const [area, setArea] = createSignal({ width: 0, height: 0 });
  const [hasFrame, setHasFrame] = createSignal(true);
  const [dragging, setDragging] = createSignal<CropId | null>(null);
  const [selected, setSelected] = createSignal<CropId | null>(null);
  const [guides, setGuides] = createSignal<Guides>({ x: [], y: [] });
  let areaRef!: HTMLDivElement;
  let canvasRef!: HTMLCanvasElement;

  const source = () => layoutTarget()?.source ?? { width: 16, height: 9 };

  const frameBox = createMemo(() => {
    const { width, height } = area();
    const available = { width: width - FRAME_PADDING * 2, height: height - FRAME_PADDING * 2 };
    if (available.width <= 0 || available.height <= 0) return { left: 0, top: 0, width: 0, height: 0 };
    const scale = Math.min(available.width / source().width, available.height / source().height);
    const w = source().width * scale;
    const h = source().height * scale;
    return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
  });

  /** For each crop, the part of it its slot shows, as fractions of the source. */
  const shown = createMemo(() => {
    const { width, height } = source();
    const out: Partial<Record<CropId, Box>> = {};
    const crops = layoutCrops();
    for (const slot of layoutSlots()) {
      const crop = crops[slot.crop];
      if (!crop || slot.blur || out[slot.crop]) continue;
      const px = { x: crop.x * width, y: crop.y * height, width: crop.width * width, height: crop.height * height };
      const part = coverRect(px, slot.box.width / slot.box.height);
      out[slot.crop] = { x: part.x / width, y: part.y / height, width: part.width / width, height: part.height / height };
    }
    return out;
  });

  /**
   * Stacking: smaller boxes sit over larger ones, so a box inside another
   * can always be picked up. Kept as z-index rather than DOM order, which
   * would move the element being dragged and drop its pointer capture.
   */
  const stack = createMemo(() => {
    const crops = layoutCrops();
    const ids = activeLayout().crops.map((spec) => spec.id).filter((id) => crops[id]);
    const area = (id: CropId) => crops[id]!.width * crops[id]!.height;
    const order = [...ids].sort((a, b) => area(b) - area(a));
    return new Map(order.map((id, index) => [id, index + 1]));
  });

  /** Each crop's corner rounding, 0–100%, as its slot in the layout has it. */
  const rounding = createMemo(() => {
    const out: Partial<Record<CropId, number>> = {};
    for (const slot of layoutSlots()) {
      if (!slot.blur && out[slot.crop] === undefined) out[slot.crop] = slotRounding(slot);
    }
    return out;
  });

  /** A crop's held shape as width over height in source fractions, or null when freeform. */
  const lockedRatio = (id: CropId): number | null => {
    const aspect = CROP_SHAPES.find((shape) => shape.id === cropStyle(layoutCropStyles(), id).shape)?.aspect;
    return aspect ? aspect / (source().width / source().height) : null;
  };

  /** Corner radius of a box on screen, in pixels. */
  const radiusPx = (id: CropId, box: Box) => {
    const { width, height } = frameBox();
    return ((rounding()[id] ?? 0) / 100) * (Math.min(box.width * width, box.height * height) / 2);
  };

  /** Lines a box can snap to on each axis: the frame's edges and middle, and every other box's. */
  const snapLines = (except: CropId): Guides => {
    const lines: Guides = { x: [0, 0.5, 1], y: [0, 0.5, 1] };
    const crops = layoutCrops();
    for (const spec of activeLayout().crops) {
      const box = crops[spec.id];
      if (spec.id === except || !box) continue;
      lines.x.push(box.x, box.x + box.width / 2, box.x + box.width);
      lines.y.push(box.y, box.y + box.height / 2, box.y + box.height);
    }
    return lines;
  };

  /** Drag a box (no handle) or one of its edges and corners. */
  const startDrag = (event: PointerEvent, id: CropId, handle: Handle | null) => {
    if (event.button !== 0) return;
    const start = layoutCrops()[id];
    const { width: fw, height: fh } = frameBox();
    if (!start || fw <= 0 || fh <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(id);
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const originX = event.clientX;
    const originY = event.clientY;
    const lines = snapLines(id);
    const reach = { x: SNAP_DISTANCE / fw, y: SNAP_DISTANCE / fh };
    setDragging(id);

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - originX) / fw;
      const dy = (moveEvent.clientY - originY) / fh;
      const snap = snapping() && !moveEvent.altKey;
      const shown: Guides = { x: [], y: [] };

      if (!handle) {
        let x = clamp(start.x + dx, 0, 1 - start.width);
        let y = clamp(start.y + dy, 0, 1 - start.height);
        if (snap) {
          const sx = nearest([x, x + start.width / 2, x + start.width], lines.x, reach.x);
          const sy = nearest([y, y + start.height / 2, y + start.height], lines.y, reach.y);
          if (sx) {
            x = clamp(x + sx.offset, 0, 1 - start.width);
            shown.x.push(sx.line);
          }
          if (sy) {
            y = clamp(y + sy.offset, 0, 1 - start.height);
            shown.y.push(sy.line);
          }
        }
        setGuides(shown);
        setLayoutCrop(id, { ...start, x, y });
        return;
      }

      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;
      const edge = (value: number, axis: "x" | "y") => {
        if (!snap) return value;
        const hit = nearest([value], lines[axis], reach[axis]);
        if (!hit) return value;
        shown[axis].push(hit.line);
        return hit.line;
      };
      if (handle.x === -1) left = clamp(edge(left + dx, "x"), 0, right - MIN_CROP);
      if (handle.x === 1) right = clamp(edge(right + dx, "x"), left + MIN_CROP, 1);
      if (handle.y === -1) top = clamp(edge(top + dy, "y"), 0, bottom - MIN_CROP);
      if (handle.y === 1) bottom = clamp(edge(bottom + dy, "y"), top + MIN_CROP, 1);
      setGuides(shown);
      const box = { x: left, y: top, width: right - left, height: bottom - top };
      const ratio = lockedRatio(id);
      setLayoutCrop(id, ratio ? keepRatio(start, box, handle, ratio) : box);
    };

    const end = () => {
      setDragging(null);
      setGuides({ x: [], y: [] });
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  onMount(() => {
    const observer = new ResizeObserver(() => setArea({ width: areaRef.clientWidth, height: areaRef.clientHeight }));
    observer.observe(areaRef);
    setArea({ width: areaRef.clientWidth, height: areaRef.clientHeight });

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const current = layoutTarget();
      if (!current) return;
      if (!current.video.isAlive() || !current.scene.isAlive()) {
        closeStreamLayout();
        return;
      }

      const box = frameBox();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(box.width * dpr);
      const height = Math.round(box.height * dpr);
      if (canvasRef.width !== width || canvasRef.height !== height) {
        canvasRef.width = width;
        canvasRef.height = height;
      }
      const ctx = canvasRef.getContext("2d");
      const frame = getLayoutFrame(world);
      setHasFrame(frame !== null);
      if (!ctx || !frame) return;
      ctx.drawImage(frame, 0, 0, width, height);
    };
    raf = requestAnimationFrame(draw);

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const picked = selected();
      if ((event.key === "Delete" || event.key === "Backspace") && picked) {
        event.preventDefault();
        deleteLayoutCrop(picked);
        setSelected(null);
      } else if (event.key === "Escape" && picked) {
        event.preventDefault();
        setSelected(null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeStreamLayout();
      } else if (event.key === "Enter") {
        event.preventDefault();
        applyStreamLayout(world);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    onCleanup(() => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  const handleLayer = () => activeLayout().crops.length + 2;

  /** The picked box, while it is still in the layout. */
  const pickedBox = () => {
    const id = selected();
    const box = id ? layoutCrops()[id] : undefined;
    return id && box && activeLayout().crops.some((spec) => spec.id === id) ? { id, box } : null;
  };

  /** Under the box, or over its label when there's no room below. */
  const toolbarPosition = (box: Box): JSX.CSSProperties => {
    const frame = frameBox();
    const below = frame.top + (box.y + box.height) * frame.height + TOOLBAR_GAP;
    const fits = below + TOOLBAR_HEIGHT <= area().height - 8;
    const y = fits ? (box.y + box.height) * frame.height + TOOLBAR_GAP : box.y * frame.height - TOOLBAR_GAP - 26 - TOOLBAR_HEIGHT;
    const x = clamp((box.x + box.width / 2) * frame.width, -frame.left + 8, frame.width + frame.left - 8);
    return { left: `${x}px`, top: `${y}px` };
  };

  return (
    <div class="absolute inset-0 z-20 flex flex-col bg-background">
      <div class="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <span class="text-[12px] font-450 text-foreground">{t(activeLayout().label)}</span>
        <Switch checked={snapping()} onChange={setSnapping} class="ml-auto flex items-center gap-2">
          <SwitchInput />
          <SwitchLabel class="cursor-pointer text-[12px] font-normal text-muted-foreground">{t("Snap")}</SwitchLabel>
          <SwitchControl variant="compact" style={{ cursor: "pointer" }}>
            <SwitchThumb variant="compact" />
          </SwitchControl>
        </Switch>
        <Button variant="secondary" onClick={() => closeStreamLayout()}>
          {t("Cancel")}
        </Button>
        <Button onClick={() => applyStreamLayout(world)}>{t("Apply layout")}</Button>
      </div>

      <div ref={areaRef} class="relative min-h-0 flex-1 overflow-hidden" onPointerDown={() => setSelected(null)}>
        <div
          class="absolute"
          style={{
            left: `${frameBox().left}px`,
            top: `${frameBox().top}px`,
            width: `${frameBox().width}px`,
            height: `${frameBox().height}px`,
          }}
        >
          <canvas ref={canvasRef} class="absolute inset-0 size-full rounded-sm bg-black" />
          <Show when={!hasFrame()}>
            <div class="absolute inset-0 grid place-items-center text-[12px] text-muted-foreground">
              {t("Move the playhead onto the video to see it.")}
            </div>
          </Show>

          <svg class="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1 1" preserveAspectRatio="none">
            <defs>
              <mask id="layout-crop-holes">
                <rect x="0" y="0" width="1" height="1" fill="white" />
                <For each={activeLayout().crops}>
                  {(spec) => {
                    const box = () => layoutCrops()[spec.id];
                    return (
                      <Show when={box()}>
                        {(b) => (
                          <rect
                            x={b().x}
                            y={b().y}
                            width={b().width}
                            height={b().height}
                            rx={radiusPx(spec.id, b()) / Math.max(frameBox().width, 1)}
                            ry={radiusPx(spec.id, b()) / Math.max(frameBox().height, 1)}
                            fill="black"
                          />
                        )}
                      </Show>
                    );
                  }}
                </For>
              </mask>
            </defs>
            <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.55)" mask="url(#layout-crop-holes)" />
          </svg>

          <For each={activeLayout().crops}>
            {(spec) => (
              <Show when={layoutCrops()[spec.id]}>
                {(box) => (
                  <CropBody
                    id={spec.id}
                    box={box()}
                    shown={shown()[spec.id]}
                    layer={stack().get(spec.id) ?? 1}
                    radius={radiusPx(spec.id, box())}
                    active={dragging() === spec.id || selected() === spec.id}
                    onPointerDown={(event) => startDrag(event, spec.id, null)}
                  />
                )}
              </Show>
            )}
          </For>

          <svg
            class="pointer-events-none absolute inset-0 size-full overflow-visible"
            style={{ "z-index": handleLayer() - 1 }}
          >
            <For each={guides().x}>
              {(x) => <line x1={`${x * 100}%`} x2={`${x * 100}%`} y1="0" y2="100%" stroke={GUIDE_COLOR} stroke-width="1" />}
            </For>
            <For each={guides().y}>
              {(y) => <line x1="0" x2="100%" y1={`${y * 100}%`} y2={`${y * 100}%`} stroke={GUIDE_COLOR} stroke-width="1" />}
            </For>
          </svg>

          {/* Labels and handles over every box, so a covered edge can still be grabbed. */}
          <div class="pointer-events-none absolute inset-0" style={{ "z-index": handleLayer() }}>
            <For each={activeLayout().crops}>
              {(spec) => (
                <Show when={layoutCrops()[spec.id]}>
                  {(box) => (
                    <CropHandles
                      id={spec.id}
                      box={box()}
                      onPointerDown={(event, handle) => startDrag(event, spec.id, handle)}
                    />
                  )}
                </Show>
              )}
            </For>
          </div>

          <Show when={!dragging() && pickedBox()}>
            {(picked) => (
              <div
                class="absolute -translate-x-1/2"
                style={{ ...toolbarPosition(picked().box), "z-index": handleLayer() + 1 }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <CropToolbar
                  id={picked().id}
                  rounding={rounding()[picked().id] ?? 0}
                  onDelete={() => {
                    deleteLayoutCrop(picked().id);
                    setSelected(null);
                  }}
                />
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

const TOOLBAR_HEIGHT = 40;
const TOOLBAR_GAP = 10;

type CropToolbarProps = {
  id: CropId;
  rounding: number;
  onDelete: () => void;
};

/** Shape, corner rounding and delete for the picked box. */
function CropToolbar(props: CropToolbarProps): JSX.Element {
  const shape = () => cropStyle(layoutCropStyles(), props.id).shape;
  const current = () => CROP_SHAPES.find((item) => item.id === shape()) ?? CROP_SHAPES[0]!;

  return (
    <div
      class="flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-[0px_4px_12px_rgba(0,0,0,0.24)]"
      style={{ height: `${TOOLBAR_HEIGHT}px` }}
    >
      <DropdownMenu placement="bottom-start">
        <DropdownMenuTrigger
          as="button"
          type="button"
          class="flex h-full whitespace-nowrap items-center gap-1.5 rounded-md px-2 text-[12px] font-450 text-foreground hover:bg-input data-[expanded]:bg-input"
          style={{ cursor: "pointer" }}
        >
          <ShapeGlyph shape={current().id} />
          {t(current().label)}
          <ChevronDown class="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="min-w-48 gap-0 p-1">
            <For each={CROP_SHAPES}>
              {(item) => (
                <DropdownMenuItem tone="neutral" class="h-8 gap-2.5" onSelect={() => setLayoutCropShape(props.id, item.id)}>
                  <ShapeGlyph shape={item.id} />
                  <span class="flex-1">{t(item.label)}</span>
                  <Show when={item.id === shape()}>
                    <Check class="size-4 text-primary" />
                  </Show>
                </DropdownMenuItem>
              )}
            </For>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>

      <span class="h-5 w-px bg-border" />

      <Popover placement="bottom">
        <PopoverTrigger
          class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-input hover:text-foreground data-[expanded]:bg-input data-[expanded]:text-foreground"
          style={{ cursor: "pointer" }}
          aria-label={t("Corner rounding")}
          title={t("Corner rounding")}
        >
          <SquareRoundCorner class="size-4" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent class="flex w-64 flex-col gap-3 rounded-lg p-3">
            <span class="text-[12px] font-450 text-foreground">{t("Corner rounding")}</span>
            <SliderInput
              value={Math.round(props.rounding)}
              min={0}
              max={100}
              onChange={(next) => setLayoutCropRounding(props.id, next)}
              format={(next) => `${next}%`}
            />
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <span class="h-5 w-px bg-border" />

      <button
        type="button"
        class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-input hover:text-foreground"
        style={{ cursor: "pointer" }}
        aria-label={t("Delete")}
        title={t("Delete")}
        onClick={() => props.onDelete()}
      >
        <Trash class="size-4" />
      </button>
    </div>
  );
}

/** A small picture of a shape: the frame mark for freeform, else the shape filled at its aspect. */
function ShapeGlyph(props: { shape: CropShape }): JSX.Element {
  const size = () => {
    switch (props.shape) {
      case "fullscreen":
        return { width: 9, height: 15, radius: "2px" };
      case "wide":
        return { width: 15, height: 9, radius: "2px" };
      case "classic":
        return { width: 14, height: 11, radius: "2px" };
      case "circle":
        return { width: 14, height: 14, radius: "50%" };
      default:
        return { width: 14, height: 14, radius: "2px" };
    }
  };

  return (
    <span class="grid size-4 shrink-0 place-items-center text-muted-foreground">
      <Show when={props.shape !== "freeform"} fallback={<Frame class="size-4" />}>
        <span
          class="border border-current bg-current/40"
          style={{ width: `${size().width}px`, height: `${size().height}px`, "border-radius": size().radius }}
        />
      </Show>
    </span>
  );
}

type CropBodyProps = {
  id: CropId;
  box: Box;
  shown: Box | undefined;
  layer: number;
  radius: number;
  active: boolean;
  onPointerDown: (event: PointerEvent) => void;
};

function CropBody(props: CropBodyProps): JSX.Element {
  const color = () => CROP_COLORS[props.id];

  const trimmed = () => {
    const shown = props.shown;
    if (!shown) return null;
    const box = props.box;
    const same = Math.abs(shown.width - box.width) < 0.002 && Math.abs(shown.height - box.height) < 0.002;
    if (same || box.width <= 0 || box.height <= 0) return null;
    return {
      left: `${((shown.x - box.x) / box.width) * 100}%`,
      top: `${((shown.y - box.y) / box.height) * 100}%`,
      width: `${(shown.width / box.width) * 100}%`,
      height: `${(shown.height / box.height) * 100}%`,
    };
  };

  return (
    <div
      class="absolute touch-none"
      style={{
        ...boxStyle(props.box),
        "z-index": props.layer,
        "border-radius": `${props.radius}px`,
        "box-shadow": `inset 0 0 0 ${props.active ? 3 : 2}px ${color()}`,
        cursor: "move",
      }}
      onPointerDown={(event) => props.onPointerDown(event)}
    >
      <Show when={trimmed()}>
        {(style) => (
          <div
            class="pointer-events-none absolute border border-dashed"
            style={{ ...style(), "border-color": color() }}
          />
        )}
      </Show>
    </div>
  );
}

type CropHandlesProps = {
  id: CropId;
  box: Box;
  onPointerDown: (event: PointerEvent, handle: Handle) => void;
};

function CropHandles(props: CropHandlesProps): JSX.Element {
  const color = () => CROP_COLORS[props.id];

  return (
    <div class="absolute" style={boxStyle(props.box)}>
      <div
        class="absolute left-1/2 top-0 flex h-5 -translate-x-1/2 -translate-y-[calc(100%+6px)] items-center whitespace-nowrap rounded-sm px-1.5 text-[11px] font-450 text-white"
        style={{ "background-color": color() }}
      >
        {t(CROP_LABELS[props.id])}
      </div>
      <For each={HANDLES}>
        {(handle) => (
          <div
            class="pointer-events-auto absolute size-2.5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-[2px] border bg-white"
            style={{
              left: `${((handle.x + 1) / 2) * 100}%`,
              top: `${((handle.y + 1) / 2) * 100}%`,
              "border-color": color(),
              cursor: handle.cursor,
            }}
            onPointerDown={(event) => props.onPointerDown(event, handle)}
          />
        )}
      </For>
    </div>
  );
}

function boxStyle(box: Box): JSX.CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

/**
 * A resized box held to `ratio` (width over height, in source fractions).
 * The side or corner opposite the handle stays put; an edge handle keeps the
 * box centred across it. The box shrinks to stay inside the source.
 */
function keepRatio(start: Box, box: Box, handle: Handle, ratio: number): Box {
  let width = box.width;
  let height = box.height;
  if (handle.x && handle.y) {
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
  } else if (handle.x) {
    height = width / ratio;
  } else {
    width = height * ratio;
  }

  const anchor = (from: number, size: number, side: number) => (side === 1 ? from : side === -1 ? from + size : from + size / 2);
  const ax = anchor(start.x, start.width, handle.x);
  const ay = anchor(start.y, start.height, handle.y);
  const room = (at: number, side: number) => (side === 1 ? 1 - at : side === -1 ? at : 2 * Math.min(at, 1 - at));
  const grow = Math.max(1, MIN_CROP / width, MIN_CROP / height);
  width *= grow;
  height *= grow;
  const fit = Math.min(1, room(ax, handle.x) / width, room(ay, handle.y) / height);
  width *= fit;
  height *= fit;

  const place = (at: number, size: number, side: number) => (side === 1 ? at : side === -1 ? at - size : at - size / 2);
  return { x: place(ax, width, handle.x), y: place(ay, height, handle.y), width, height };
}

/** The line closest to any of `edges` within `reach`, and how far to move to meet it. */
function nearest(edges: number[], lines: number[], reach: number): { line: number; offset: number } | null {
  let best: { line: number; offset: number } | null = null;
  for (const edge of edges) {
    for (const line of lines) {
      const offset = line - edge;
      if (Math.abs(offset) > reach) continue;
      if (!best || Math.abs(offset) < Math.abs(best.offset)) best = { line, offset };
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isEditable(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return target.type !== "checkbox";
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}
