/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useWorld } from "@plan.video/koota-solid";
import PlusIcon from "lucide-solid/icons/plus";
import XIcon from "lucide-solid/icons/x";
import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { sidebarTab } from "@/agent-chat";
import { Canvas } from "@/components/canvas";
import { Inspector, Soundboard } from "@/components/sidebar-right";
import { SidebarLeft } from "@/components/sidebar-left";
import { Layers, Timeline } from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { useLayout } from "@/context/layout";
import { zoomToFitWhenSettled } from "@/engine/camera";
import { RULER_HEIGHT } from "@/engine/timeline";
import { layoutTarget } from "@/engine/stream-layout";
import { msg, t } from "@/lib/i18n";
import { EDITOR_RAIL_WIDTH, EditorRail } from "./editor-rail";
import { ExportButton } from "./export-button";
import { SaveLayoutDialog } from "./layout-menu";
import { ProjectBar } from "./project-bar";
import { SchedulePostButton } from "./schedule-post-button";
import {
  dropTargetAt,
  movePanel,
  placeDock,
  resizeDock,
  type DockHandle,
  type DropTarget,
  type HideablePanel,
  type PanelId,
  type Rect,
} from "./dock-layout";

const PANEL_GAP = 6;
const LAYOUT_INSPECTOR_WIDTH = 360;
const MIN_LAYERS_WIDTH = 248;
const MIN_TRACKS_WIDTH = 160;
const SETTLE_MS = 200;

const DOCKED_PANELS = ["assets", "inspector", "timeline", "mixer"] as const;

const PANEL_LABELS: Record<PanelId, string> = {
  assets: msg("Assets"),
  canvas: msg("Canvas"),
  inspector: msg("Inspector"),
  timeline: msg("Timeline"),
  mixer: msg("Audio"),
};

function rectStyle(rect: Rect | undefined): JSX.CSSProperties {
  if (!rect) return { display: "none" };
  return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

export function EditorDock() {
  const layout = useLayout();
  const world = useWorld();
  let frameRef!: HTMLDivElement;
  const [frame, setFrame] = createSignal({
    width: window.innerWidth - EDITOR_RAIL_WIDTH - PANEL_GAP * 2,
    height: window.innerHeight - PANEL_GAP * 2,
  });
  const [dragging, setDragging] = createSignal<PanelId | null>(null);
  const [drop, setDrop] = createSignal<DropTarget | null>(null);
  const [settling, setSettling] = createSignal(false);

  onMount(() => {
    const measure = () => setFrame({ width: frameRef.clientWidth, height: frameRef.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frameRef);
    onCleanup(() => observer.disconnect());
  });

  // The stream layout's controls live in the inspector, so opening it brings the inspector back for as long as it's open.
  const hidden = () => layout.hiddenSections().filter((panel) => panel !== "inspector" || !layoutTarget());
  const options = () => ({
    foldedHeight: layout.timelineMinimized() ? RULER_HEIGHT : undefined,
    minWidths: layoutTarget() ? { inspector: LAYOUT_INSPECTOR_WIDTH } : undefined,
    hidden: hidden(),
  });
  const placement = createMemo(() => placeDock(layout.dock(), frame(), options()));
  const rectOf = (panel: PanelId) => placement().panels[panel];

  // Where the assets panel sits or would sit, so hiding it doesn't move the rail or the layer column.
  const assetsRect = createMemo(() => placeDock(layout.dock(), frame()).panels.assets);

  // Rides beside the panel it switches, whichever side of the window that panel was moved to.
  const railSide = () => {
    const assets = assetsRect();
    return assets && assets.x + assets.width / 2 > frame().width / 2 ? "right" : "left";
  };

  const preview = createMemo(() => {
    const panel = dragging();
    const target = drop();
    if (!panel || !target) return undefined;
    return placeDock(movePanel(layout.dock(), panel, target, frame()), frame(), options()).panels[panel];
  });

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setSettling(true);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => setSettling(false), SETTLE_MS);
  };
  onCleanup(() => clearTimeout(settleTimer));
  createEffect(on(() => !!layoutTarget(), settle, { defer: true }));

  // Anything that opens a left-panel view needs the panel it shows in.
  createEffect(on(sidebarTab, () => layout.showSection("assets"), { defer: true }));

  let tracking = false;
  let canvasBefore: Rect | undefined;
  createEffect(on(layout.customizing, (customizing, was) => {
    if (customizing) {
      canvasBefore = rectOf("canvas");
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || tracking) return;
        event.stopPropagation();
        layout.setCustomizing(false);
      };
      window.addEventListener("keydown", onKey, true);
      onCleanup(() => window.removeEventListener("keydown", onKey, true));
    } else if (was) {
      const canvas = rectOf("canvas");
      if (canvas?.width !== canvasBefore?.width || canvas?.height !== canvasBefore?.height) zoomToFitWhenSettled(world);
    }
  }));
  onCleanup(() => layout.setCustomizing(false));

  const trackPointer = (
    event: PointerEvent,
    onMove: (event: PointerEvent) => void,
    onEnd: (committed: boolean) => void,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    tracking = true;

    const finish = (committed: boolean) => {
      tracking = false;
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", handleUp);
      element.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey, true);
      onEnd(committed);
    };
    const handleUp = () => finish(true);
    const handleCancel = () => finish(false);
    const handleKey = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.stopPropagation();
      finish(false);
    };

    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", handleUp);
    element.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey, true);
  };

  const startMove = (panel: PanelId, event: PointerEvent) => {
    if (event.button !== 0) return;
    setDragging(panel);
    trackPointer(
      event,
      (move) => {
        const bounds = frameRef.getBoundingClientRect();
        const point = { x: move.clientX - bounds.left - frameRef.clientLeft, y: move.clientY - bounds.top - frameRef.clientTop };
        setDrop(dropTargetAt(placement().panels, frame(), point, panel));
      },
      (committed) => {
        const target = drop();
        setDragging(null);
        setDrop(null);
        if (!committed || !target) return;
        settle();
        layout.setDock(movePanel(layout.dock(), panel, target, frame()));
      },
    );
  };

  const startResize = (handle: DockHandle, event: PointerEvent) => {
    if (event.button !== 0) return;
    const start = handle.dir === "row" ? event.clientX : event.clientY;
    const before = layout.dock();
    trackPointer(
      event,
      (move) => {
        const now = handle.dir === "row" ? move.clientX : move.clientY;
        layout.setDock(resizeDock(before, handle, now - start));
      },
      (committed) => {
        if (!committed) layout.setDock(before);
      },
    );
  };

  const timelineWidth = () => rectOf("timeline")?.width ?? frame().width;
  // Lines up with the assets panel above it until the user sets its own width.
  const layersWidth = () => {
    const wanted = layout.layersWidth() ?? assetsRect()?.width ?? MIN_LAYERS_WIDTH;
    return Math.max(MIN_LAYERS_WIDTH, Math.min(wanted, timelineWidth() - MIN_TRACKS_WIDTH));
  };

  const startLayersResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const start = event.clientX;
    const before = layersWidth();
    const saved = layout.layersWidth();
    trackPointer(
      event,
      (move) => layout.setLayersWidth(before + move.clientX - start),
      (committed) => {
        if (!committed) layout.setLayersWidth(saved);
      },
    );
  };

  const panelBody = (id: (typeof DOCKED_PANELS)[number]) => {
    if (id === "assets") {
      return (
        <div class="flex size-full flex-col">
          <ProjectBar />
          <div class="flex min-h-0 flex-1 flex-col">
            <SidebarLeft />
          </div>
        </div>
      );
    }
    if (id === "inspector") {
      return (
        <div class="flex size-full flex-col">
          <Inspector />
        </div>
      );
    }
    if (id === "mixer") return <Soundboard />;
    return (
      <div class="grid size-full" style={{ "grid-template-columns": `${layersWidth()}px 1px minmax(0, 1fr)` }}>
        <Layers />
        <div class="relative z-20 bg-border-strong">
          <Show when={!layout.timelineMinimized()}>
            <div
              role="separator"
              aria-orientation="vertical"
              class="group absolute inset-y-0 left-1/2 w-1.5 -translate-x-1/2 cursor-ew-resize touch-none"
              onPointerDown={startLayersResize}
            >
              <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover:bg-primary group-active:bg-primary" />
            </div>
          </Show>
        </div>
        <Timeline />
      </div>
    );
  };

  const panelStyle = (panel: PanelId): JSX.CSSProperties => ({
    ...rectStyle(rectOf(panel)),
    ...(settling() ? { transition: `left ${SETTLE_MS}ms ease-out, top ${SETTLE_MS}ms ease-out, width ${SETTLE_MS}ms ease-out, height ${SETTLE_MS}ms ease-out` } : {}),
  });

  // Each panel draws only the edges that face a neighbour; the frame draws the outside, so inner lines stay single hairlines.
  const panelEdges = (panel: PanelId) => ({
    "border-l": (rectOf(panel)?.x ?? 0) > 0,
    "border-t": (rectOf(panel)?.y ?? 0) > 0,
  });

  return (
    <div
      class="flex size-full"
      classList={{ "flex-row-reverse": layout.uiVisible() && railSide() === "right" }}
      style={layout.uiVisible() ? {
        "padding-block": `${PANEL_GAP}px`,
        [railSide() === "right" ? "padding-left" : "padding-right"]: `${PANEL_GAP}px`,
      } : undefined}
    >
      <Show when={layout.uiVisible()}>
        <EditorRail side={railSide()} style={{ width: `${EDITOR_RAIL_WIDTH + PANEL_GAP}px`, "padding-inline": `${PANEL_GAP}px` }} />
      </Show>
      {/* The panels never change parent: moving one only changes its rectangle, so it never remounts, the canvas above all. */}
      <div
        ref={frameRef}
        class="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        classList={{ "rounded-lg border border-border-strong": layout.uiVisible() }}
      >
        <div
          class="isolate min-h-0 min-w-0 border-border-strong"
          classList={{ absolute: layout.uiVisible(), "size-full": !layout.uiVisible(), ...(layout.uiVisible() ? panelEdges("canvas") : {}) }}
          style={layout.uiVisible() ? panelStyle("canvas") : undefined}
        >
          <Canvas />
          <Show when={layout.uiVisible() && !rectOf("inspector")}>
            <div
              class="absolute top-2 z-20 flex items-center gap-2"
              classList={{ "right-2": layout.toolbarSlot() !== "top-right", "left-2": layout.toolbarSlot() === "top-right" }}
            >
              <ExportButton />
              <SchedulePostButton />
            </div>
          </Show>
          <Show when={layout.uiVisible() && layout.customizing()}>
            <SectionOverlay panel="canvas" onStart={startMove} />
          </Show>
        </div>
        <Show when={layout.uiVisible()}>
          <For each={DOCKED_PANELS}>
            {(panel) => (
              <div class="absolute isolate" style={panelStyle(panel)}>
                <div class="size-full min-h-0 min-w-0 overflow-hidden border-border-strong bg-background" classList={panelEdges(panel)}>
                  <Show when={rectOf(panel)}>{panelBody(panel)}</Show>
                </div>
                <Show when={layout.customizing()}>
                  <SectionOverlay panel={panel} onStart={startMove} onHide={layout.hideSection} />
                </Show>
              </div>
            )}
          </For>
          <Index each={placement().handles}>
            {(handle) => (
              <div
                role="separator"
                aria-orientation={handle().dir === "row" ? "vertical" : "horizontal"}
                class="group absolute z-10 touch-none"
                classList={{ "cursor-ew-resize": handle().dir === "row", "cursor-ns-resize": handle().dir === "col" }}
                style={rectStyle(handle().rect)}
                onPointerDown={(event) => startResize(handle(), event)}
              >
                <div
                  class="absolute transition-colors group-hover:bg-primary group-active:bg-primary"
                  classList={{
                    "inset-y-0 left-1/2 w-px -translate-x-1/2": handle().dir === "row",
                    "inset-x-0 top-1/2 h-px -translate-y-1/2": handle().dir === "col",
                  }}
                />
              </div>
            )}
          </Index>
          <Show when={layout.customizing()}>
            <CustomizeBar onDone={() => layout.setCustomizing(false)} />
          </Show>
          <Show when={preview()}>
            {(rect) => (
              <div
                class="pointer-events-none absolute z-30 grid place-items-center rounded-lg border-2 border-primary bg-primary/20"
                style={rectStyle(rect())}
              >
                <span class="rounded-md bg-primary px-2 py-1 text-[13px] font-medium text-primary-foreground">
                  {t(PANEL_LABELS[dragging()!])}
                </span>
              </div>
            )}
          </Show>
        </Show>
      </div>
      <SaveLayoutDialog />
    </div>
  );
}

function CustomizeBar(props: { onDone: () => void }) {
  const layout = useLayout();

  return (
    <div class="absolute bottom-3 left-1/2 z-40 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border-strong bg-background p-1.5 pl-3 shadow-lg">
      <span class="min-w-0 truncate text-xs text-muted-foreground">{t("Drag a section to move it, or a line to resize it")}</span>
      <For each={layout.hiddenSections()}>
        {(panel) => (
          <Button
            variant="secondary"
            class="shrink-0 gap-1 pl-1.5 pr-2.5"
            aria-label={t("Show {section}", { section: t(PANEL_LABELS[panel]) })}
            onClick={() => layout.showSection(panel)}
          >
            <PlusIcon class="size-3.5" stroke-width={2} />
            {t(PANEL_LABELS[panel])}
          </Button>
        )}
      </For>
      <Button class="shrink-0" onClick={props.onDone}>{t("Done")}</Button>
    </div>
  );
}

function SectionOverlay(props: {
  panel: PanelId;
  onStart: (panel: PanelId, event: PointerEvent) => void;
  onHide?: (panel: HideablePanel) => void;
}) {
  const label = () => t(PANEL_LABELS[props.panel]);

  return (
    <div
      data-dock-section={props.panel}
      class="absolute inset-0 z-50 grid cursor-grab touch-none select-none place-items-center border border-transparent bg-background/70 transition-colors hover:border-primary active:cursor-grabbing"
      onPointerDown={(event) => props.onStart(props.panel, event)}
    >
      <div class="flex items-center gap-1 rounded-md border border-border-strong bg-background py-1 pl-2.5 pr-1 text-[13px] font-medium text-foreground" classList={{ "pr-2.5": !props.onHide }}>
        {label()}
        <Show when={props.onHide}>
          {(hide) => (
            <button
              type="button"
              aria-label={t("Hide {section}", { section: label() })}
              class="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-ring"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => hide()(props.panel as HideablePanel)}
            >
              <XIcon class="size-3" stroke-width={2} />
            </button>
          )}
        </Show>
      </div>
    </div>
  );
}
