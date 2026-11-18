/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createMemo, createSignal, useContext, type Accessor, type JSX } from 'solid-js';
import { assert } from '@/utils';
import { createStoredSignal } from '@/lib/store';
import { store } from '@/init';
import { DEFAULT_CLIP_HEIGHT, RULER_HEIGHT, SCROLLBAR_LANE, TIMELINE_BAR_HEIGHT } from '@/engine/timeline/config';
import {
  DEFAULT_HIDDEN_PANELS,
  defaultDock,
  isPlainDefault,
  presetLayout,
  readDock,
  readHidden,
  readSavedLayouts,
  withRestoredLayout,
  withSavedLayout,
  type DockNode,
  type HideablePanel,
  type LayoutPresetId,
  type LayoutSnapshot,
  type SavedLayout,
} from '@/components/editor/dock-layout';

const TIMELINE_SHARE = 0.3;
const DEFAULT_TIMELINE_ROWS = [4, 8] as const;

/** About a third of the window, at a height that shows whole rows under the timeline's bar and ruler. */
function startingDock() {
  const chrome = TIMELINE_BAR_HEIGHT + RULER_HEIGHT + SCROLLBAR_LANE;
  const rows = Math.round((window.innerHeight * TIMELINE_SHARE - chrome) / DEFAULT_CLIP_HEIGHT);
  const [fewest, most] = DEFAULT_TIMELINE_ROWS;
  return defaultDock(chrome + Math.min(most, Math.max(fewest, rows)) * DEFAULT_CLIP_HEIGHT);
}

/** The toolbar snaps to one of these when dragged. */
export const TOOLBAR_SLOTS = ['bottom', 'top', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type ToolbarSlot = (typeof TOOLBAR_SLOTS)[number];

type LayoutContextValue = {
  uiVisible: Accessor<boolean>;
  timelineMinimized: Accessor<boolean>;
  dock: Accessor<DockNode>;
  setDock(dock: DockNode): void;
  toolbarSlot: Accessor<ToolbarSlot>;
  setToolbarSlot(slot: ToolbarSlot): void;
  toggleUI(): void;
  toggleTimeline(): void;
  resetLayout(): void;
  hiddenSections: Accessor<HideablePanel[]>;
  /** Shows every section the tour points at for now, leaving the saved choice alone. */
  setSectionsRevealed(revealed: boolean): void;
  hideSection(panel: HideablePanel): void;
  showSection(panel: HideablePanel): void;
  customizing: Accessor<boolean>;
  setCustomizing(on: boolean): void;
  savedLayouts: Accessor<SavedLayout[]>;
  /** The preset or saved layout on screen, until the user changes anything. */
  activeLayout: Accessor<string | null>;
  applyPreset(id: LayoutPresetId): void;
  applySavedLayout(layout: SavedLayout): void;
  saveLayout(name: string): void;
  /** Returns a function that puts it back. */
  deleteSavedLayout(id: string): () => void;
};

const LayoutContext = createContext<LayoutContextValue>();

export function LayoutProvider(props: { children: JSX.Element }) {
  const [uiVisible, setUiVisible] = createStoredSignal(
    store.define<boolean>('layout.uiVisible', true),
  );

  const [dock, setDock] = createStoredSignal(
    store.define<DockNode>('layout.dock', startingDock(), (saved) => {
      const dock = readDock(saved);
      return isPlainDefault(dock) ? startingDock() : dock;
    }),
  );
  const [timelineMinimized, setTimelineMinimized] = createStoredSignal(
    store.define<boolean>('layout.timelineMinimized', false),
  );

  const [toolbarSlot, setToolbarSlot] = createStoredSignal(
    store.define<ToolbarSlot>('layout.toolbarSlot', 'bottom', (value) =>
      TOOLBAR_SLOTS.includes(value) ? value : 'bottom',
    ),
  );

  const toggleUI = () => setUiVisible(!uiVisible());

  const [savedHidden, setSavedHidden] = createStoredSignal(
    store.define<HideablePanel[]>('layout.hiddenPanels', DEFAULT_HIDDEN_PANELS, readHidden),
  );
  const [sectionsRevealed, setSectionsRevealed] = createSignal(false);
  const hiddenSections = () => (sectionsRevealed() ? savedHidden().filter((panel) => panel === 'mixer') : savedHidden());
  const [customizing, setCustomizing] = createSignal(false);
  const hideSection = (panel: HideablePanel) => setSavedHidden([...savedHidden().filter((id) => id !== panel), panel]);
  const showSection = (panel: HideablePanel) => {
    if (hiddenSections().includes(panel)) setSavedHidden(savedHidden().filter((id) => id !== panel));
  };

  const toggleTimeline = () => {
    if (hiddenSections().includes('timeline')) showSection('timeline');
    else setTimelineMinimized(!timelineMinimized());
  };

  const [savedLayouts, setSavedLayouts] = createStoredSignal(
    store.define<SavedLayout[]>('layout.saved', [], readSavedLayouts),
  );
  const [applied, setApplied] = createStoredSignal(
    store.define<{ id: string; snapshot: string } | null>('layout.applied', null),
  );

  const snapshot = (): LayoutSnapshot => ({ dock: dock(), toolbarSlot: toolbarSlot(), hidden: savedHidden() });
  // Compared, not cleared on change, so a drag cancelled with Esc still counts as the same layout.
  const activeLayout = createMemo(() => {
    const current = applied();
    return current?.snapshot === JSON.stringify(snapshot()) ? current.id : null;
  });

  const applySnapshot = (next: LayoutSnapshot, id: string | null) => {
    setDock(next.dock);
    setToolbarSlot(TOOLBAR_SLOTS.includes(next.toolbarSlot as ToolbarSlot) ? next.toolbarSlot as ToolbarSlot : 'bottom');
    setSavedHidden(next.hidden);
    setTimelineMinimized(false);
    setUiVisible(true);
    setApplied(id ? { id, snapshot: JSON.stringify(snapshot()) } : null);
  };

  const resetLayout = () => applySnapshot({ dock: startingDock(), toolbarSlot: 'bottom', hidden: DEFAULT_HIDDEN_PANELS }, null);
  const applyPreset = (id: LayoutPresetId) => {
    applySnapshot(presetLayout(id, { width: window.innerWidth, height: window.innerHeight }), id);
  };
  const applySavedLayout = (layout: SavedLayout) => applySnapshot(layout, layout.id);
  const saveLayout = (name: string) => {
    const saved = withSavedLayout(savedLayouts(), name, snapshot(), crypto.randomUUID());
    setSavedLayouts(saved.layouts);
    setApplied({ id: saved.id, snapshot: JSON.stringify(snapshot()) });
  };
  const deleteSavedLayout = (id: string) => {
    const before = savedLayouts();
    const index = before.findIndex((layout) => layout.id === id);
    const deleted = before[index];
    setSavedLayouts(before.filter((layout) => layout.id !== id));
    return () => {
      if (deleted) setSavedLayouts(withRestoredLayout(savedLayouts(), deleted, index));
    };
  };

  return (
    <LayoutContext.Provider
      value={{
        uiVisible,
        timelineMinimized,
        dock,
        setDock,
        toolbarSlot,
        setToolbarSlot,
        toggleUI,
        toggleTimeline,
        resetLayout,
        hiddenSections,
        setSectionsRevealed,
        hideSection,
        showSection,
        customizing,
        setCustomizing,
        savedLayouts,
        activeLayout,
        applyPreset,
        applySavedLayout,
        saveLayout,
        deleteSavedLayout,
      }}>
      {props.children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  assert(ctx, 'useLayout must be used within LayoutProvider');
  return ctx;
}
