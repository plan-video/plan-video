/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK,
  LAYOUT_PRESET_IDS,
  PANEL_IDS,
  dropTargetAt,
  movePanel,
  placeDock,
  presetLayout,
  readDock,
  readHidden,
  readSavedLayouts,
  resizeDock,
  withSavedLayout,
  type LayoutSnapshot,
  type DockNode,
  type DockSide,
  type PanelId,
  type Rect,
  type Size,
} from "./dock-layout";

const FRAME: Size = { width: 1600, height: 900 };
const SIDES: DockSide[] = ["left", "right", "top", "bottom", "center"];

function rectsOf(dock: DockNode, frame: Size = FRAME): Record<PanelId, Rect> {
  return placeDock(dock, frame).panels as Record<PanelId, Rect>;
}

function expectTiled(panels: Partial<Record<PanelId, Rect>>, frame: Size, count: number = PANEL_IDS.length) {
  const rects = Object.values(panels);
  expect(rects).toHaveLength(count);
  const area = rects.reduce((total, rect) => total + rect.width * rect.height, 0);
  expect(area).toBe(frame.width * frame.height);
  for (const rect of rects) {
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(frame.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(frame.height);
    for (const other of rects) {
      if (other === rect) continue;
      const apart = rect.x + rect.width <= other.x || other.x + other.width <= rect.x
        || rect.y + rect.height <= other.y || other.y + other.height <= rect.y;
      expect(apart).toBe(true);
    }
  }
}

describe("placeDock", () => {
  it("gives the canvas whatever the fixed panels leave", () => {
    const wide = rectsOf(DEFAULT_DOCK);
    expect(wide.assets.width).toBe(264);
    expect(wide.inspector.width).toBe(308);
    expect(wide.timeline.height).toBe(234);
    expect(wide.canvas.width).toBe(1600 - 264 - 308);

    const narrow = rectsOf(DEFAULT_DOCK, { width: 1200, height: 900 });
    expect(narrow.assets.width).toBe(264);
    expect(narrow.canvas.width).toBe(1200 - 264 - 308);
  });

  it("shrinks the fixed panels only once the canvas reaches its minimum", () => {
    const panels = rectsOf(DEFAULT_DOCK, { width: 850, height: 900 });
    expect(panels.canvas.width).toBe(320);
    expect(panels.assets.width).toBeLessThan(264);
    expect(panels.assets.width).toBeGreaterThanOrEqual(200);
    expectTiled(panels, { width: 850, height: 900 });
  });

  it("still tiles the frame when it is smaller than every minimum", () => {
    const frame = { width: 300, height: 200 };
    expectTiled(placeDock(DEFAULT_DOCK, frame).panels, frame);
  });

  it("collapses the timeline to its ruler and steps the mixer out", () => {
    const { panels, handles } = placeDock(DEFAULT_DOCK, FRAME, { foldedHeight: 40 });
    expect(panels.timeline).toEqual({ x: 0, y: 860, width: 1600, height: 40 });
    expect(panels.mixer).toBeUndefined();
    expect(panels.canvas!.height).toBe(860);
    expect(handles.filter((handle) => handle.dir === "col")).toHaveLength(0);
    expectTiled(panels, FRAME, 4);
  });

  it("collapses a timeline that sits alone in a column, keeping the mixer", () => {
    const dock = movePanel(DEFAULT_DOCK, "mixer", { panel: "assets", side: "bottom" }, FRAME);
    const { panels } = placeDock(dock, FRAME, { foldedHeight: 40 });
    expect(panels.timeline!.height).toBe(40);
    expect(panels.mixer).toBeDefined();
    expectTiled(panels, FRAME);
  });

  it("leaves the timeline open when collapsing it would crush the panels beside it", () => {
    const dock = movePanel(DEFAULT_DOCK, "timeline", { panel: "canvas", side: "left" }, FRAME);
    const { panels } = placeDock(dock, FRAME, { foldedHeight: 40 });
    expect(panels.canvas!.height).toBe(panels.timeline!.height);
    expect(panels.timeline!.height).toBeGreaterThan(40);
    expectTiled(panels, FRAME);
  });

  it("widens a panel to a required width and hands the room back afterwards", () => {
    expect(placeDock(DEFAULT_DOCK, FRAME, { minWidths: { inspector: 360 } }).panels.inspector!.width).toBe(360);
    expect(rectsOf(DEFAULT_DOCK).inspector.width).toBe(308);
  });
});

describe("resizeDock", () => {
  const handleBetween = (dock: DockNode, a: PanelId, b: PanelId) => {
    const { handles, panels } = placeDock(dock, FRAME);
    const edge = panels[a]!.x + panels[a]!.width;
    const handle = handles.find((h) => h.dir === "row" && Math.abs(h.rect.x + h.rect.width / 2 - edge) < 1
      && h.rect.y === panels[a]!.y && panels[b]!.x === edge);
    if (!handle) throw new Error(`no handle between ${a} and ${b}`);
    return handle;
  };

  it("moves the shared edge and leaves the other panels alone", () => {
    const next = resizeDock(DEFAULT_DOCK, handleBetween(DEFAULT_DOCK, "assets", "canvas"), 100);
    const panels = rectsOf(next);
    expect(panels.assets.width).toBe(364);
    expect(panels.canvas.x).toBe(364);
    expect(panels.inspector.width).toBe(308);
  });

  it("stops at both panels' minimum sizes", () => {
    const handle = handleBetween(DEFAULT_DOCK, "assets", "canvas");
    expect(rectsOf(resizeDock(DEFAULT_DOCK, handle, -9999)).assets.width).toBe(200);
    expect(rectsOf(resizeDock(DEFAULT_DOCK, handle, 9999)).canvas.width).toBe(320);
  });

  it("keeps the shared width when both panels hold a fixed size", () => {
    const dock = movePanel(DEFAULT_DOCK, "inspector", { panel: "canvas", side: "left" }, FRAME);
    const panels = rectsOf(resizeDock(dock, handleBetween(dock, "assets", "inspector"), 9999));
    expect(panels.inspector.width).toBe(260);
    expect(panels.assets.width).toBe(264 + 308 - 260);
    expect(panels.canvas.width).toBe(rectsOf(dock).canvas.width);
  });

  it("resizes the timeline row from the handle above it", () => {
    const { handles } = placeDock(DEFAULT_DOCK, FRAME);
    const handle = handles.find((h) => h.dir === "col")!;
    expect(rectsOf(resizeDock(DEFAULT_DOCK, handle, -100)).timeline.height).toBe(334);
    expect(rectsOf(resizeDock(DEFAULT_DOCK, handle, 9999)).timeline.height).toBe(120);
    expect(rectsOf(resizeDock(DEFAULT_DOCK, handle, -9999)).canvas.height).toBe(200);
  });
});

describe("movePanel", () => {
  it("keeps every panel exactly once and tiles the frame after any move", () => {
    for (const panel of PANEL_IDS) {
      for (const target of [...PANEL_IDS, null]) {
        for (const side of SIDES) {
          const next = movePanel(DEFAULT_DOCK, panel, { panel: target, side }, FRAME);
          expect(readDock(next)).toBe(next);
          expectTiled(placeDock(next, FRAME).panels, FRAME);
        }
      }
    }
  });

  it("keeps tiling across a chain of moves", () => {
    let dock = DEFAULT_DOCK;
    const steps = PANEL_IDS.flatMap((panel, i) => SIDES.map((side, j) => ({
      panel,
      target: PANEL_IDS[(i + j + 1) % PANEL_IDS.length]!,
      side,
    })));
    for (const { panel, target, side } of steps) {
      dock = movePanel(dock, panel, { panel: target, side }, FRAME);
      expect(readDock(dock)).toBe(dock);
      expectTiled(placeDock(dock, FRAME).panels, FRAME);
    }
  });

  it("swaps two sidebars when dropped in the middle, each keeping its width", () => {
    const panels = rectsOf(movePanel(DEFAULT_DOCK, "assets", { panel: "inspector", side: "center" }, FRAME));
    expect(panels.inspector).toMatchObject({ x: 0, width: 308 });
    expect(panels.assets).toMatchObject({ x: 1600 - 264, width: 264 });
  });

  it("keeps the canvas big when it swaps with the timeline", () => {
    const panels = rectsOf(movePanel(DEFAULT_DOCK, "timeline", { panel: "canvas", side: "center" }, FRAME));
    expect(panels.timeline).toMatchObject({ y: 0, height: 234 });
    expect(panels.canvas).toMatchObject({ y: 234, height: 900 - 234 });
  });

  it("puts a panel beside its target, taking the room from that target", () => {
    const panels = rectsOf(movePanel(DEFAULT_DOCK, "inspector", { panel: "canvas", side: "left" }, FRAME));
    expect(panels.assets).toMatchObject({ x: 0, width: 264 });
    expect(panels.inspector).toMatchObject({ x: 264, width: 308 });
    expect(panels.canvas).toMatchObject({ x: 264 + 308, width: 1600 - 264 - 308 });
  });

  it("stacks a panel over its target when dropped on the top edge", () => {
    const panels = rectsOf(movePanel(DEFAULT_DOCK, "mixer", { panel: "inspector", side: "top" }, FRAME));
    expect(panels.mixer).toMatchObject({ x: 1600 - 308, y: 0, width: 308 });
    expect(panels.inspector.y).toBe(panels.mixer.height);
    expect(panels.timeline.width).toBe(1600);
  });

  it("spans a panel along the whole frame edge", () => {
    const panels = rectsOf(movePanel(DEFAULT_DOCK, "inspector", { panel: null, side: "right" }, FRAME));
    expect(panels.inspector).toEqual({ x: 1600 - 308, y: 0, width: 308, height: 900 });
    expect(panels.mixer.x + panels.mixer.width).toBe(1600 - 308);
  });

  it("lets the panel left behind fill the gap", () => {
    const panels = rectsOf(movePanel(DEFAULT_DOCK, "mixer", { panel: null, side: "left" }, FRAME));
    expect(panels.timeline.x).toBe(panels.mixer.width);
    expect(panels.timeline.width).toBe(1600 - panels.mixer.width);
  });

  it("does not touch the layout when dropped on itself", () => {
    expect(movePanel(DEFAULT_DOCK, "canvas", { panel: "canvas", side: "left" }, FRAME)).toBe(DEFAULT_DOCK);
  });

  it("stays out of the saved sizes of a collapsed timeline", () => {
    const moved = movePanel(DEFAULT_DOCK, "assets", { panel: "inspector", side: "center" }, FRAME);
    expect(placeDock(moved, FRAME).panels.timeline!.height).toBe(234);
  });
});

describe("dropTargetAt", () => {
  const panels = rectsOf(DEFAULT_DOCK);

  it("reads the frame's outer edge as a whole-side drop", () => {
    expect(dropTargetAt(panels, FRAME, { x: 4, y: 300 }, "inspector")).toEqual({ panel: null, side: "left" });
    expect(dropTargetAt(panels, FRAME, { x: 2000, y: 300 }, "assets")).toEqual({ panel: null, side: "right" });
  });

  it("reads a panel's edges as beside it and its middle as a swap", () => {
    const { canvas } = panels;
    const at = (fx: number, fy: number) => ({ x: canvas.x + canvas.width * fx, y: canvas.y + canvas.height * fy });
    expect(dropTargetAt(panels, FRAME, at(0.1, 0.5), "assets")).toEqual({ panel: "canvas", side: "left" });
    expect(dropTargetAt(panels, FRAME, at(0.5, 0.9), "assets")).toEqual({ panel: "canvas", side: "bottom" });
    expect(dropTargetAt(panels, FRAME, at(0.5, 0.5), "assets")).toEqual({ panel: "canvas", side: "center" });
  });

  it("offers nothing over the panel being dragged", () => {
    expect(dropTargetAt(panels, FRAME, { x: 100, y: 200 }, "assets")).toBeNull();
  });
});

describe("readDock", () => {
  const leaves = (names: string[]) => names.map((panel) => ({ panel, size: 100 }));

  it("keeps a saved layout that holds every panel once", () => {
    const saved = { dir: "row", size: 0, children: leaves([...PANEL_IDS]) };
    expect(readDock(saved)).toBe(saved);
  });

  it.each([
    ["nothing", null],
    ["an old format", { timelineHeight: 200 }],
    ["a missing panel", { dir: "row", size: 0, children: leaves(["assets", "canvas", "inspector", "timeline"]) }],
    ["a repeated panel", { dir: "row", size: 0, children: leaves(["assets", "canvas", "inspector", "timeline", "mixer", "mixer"]) }],
    ["an unknown panel", { dir: "row", size: 0, children: leaves(["assets", "canvas", "inspector", "timeline", "mixer", "chat"]) }],
    ["a broken size", { dir: "row", size: 0, children: [...leaves(["assets", "canvas", "inspector", "timeline"]), { panel: "mixer", size: "wide" }] }],
    ["a negative size", { dir: "row", size: 0, children: [...leaves(["assets", "canvas", "inspector", "timeline"]), { panel: "mixer", size: -5 }] }],
    ["an unknown direction", { dir: "diagonal", size: 0, children: leaves([...PANEL_IDS]) }],
    ["a split of one", { dir: "row", size: 0, children: [{ dir: "col", size: 0, children: leaves([...PANEL_IDS]) }] }],
  ])("falls back to the default for %s", (_name, saved) => {
    expect(readDock(saved)).toBe(DEFAULT_DOCK);
  });
});

describe("presetLayout", () => {
  it.each([...LAYOUT_PRESET_IDS])("%s holds every panel and tiles any window", (id) => {
    for (const frame of [FRAME, { width: 2500, height: 1380 }, { width: 960, height: 600 }]) {
      const { dock } = presetLayout(id, frame);
      expect(readDock(dock)).toBe(dock);
      expectTiled(placeDock(dock, frame).panels, frame);
    }
  });

  it("gives the timeline most of the height in timeline focus, on any screen", () => {
    for (const frame of [FRAME, { width: 2500, height: 1380 }]) {
      const panels = rectsOf(presetLayout("timeline", frame).dock, frame);
      expect(panels.timeline.height).toBeGreaterThan(panels.canvas.height);
    }
  });

  it("leaves the canvas more room in canvas focus than the default", () => {
    const panels = rectsOf(presetLayout("canvas", FRAME).dock);
    const standard = rectsOf(DEFAULT_DOCK);
    expect(panels.canvas.width).toBeGreaterThan(standard.canvas.width);
    expect(panels.canvas.height).toBeGreaterThan(standard.canvas.height);
  });

  it("runs both sidebars the full height in tall sidebars, and still collapses the timeline", () => {
    const { dock } = presetLayout("sidebars", FRAME);
    const panels = rectsOf(dock);
    expect(panels.assets.height).toBe(900);
    expect(panels.inspector.height + panels.mixer.height).toBe(900);
    expect(panels.mixer.height).toBe(234);
    expect(panels.inspector.height).toBe(900 - 234);
    expect(placeDock(dock, FRAME, { foldedHeight: 40 }).panels.timeline!.height).toBe(40);
  });
});

describe("saved layouts", () => {
  const snapshot: LayoutSnapshot = { dock: DEFAULT_DOCK, layersWidth: 300, toolbarSlot: "top", hidden: ["mixer"] };
  const other: LayoutSnapshot = { dock: presetLayout("sidebars", FRAME).dock, layersWidth: null, toolbarSlot: "bottom", hidden: [] };

  it("adds a new name and tidies its spaces", () => {
    const { layouts, id } = withSavedLayout([], "  Reels  ", snapshot, "a");
    expect(id).toBe("a");
    expect(layouts).toEqual([{ ...snapshot, id: "a", name: "Reels" }]);
  });

  it("updates a layout saved under the same name, whatever its case, in its place", () => {
    const first = withSavedLayout([], "Reels", snapshot, "a").layouts;
    const two = withSavedLayout(first, "Long videos", snapshot, "b").layouts;
    const { layouts, id } = withSavedLayout(two, "reels", other, "c");
    expect(id).toBe("a");
    expect(layouts.map((layout) => layout.name)).toEqual(["reels", "Long videos"]);
    expect(layouts[0]!.dock).toBe(other.dock);
  });

  it("keeps the good layouts when one saved entry is broken", () => {
    const good = { ...snapshot, id: "a", name: "Reels" };
    const saved = [
      good,
      null,
      { ...snapshot, id: "b" },
      { ...snapshot, id: "c", name: "   " },
      { ...snapshot, name: "No id" },
      { ...good, name: "Same id" },
      { ...snapshot, id: "d", name: "Broken", dock: { dir: "row", size: 0, children: [] } },
    ];
    expect(readSavedLayouts(saved)).toEqual([good]);
    expect(readSavedLayouts("nope")).toEqual([]);
  });

  it("fills in what an older saved layout lacks", () => {
    const [layout] = readSavedLayouts([{ id: "a", name: "Reels", dock: DEFAULT_DOCK, layersWidth: "wide" }]);
    expect(layout).toMatchObject({ layersWidth: null, toolbarSlot: "bottom", hidden: [] });
  });
});

describe("hidden sections", () => {
  it("gives a hidden section's room to the canvas and keeps the others in place", () => {
    const { panels, handles } = placeDock(DEFAULT_DOCK, FRAME, { hidden: ["inspector"] });
    expect(panels.inspector).toBeUndefined();
    expect(panels.assets!.width).toBe(264);
    expect(panels.canvas!.width).toBe(1600 - 264);
    expect(handles.filter((handle) => handle.dir === "row" && handle.rect.y === 0)).toHaveLength(1);
    expectTiled(panels, FRAME, 4);
  });

  it("lets the mixer take the whole row when the timeline beside it is hidden", () => {
    const { panels } = placeDock(DEFAULT_DOCK, FRAME, { hidden: ["timeline"] });
    expect(panels.mixer).toMatchObject({ x: 0, width: 1600, height: 234 });
    expectTiled(panels, FRAME, 4);
  });

  it("drops a row with everything in it hidden, and its handle", () => {
    const { panels, handles } = placeDock(DEFAULT_DOCK, FRAME, { hidden: ["timeline", "mixer"] });
    expect(panels.canvas!.height).toBe(900);
    expect(handles.filter((handle) => handle.dir === "col")).toHaveLength(0);
    expectTiled(panels, FRAME, 3);
  });

  it("leaves only the canvas when everything else is hidden", () => {
    const { panels, handles } = placeDock(DEFAULT_DOCK, FRAME, { hidden: ["assets", "inspector", "timeline", "mixer"] });
    expect(panels.canvas).toEqual({ x: 0, y: 0, ...FRAME });
    expect(handles).toHaveLength(0);
  });

  it("does not collapse a hidden timeline's row onto the mixer", () => {
    const { panels } = placeDock(DEFAULT_DOCK, FRAME, { hidden: ["timeline"], foldedHeight: 40 });
    expect(panels.mixer!.height).toBe(234);
  });

  it("brings a section back at the size and place it had", () => {
    const hiddenThenShown = rectsOf(placeDock(DEFAULT_DOCK, FRAME, { hidden: ["assets"] }).baked);
    expect(hiddenThenShown).toEqual(rectsOf(DEFAULT_DOCK));
  });

  it("keeps sections hidden while others move, and tiles the frame", () => {
    const dock = movePanel(DEFAULT_DOCK, "assets", { panel: "canvas", side: "right" }, FRAME);
    expectTiled(placeDock(dock, FRAME, { hidden: ["mixer"] }).panels, FRAME, 4);
  });

  it("reads saved hidden sections, never the canvas or anything unknown", () => {
    expect(readHidden(["mixer", "canvas", "chat", "mixer", 4])).toEqual(["mixer"]);
    expect(readHidden("mixer")).toEqual([]);
  });
});
