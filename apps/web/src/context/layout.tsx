/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createContext, createMemo, createSignal, useContext, type Accessor, type JSX } from 'solid-js';
import { assert } from '@/utils';
import { createStoredSignal } from '@/lib/store';
import { store } from '@/init';
import {
  DEFAULT_DOCK,
  presetLayout,
  readDock,
  readHidden,
  readSavedLayouts,
  withSavedLayout,
  type DockNode,
  type HideablePanel,
  type LayoutPresetId,
  type LayoutSnapshot,
  type SavedLayout,
} from '@/components/editor/dock-layout';

/** The toolbar snaps to one of these when dragged. */
export const TOOLBAR_SLOTS = ['bottom', 'top', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type ToolbarSlot = (typeof TOOLBAR_SLOTS)[number];

type LayoutContextValue = {
  uiVisible: Accessor<boolean>;
  timelineMinimized: Accessor<boolean>;
  dock: Accessor<DockNode>;
  setDock(dock: DockNode): void;
  layersWidth: Accessor<number | null>;
  setLayersWidth(width: number | null): void;
  toolbarSlot: Accessor<ToolbarSlot>;
  setToolbarSlot(slot: ToolbarSlot): void;
  toggleUI(): void;
  toggleTimeline(): void;
  resetLayout(): void;
  hiddenSections: Accessor<HideablePanel[]>;
  /** Shows every section for now, leaving the saved choice alone. */
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
    store.define<DockNode>('layout.dock', DEFAULT_DOCK, readDock),
  );
  const [layersWidth, setLayersWidth] = createStoredSignal(
    store.define<number | null>('layout.layersWidth', null, (value) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null,
    ),
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
    store.define<HideablePanel[]>('layout.hidden', [], readHidden),
  );
  const [sectionsRevealed, setSectionsRevealed] = createSignal(false);
  const hiddenSections = () => (sectionsRevealed() ? [] : savedHidden());
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

  const snapshot = (): LayoutSnapshot => ({ dock: dock(), layersWidth: layersWidth(), toolbarSlot: toolbarSlot(), hidden: savedHidden() });
  // Compared, not cleared on change, so a drag cancelled with Esc still counts as the same layout.
  const activeLayout = createMemo(() => {
    const current = applied();
    return current?.snapshot === JSON.stringify(snapshot()) ? current.id : null;
  });

  const applySnapshot = (next: LayoutSnapshot, id: string | null) => {
    setDock(next.dock);
    setLayersWidth(next.layersWidth);
    setToolbarSlot(TOOLBAR_SLOTS.includes(next.toolbarSlot as ToolbarSlot) ? next.toolbarSlot as ToolbarSlot : 'bottom');
    setSavedHidden(next.hidden);
    setTimelineMinimized(false);
    setUiVisible(true);
    setApplied(id ? { id, snapshot: JSON.stringify(snapshot()) } : null);
  };

  const resetLayout = () => applySnapshot({ dock: DEFAULT_DOCK, layersWidth: null, toolbarSlot: 'bottom', hidden: [] }, null);
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
    setSavedLayouts(before.filter((layout) => layout.id !== id));
    return () => setSavedLayouts(before);
  };

  return (
    <LayoutContext.Provider
      value={{
        uiVisible,
        timelineMinimized,
        dock,
        setDock,
        layersWidth,
        setLayersWidth,
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
