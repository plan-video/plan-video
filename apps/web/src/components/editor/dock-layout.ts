/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const PANEL_IDS = ["assets", "canvas", "inspector", "timeline", "mixer"] as const;
/** The canvas always stays: it is what the editor is for. */
export const HIDEABLE_PANELS = ["assets", "inspector", "timeline", "mixer"] as const;

export type PanelId = (typeof PANEL_IDS)[number];
export type HideablePanel = (typeof HIDEABLE_PANELS)[number];
export type DockDir = "row" | "col";
export type DockLeaf = { panel: PanelId; size: number };
export type DockSplit = { dir: DockDir; size: number; children: DockNode[] };
/** `size` is in pixels along the parent's direction: width in a row, height in a column. */
export type DockNode = DockLeaf | DockSplit;

export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };
export type DockSide = "left" | "right" | "top" | "bottom" | "center";
/** `panel: null` is the frame itself, so a panel can span its whole edge. */
export type DropTarget = { panel: PanelId | null; side: DockSide };

export type DockHandle = {
  path: number[];
  a: number;
  b: number;
  dir: DockDir;
  rect: Rect;
  aSize: number;
  bSize: number;
  aMin: number;
  bMin: number;
};

export type DockPlacement = {
  panels: Partial<Record<PanelId, Rect>>;
  handles: DockHandle[];
  baked: DockNode;
};

export type PlaceOptions = {
  /** The timeline's height while it is collapsed. */
  foldedHeight?: number;
  minWidths?: Partial<Record<PanelId, number>>;
  hidden?: readonly PanelId[];
};

const HANDLE_THICKNESS = 6;
const FRAME_EDGE = 16;
const EDGE_ZONE = 0.3;

const MIN_SIZES: Record<PanelId, Size> = {
  assets: { width: 200, height: 160 },
  canvas: { width: 320, height: 200 },
  inspector: { width: 260, height: 160 },
  timeline: { width: 420, height: 120 },
  mixer: { width: 280, height: 120 },
};

const PREFERRED_SIZES: Record<PanelId, Size> = {
  assets: { width: 264, height: 320 },
  canvas: { width: 640, height: 400 },
  inspector: { width: 308, height: 320 },
  timeline: { width: 800, height: 234 },
  mixer: { width: 308, height: 234 },
};

export const DEFAULT_DOCK: DockNode = {
  dir: "col",
  size: 0,
  children: [
    {
      dir: "row",
      size: 0,
      children: [
        { panel: "assets", size: 264 },
        { panel: "canvas", size: 0 },
        { panel: "inspector", size: 308 },
      ],
    },
    {
      dir: "row",
      size: 234,
      children: [
        { panel: "timeline", size: 0 },
        { panel: "mixer", size: 308 },
      ],
    },
  ],
};

const isLeaf = (node: DockNode): node is DockLeaf => "panel" in node;
const lengthOf = (dir: DockDir): keyof Size => (dir === "row" ? "width" : "height");
const axisOf = (side: DockSide): DockDir => (side === "left" || side === "right" ? "row" : "col");
const comesFirst = (side: DockSide): boolean => side === "left" || side === "top";
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const contains = (node: DockNode, panel: PanelId): boolean =>
  isLeaf(node) ? node.panel === panel : node.children.some((child) => contains(child, panel));

const isTimelineRow = (node: DockNode): node is DockSplit =>
  !isLeaf(node) && node.dir === "row" && node.children.length === 2
  && node.children.every((child) => isLeaf(child) && (child.panel === "timeline" || child.panel === "mixer"));

const foldsToRuler = (node: DockNode): boolean =>
  isLeaf(node) ? node.panel === "timeline" : isTimelineRow(node);

const isShown = (node: DockNode, options: PlaceOptions): boolean =>
  isLeaf(node) ? !options.hidden?.includes(node.panel) : node.children.some((child) => isShown(child, options));

// A collapsed timeline only has room for itself, so the mixer beside it steps out until it opens again.
function visibleChildren(split: DockSplit, options: PlaceOptions): { node: DockNode; index: number }[] {
  const shown = split.children.map((node, index) => ({ node, index })).filter(({ node }) => isShown(node, options));
  if (options.foldedHeight === undefined || !isTimelineRow(split)) return shown;
  return shown.filter(({ node }) => !(isLeaf(node) && node.panel === "mixer"));
}

const isFixed = (split: DockSplit, node: DockNode, options: PlaceOptions): boolean =>
  options.foldedHeight !== undefined && split.dir === "col" && foldsToRuler(node);

// One child in every split takes what the others leave, so a window resize goes to the section that uses it best.
const FLEX_ORDER: PanelId[] = ["canvas", "timeline", "inspector", "assets"];

function flexIndex(children: DockNode[], fixed: (node: DockNode) => boolean = () => false): number {
  for (const panel of FLEX_ORDER) {
    const index = children.findIndex((node) => contains(node, panel) && !fixed(node));
    if (index >= 0) return index;
  }
  for (let i = children.length - 1; i >= 0; i--) if (!fixed(children[i]!)) return i;
  return children.length - 1;
}

function minExtent(node: DockNode, length: keyof Size, options: PlaceOptions): number {
  if (isLeaf(node)) {
    if (length === "width") return Math.max(MIN_SIZES[node.panel].width, options.minWidths?.[node.panel] ?? 0);
    return MIN_SIZES[node.panel].height;
  }
  const extents = visibleChildren(node, options).map((child) => minChild(node, child.node, length, options));
  return lengthOf(node.dir) === length ? sum(extents) : Math.max(0, ...extents);
}

function minChild(split: DockSplit, node: DockNode, length: keyof Size, options: PlaceOptions): number {
  if (length === "height" && isFixed(split, node, options)) return options.foldedHeight!;
  return minExtent(node, length, options);
}

function childExtents(split: DockSplit, kids: DockNode[], available: number, options: PlaceOptions): { extents: number[]; mins: number[] } {
  const length = lengthOf(split.dir);
  const fixed = (node: DockNode) => isFixed(split, node, options);
  const flex = flexIndex(kids, fixed);
  const mins = kids.map((node) => minChild(split, node, length, options));
  const wants = kids.map((node, i) => {
    if (fixed(node)) return options.foldedHeight!;
    return i === flex ? mins[i]! : Math.max(node.size, mins[i]!);
  });

  const over = sum(wants) - available;
  if (over > 0) {
    const room = sum(wants.map((want, i) => want - mins[i]!));
    const share = room > 0 ? Math.min(1, over / room) : 0;
    wants.forEach((want, i) => { wants[i] = Math.round(want - (want - mins[i]!) * share); });
  }

  // Too small for even the minimums: everything gives way evenly, so panels never overlap.
  const total = sum(wants);
  if (total > available && total > 0) wants.forEach((want, i) => { wants[i] = Math.floor((want * available) / total); });

  const others = sum(wants.filter((_, i) => i !== flex));
  wants[flex] = available - others;
  return { extents: wants, mins };
}

export function placeDock(root: DockNode, frame: Size, requested: PlaceOptions = {}): DockPlacement {
  // A hidden timeline has nothing to collapse, and the mixer beside it needs its full height.
  const options = requested.hidden?.includes("timeline") ? { ...requested, foldedHeight: undefined } : requested;
  const panels: DockPlacement["panels"] = {};
  const handles: DockHandle[] = [];

  const visit = (node: DockNode, rect: Rect, path: number[]): DockNode => {
    if (isLeaf(node)) {
      panels[node.panel] = rect;
      return node;
    }

    const length = lengthOf(node.dir);
    const shown = visibleChildren(node, options);
    const { extents, mins } = childExtents(node, shown.map((child) => child.node), rect[length], options);
    const children = [...node.children];
    let offset = node.dir === "row" ? rect.x : rect.y;

    shown.forEach((child, i) => {
      const extent = extents[i]!;
      const childRect: Rect = node.dir === "row"
        ? { x: offset, y: rect.y, width: extent, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: extent };
      children[child.index] = { ...visit(child.node, childRect, [...path, child.index]), size: extent };
      offset += extent;

      const next = shown[i + 1];
      if (!next || isFixed(node, child.node, options) || isFixed(node, next.node, options)) return;
      handles.push({
        path,
        a: child.index,
        b: next.index,
        dir: node.dir,
        rect: node.dir === "row"
          ? { x: offset - HANDLE_THICKNESS / 2, y: rect.y, width: HANDLE_THICKNESS, height: rect.height }
          : { x: rect.x, y: offset - HANDLE_THICKNESS / 2, width: rect.width, height: HANDLE_THICKNESS },
        aSize: extent,
        bSize: extents[i + 1]!,
        aMin: mins[i]!,
        bMin: mins[i + 1]!,
      });
    });

    return { ...node, children };
  };

  const baked = visit(root, { x: 0, y: 0, ...frame }, []);
  return { panels, handles, baked };
}

function updateAt(root: DockNode, path: number[], change: (node: DockNode) => DockNode): DockNode {
  if (!path.length) return change(root);
  const split = root as DockSplit;
  const [index, ...rest] = path as [number, ...number[]];
  const children = [...split.children];
  children[index] = updateAt(children[index]!, rest, change);
  return { ...split, children };
}

export function resizeDock(root: DockNode, handle: DockHandle, delta: number): DockNode {
  const total = handle.aSize + handle.bSize;
  // In a window too small for both minimums, the two panels share what there is.
  const lowest = Math.min(handle.aMin, total);
  const highest = Math.max(lowest, total - handle.bMin);
  const sizeA = Math.min(Math.max(handle.aSize + delta, lowest), highest);
  return updateAt(root, handle.path, (node) => {
    const split = node as DockSplit;
    const children = [...split.children];
    children[handle.a] = { ...children[handle.a]!, size: sizeA };
    children[handle.b] = { ...children[handle.b]!, size: total - sizeA };
    return { ...split, children };
  });
}

function withoutPanel(node: DockNode, panel: PanelId): DockNode | null {
  if (isLeaf(node)) return node.panel === panel ? null : node;
  const children = node.children
    .map((child) => withoutPanel(child, panel))
    .filter((child): child is DockNode => child !== null);
  return { ...node, children };
}

function tidy(node: DockNode): DockNode {
  if (isLeaf(node)) return node;
  const children = node.children
    .map(tidy)
    .flatMap((child) => (!isLeaf(child) && child.dir === node.dir ? child.children : [child]));
  return children.length === 1 ? { ...children[0]!, size: node.size } : { ...node, children };
}

function insertBeside(node: DockNode, target: PanelId, moved: DockLeaf, side: DockSide, targetSize: number): DockNode {
  if (isLeaf(node)) return node;
  const axis = axisOf(side);
  const children = node.children.flatMap<DockNode>((child) => {
    if (!isLeaf(child) || child.panel !== target) return [insertBeside(child, target, moved, side, targetSize)];
    const pair = comesFirst(side) ? [moved, { ...child, size: targetSize }] : [{ ...child, size: targetSize }, moved];
    return node.dir === axis ? pair : [{ dir: axis, size: child.size, children: pair }];
  });
  return { ...node, children };
}

export function movePanel(root: DockNode, panel: PanelId, target: DropTarget, frame: Size): DockNode {
  if (target.panel === panel) return root;
  const baked = placeDock(root, frame).baked;
  if (target.side === "center") return target.panel ? swapPanels(baked, panel, target.panel) : baked;

  const removed = withoutPanel(baked, panel);
  if (!removed) return root;
  const { baked: rest, panels } = placeDock(tidy(removed), frame);
  const axis = axisOf(target.side);
  const length = lengthOf(axis);
  const available = target.panel ? panels[target.panel]?.[length] ?? 0 : frame[length];
  const size = Math.min(PREFERRED_SIZES[panel][length], Math.round(available / 2));
  const moved: DockLeaf = { panel, size: Math.max(size, MIN_SIZES[panel][length]) };

  const left = Math.max(0, available - moved.size);
  if (target.panel) return tidy(insertBeside(rest, target.panel, moved, target.side, left));

  const remaining = { ...rest, size: left };
  const pair = comesFirst(target.side) ? [moved, remaining] : [remaining, moved];
  return tidy({ dir: axis, size: rest.size, children: pair });
}

function pathTo(node: DockNode, panel: PanelId, path: number[] = []): number[] | null {
  if (isLeaf(node)) return node.panel === panel ? path : null;
  for (const [index, child] of node.children.entries()) {
    const found = pathTo(child, panel, [...path, index]);
    if (found) return found;
  }
  return null;
}

function nodeAt(root: DockNode, path: number[]): DockNode {
  return path.reduce((node, index) => (node as DockSplit).children[index]!, root);
}

function swapPanels(root: DockNode, a: PanelId, b: PanelId): DockNode {
  const pathA = pathTo(root, a);
  const pathB = pathTo(root, b);
  if (!pathA || !pathB) return root;

  const dirAt = (path: number[]) => (nodeAt(root, path.slice(0, -1)) as DockSplit).dir;
  const sizeIn = (panel: PanelId, own: number, from: number[], to: number[]) =>
    dirAt(from) === dirAt(to) ? own : PREFERRED_SIZES[panel][lengthOf(dirAt(to))];
  const leafA = nodeAt(root, pathA) as DockLeaf;
  const leafB = nodeAt(root, pathB) as DockLeaf;

  // Sizes travel with the panels, so swapping two sidebars keeps each one's width.
  let next = updateAt(root, pathA, () => ({ panel: b, size: sizeIn(b, leafB.size, pathB, pathA) }));
  next = updateAt(next, pathB, () => ({ panel: a, size: sizeIn(a, leafA.size, pathA, pathB) }));

  let depth = 0;
  while (pathA[depth] === pathB[depth]) depth++;
  const parent = pathA.slice(0, depth);
  const branchA = pathA[depth]!;
  const branchB = pathB[depth]!;
  const before = (nodeAt(root, parent) as DockSplit).children;
  const after = (nodeAt(next, parent) as DockSplit).children;
  if (flexIndex(before) === flexIndex(after)) return next;

  // The canvas changed branch: the branch it left must not keep the canvas's size, or it would squeeze it.
  return updateAt(next, parent, (node) => {
    const split = node as DockSplit;
    const children = [...split.children];
    children[branchA] = { ...children[branchA]!, size: before[branchB]!.size };
    children[branchB] = { ...children[branchB]!, size: before[branchA]!.size };
    return { ...split, children };
  });
}

export function dropTargetAt(
  placed: DockPlacement["panels"],
  frame: Size,
  point: { x: number; y: number },
  dragged: PanelId,
): DropTarget | null {
  const edges: [DockSide, number][] = [
    ["left", point.x],
    ["right", frame.width - point.x],
    ["top", point.y],
    ["bottom", frame.height - point.y],
  ];
  const [outer, outerDistance] = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
  if (outerDistance < FRAME_EDGE) return { panel: null, side: outer };

  for (const panel of PANEL_IDS) {
    const rect = placed[panel];
    if (!rect) continue;
    const fx = (point.x - rect.x) / rect.width;
    const fy = (point.y - rect.y) / rect.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue;
    if (panel === dragged) return null;
    const near: [DockSide, number][] = [["left", fx], ["right", 1 - fx], ["top", fy], ["bottom", 1 - fy]];
    const [side, distance] = near.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
    return { panel, side: distance < EDGE_ZONE ? side : "center" };
  }
  return null;
}

function isDock(value: unknown): value is DockNode {
  const seen = new Set<string>();
  const valid = (node: unknown): boolean => {
    if (typeof node !== "object" || node === null) return false;
    const { panel, size, dir, children } = node as Record<string, unknown>;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return false;
    if (panel !== undefined) {
      if (!(PANEL_IDS as readonly unknown[]).includes(panel) || seen.has(panel as string)) return false;
      seen.add(panel as string);
      return true;
    }
    if (dir !== "row" && dir !== "col") return false;
    return Array.isArray(children) && children.length >= 2 && children.every(valid);
  };
  return valid(value) && seen.size === PANEL_IDS.length;
}

export function readDock(value: unknown): DockNode {
  return isDock(value) ? value : DEFAULT_DOCK;
}

export const LAYOUT_PRESET_IDS = ["timeline", "canvas", "sidebars"] as const;

export type LayoutPresetId = (typeof LAYOUT_PRESET_IDS)[number];
export type LayoutSnapshot = { dock: DockNode; layersWidth: number | null; toolbarSlot: string; hidden: HideablePanel[] };
export type SavedLayout = LayoutSnapshot & { id: string; name: string };

const timelineRow = (height: number, mixerWidth = 308): DockNode => ({
  dir: "row",
  size: height,
  children: [
    { panel: "timeline", size: 0 },
    { panel: "mixer", size: mixerWidth },
  ],
});

const topRow = (assets: number, inspector: number): DockNode => ({
  dir: "row",
  size: 0,
  children: [
    { panel: "assets", size: assets },
    { panel: "canvas", size: 0 },
    { panel: "inspector", size: inspector },
  ],
});

// Sizes come from the window at the moment of choosing, so a preset looks the same on any screen.
export function presetLayout(id: LayoutPresetId, window: Size): LayoutSnapshot {
  const toolbarSlot = "bottom";
  const hidden: HideablePanel[] = [];
  if (id === "timeline") {
    const dock: DockNode = { dir: "col", size: 0, children: [topRow(264, 308), timelineRow(Math.round(window.height * 0.55))] };
    return { dock, layersWidth: null, toolbarSlot, hidden };
  }
  if (id === "canvas") {
    const dock: DockNode = { dir: "col", size: 0, children: [topRow(248, 260), timelineRow(160, 280)] };
    return { dock, layersWidth: null, toolbarSlot, hidden };
  }
  const dock: DockNode = {
    dir: "row",
    size: 0,
    children: [
      { panel: "assets", size: 264 },
      {
        dir: "col",
        size: 0,
        children: [
          { panel: "canvas", size: 0 },
          { panel: "timeline", size: 234 },
        ],
      },
      {
        dir: "col",
        size: 308,
        children: [
          { panel: "inspector", size: 0 },
          { panel: "mixer", size: 234 },
        ],
      },
    ],
  };
  return { dock, layersWidth: 248, toolbarSlot, hidden };
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export const findLayoutByName = (layouts: SavedLayout[], name: string): SavedLayout | undefined =>
  layouts.find((layout) => sameName(layout.name, name));

/** Saving under a name already in the list updates that layout, in its place. */
export function withSavedLayout(layouts: SavedLayout[], name: string, snapshot: LayoutSnapshot, newId: string): { layouts: SavedLayout[]; id: string } {
  const existing = findLayoutByName(layouts, name);
  const saved: SavedLayout = { ...snapshot, id: existing?.id ?? newId, name: name.trim() };
  if (!existing) return { layouts: [...layouts, saved], id: saved.id };
  return { layouts: layouts.map((layout) => (layout.id === existing.id ? saved : layout)), id: saved.id };
}

export function withRestoredLayout(layouts: SavedLayout[], deleted: SavedLayout, index: number): SavedLayout[] {
  if (layouts.some((layout) => layout.id === deleted.id) || findLayoutByName(layouts, deleted.name)) return layouts;
  return [...layouts.slice(0, index), deleted, ...layouts.slice(index)];
}

export function readHidden(value: unknown): HideablePanel[] {
  if (!Array.isArray(value)) return [];
  return HIDEABLE_PANELS.filter((panel) => value.includes(panel));
}

export function readSavedLayouts(value: unknown): SavedLayout[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((entry): SavedLayout[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, name, dock, layersWidth, toolbarSlot, hidden } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || ids.has(id)) return [];
    if (typeof name !== "string" || !name.trim() || !isDock(dock)) return [];
    ids.add(id);
    return [{
      id,
      name,
      dock,
      layersWidth: typeof layersWidth === "number" && Number.isFinite(layersWidth) ? layersWidth : null,
      toolbarSlot: typeof toolbarSlot === "string" ? toolbarSlot : "bottom",
      hidden: readHidden(hidden),
    }];
  });
}
