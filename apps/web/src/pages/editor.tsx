/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo, createSignal, onMount } from "solid-js";
import { Canvas } from "@/components/canvas";
import { ASSETS_SIDEBAR_WIDTH, leftSidebarWidth, setSidebarTab } from "@/agent-chat";
import { Timeline, Layers } from "@/components/timeline";
import { Soundboard, Inspector } from "@/components/sidebar-right";
import { EditorTitleBar, FloatingProjectHeader, SidebarLeft } from "@/components/sidebar-left";
import { ProjectBar } from "@/components/editor/project-bar";
import { EDITOR_RAIL_WIDTH, EditorRail } from "@/components/editor/editor-rail";
import { EditorTour } from "@/components/tour/editor-tour";
import { useLayout, MIN_TIMELINE_HEIGHT } from "@/context/layout";
import { useEditorApi } from "@/dapi";
import { RULER_HEIGHT } from "@/engine/timeline";
import { createEffect, onCleanup, untrack } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@plan.video/koota-solid';
import { mount } from '@plan.video/reconciler';
import { getActiveEntity, getEntityChildren, Root } from '@plan.video/runtime';
import { getDocumentEditor } from '@/engine/editor';
import { getEditHistory } from '@/engine/history';
import { setInspectEntries } from '@/engine/inspect';
import { attachLibrary, isLibraryFile } from '@/engine/library';
import { attachAi } from '@/utils/gen-ai';
import { attachProjectConfig, isProjectConfigFile } from '@/engine/project-config';
import { loadProjectBundle, rememberProjectBundle } from '@/lib/db';
import { isCacheFile } from '@plan.video/assets';
import { createEditWriter } from '@/projects/edits';
import { browserCompositionText, changesComposition, holdBrowserComposition } from '@/projects/composition';
import { compileProject, isWindowsDesktop, refreshProject, watchProject } from '@/projects/host';
import { captureProjectCover } from '@/projects/cover';
import { coverRect, settleOpeningView } from '@/engine/camera';
import { closeStreamLayout, layoutTarget } from '@/engine/stream-layout';
import { copySelection, cutSelection, pasteSelection, redoEdit, selectAll, undoEdit } from '@/engine/input/shortcuts';
import { registerEditCommands } from '@/lib/edit-commands';
import { useProject } from "@/context/project";
import { cx } from "@/lib/cva";
import { inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { useEngineContext } from "@/engine";
import { WorkflowsHost } from "@/components/workflows/save-workflow-dialog";

import type { Mount } from '@plan.video/reconciler';
import type { EditWriter } from '@/projects/edits';
import type { CompileResult } from '@/projects/host';

const MIN_CANVAS_HEIGHT = 200;
const PANEL_GAP = 6;
// Panels form one frame: each draws only the edges no neighbour draws, so inner lines stay single hairlines.
const PANEL_SURFACE = 'min-h-0 min-w-0 overflow-hidden border-border-strong bg-background';
// Rail + left panel wide, so the canvas between them sits centred in the window.
const INSPECTOR_WIDTH = EDITOR_RAIL_WIDTH + ASSETS_SIDEBAR_WIDTH;
const LAYOUT_INSPECTOR_WIDTH = 360;
// One width for every left-panel view, so switching views never moves the canvas.
const sidebarWidth = () => leftSidebarWidth();

export function EditorPage() {
  const { uiVisible, timelineMinimized, timelineHeight, setTimelineHeight } = useLayout();
  const { isDesktop, isFullscreen } = useEditorApi();
  const [resizing, setResizing] = createSignal(false);
  const project = useProject();
  const world = useWorld();
  const engine = useEngineContext();

  // Keyed on the folder, not the project: a rename moves it, and the watcher, library and writer all hold a path.
  createEffect(() => {
    const dir = project.dir();
    if (!dir) return;

    let mounted: Mount | undefined;
    let mountedCode: string | undefined;
    let writer: EditWriter | undefined;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let generation = 0;
    // A save never overwrites a newer one from another tab or device (see `holdBrowserComposition`).
    const composition = isDesktop ? undefined : holdBrowserComposition(dir);
    let compositionDirty = false;
    let compositionTimer: ReturnType<typeof setTimeout> | undefined;

    const saveComposition = (): void => {
      if (!composition || mountedCode === undefined) return;
      clearTimeout(compositionTimer);
      compositionTimer = undefined;
      compositionDirty = false;
      const stage = mounted;
      composition.save(browserCompositionText(world)).then((saved) => {
        if (saved || disposed) return;
        toast.error(t("Your last change wasn't saved"), {
          id: `composition-refused:${dir}`,
          description: t('This project was changed in another tab or on another device. The newer version is open now.'),
        });
        if (stage === mounted) load();
      }, (error: unknown) => {
        console.error('[projects] could not save the composition:', error);
      });
    };

    const scheduleCompositionSave = (): void => {
      if (!composition) return;
      compositionDirty = true;
      clearTimeout(compositionTimer);
      compositionTimer = setTimeout(saveComposition, 200);
    };

    const onPageHide = (): void => {
      if (compositionDirty) saveComposition();
    };
    if (!isDesktop) window.addEventListener('pagehide', onPageHide);

    // The library first: a mounted project's `src` values name its assets.
    const library = attachLibrary(world, dir);
    attachAi(world, library, dir);
    const config = attachProjectConfig(world, dir);

    const unmount = (): void => {
      // Before the entities go: unsaved editor changes are still owed to the file.
      unlisten?.();
      unlisten = undefined;
      writer?.dispose();
      writer = undefined;
      mounted?.dispose();
      mounted = undefined;
      mountedCode = undefined;
      // The entries hold the dead mount's signals; the inspector must not.
      setInspectEntries(world, []);
    };

    const applyBundle = (code: string, text?: string | null): void => {
      if (composition && text !== undefined ? composition.holds(text) : code === mountedCode) return;
      // Unwritten edits belong to the outgoing stage; save them before its entities go.
      if (compositionDirty) saveComposition();
      // The old render goes first: there is only one stage per world.
      unmount();
      mounted = mount(code, world);
      mountedCode = code;
      if (composition && text !== undefined) composition.adopt(text);
      setInspectEntries(world, mounted.inspect);
      writer = createEditWriter(dir, world);
      const editor = getDocumentEditor(world);
      unlisten = editor.onEdit((edit) => {
        writer?.push(edit);
        if (changesComposition(edit)) scheduleCompositionSave();
      });
      // Edits recorded against the replaced document cannot be replayed against this one.
      getEditHistory(world).reset();
      settleView();
    };

    // A camera saved with the project belongs to the window it was saved in, so it is not reused.
    const settleView = (): void => {
      if (disposed) return;
      const root = world.get(Root);
      if (root && !getActiveEntity(world)) {
        const first = getEntityChildren(world, root)[0];
        if (first) getDocumentEditor(world).activate(first);
      }
      settleOpeningView(world, () => !disposed && mountedCode !== undefined);
    };

    const loadProject = async (): Promise<void> => {
      const current = ++generation;
      const compiling: Promise<{ result: CompileResult; text?: string | null }> = composition
        ? composition.read(() => compileProject(dir))
        : compileProject(dir).then((result) => ({ result }));
      const loading = library.load();

      // Desktop first open only: mount the cached bundle while the compile runs, unless the compile wins the race.
      // Not in the browser: its compile is a quick file read, and mounting first would let an edit land on a
      // stage the compile then replaces.
      if (current === 1 && isDesktop) {
        // Neither arm may reject: the loser would be an unhandled rejection.
        const cached = await Promise.race([
          Promise.all([loadProjectBundle(untrack(project.id)), loading])
            .then(([code]) => code, () => null),
          compiling.then(() => null, () => null),
        ]);
        if (disposed || current !== generation) return;
        if (cached && mountedCode === undefined) {
          try {
            applyBundle(cached);
          } catch {
            // The compile lands next, with a toast of its own if it must.
          }
        }
      }

      const [{ result, text }] = await Promise.all([compiling, loading]);
      if (disposed || current !== generation) return;

      if (!result.ok) {
        console.error('[projects] compile failed:', result.error);
        toast.error(t('Project failed to compile'), { description: result.error });
        return;
      }

      try {
        applyBundle(result.code, text);
        // Recorded only once mounted, so the record never runs ahead of the canvas.
        rememberProjectBundle(untrack(project.id), result.code).catch((error) =>
          console.error('[projects] could not save the bundle', error));
      } catch (error) {
        console.error('[projects] render failed:', error);
        toast.error(t('Project failed to render'), { description: (error as Error).message });
      }
    };

    const load = (): void => {
      loadProject().catch((error) => {
        console.error('[projects] load failed:', error);
        toast.error(t('Project failed to load'), { description: (error as Error).message });
      });
    };

    load();
  
    // A burst carries every path it touched; reading only the last one would drop the rest.
    const unwatch = watchProject(dir, (paths) => {
      // Files the cloud sync set aside after a clash are kept, not shown.
      const changed = paths.filter((path) => !isCacheFile(path) && !path.startsWith('.conflicts/'));
      if (changed.some(isLibraryFile)) library.load();

      const source = changed.filter((path) => !isLibraryFile(path));
      if (!source.length) return;
      // package.json is both config and record, so a hand edit reloads both; the app's own writes never reach here.
      if (source.some(isProjectConfigFile)) {
        config.load();
        project.refresh();
      }
      load();
    });

    onCleanup(() => {
      disposed = true;
      if (compositionDirty) saveComposition();
      window.removeEventListener('pagehide', onPageHide);
      captureProjectCover(dir, engine.snapshot(coverRect(world) ?? undefined));
      refreshProject(dir);
      unwatch();
      unmount();
      config.dispose();
      library.dispose();
    });
  });

  // Toggling `uiVisible` changes the track count, which Chromium does not interpolate, so that still snaps.
  const [animateColumns, setAnimateColumns] = createSignal(false);
  // On <html> so menus and dialogs mounted on <body> get it, and set before first paint so the base theme never flashes.
  const root = document.documentElement;
  root.classList.add('editor-theme');
  onCleanup(() => root.classList.remove('editor-theme'));
  onCleanup(closeStreamLayout);
  onCleanup(registerEditCommands({
    undo: () => undoEdit(world),
    redo: () => redoEdit(world),
    cut: () => cutSelection(world),
    copy: () => copySelection(world),
    paste: () => pasteSelection(world),
    selectAll: () => selectAll(world),
  }));
  onMount(() => {
    setSidebarTab("assets");
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => requestAnimationFrame(() => setAnimateColumns(true)));
  });

  const inspectorWidth = () => (layoutTarget() ? LAYOUT_INSPECTOR_WIDTH : INSPECTOR_WIDTH);
  const layersWidth = () => sidebarWidth();
  const bottomHeight = () => (timelineMinimized() ? RULER_HEIGHT : timelineHeight());
  const mixerShown = () => !timelineMinimized();

  const rootStyles = createMemo(() => {
    if (!uiVisible()) return;
    return {
      'grid-template-columns': `${EDITOR_RAIL_WIDTH + PANEL_GAP}px ${sidebarWidth()}px minmax(0, 1fr) ${inspectorWidth()}px`,
      'grid-template-rows': `minmax(0, 1fr) ${bottomHeight()}px`,
      padding: `calc(var(--titlebar-height) + ${PANEL_GAP}px) ${PANEL_GAP}px ${PANEL_GAP}px 0`,
      ...(animateColumns() ? { transition: 'grid-template-columns 200ms ease-out' } : {}),
    };
  });

  const bottomStyles = createMemo(() => ({
    'grid-template-columns': `minmax(0, 1fr)${mixerShown() ? ` ${inspectorWidth()}px` : ''}`,
    ...(animateColumns() ? { transition: 'grid-template-columns 200ms ease-out' } : {}),
  }));

  const timelineStyles = createMemo(() => ({
    'grid-template-columns': `${layersWidth() - 2}px 1px minmax(0, 1fr)`,
    ...(animateColumns() ? { transition: 'grid-template-columns 200ms ease-out' } : {}),
  }));

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = timelineHeight();
    setResizing(true);

    const handleMove = (ev: PointerEvent) => {
      const deltaY = startY - ev.clientY;
      const maxHeight = Math.max(
        MIN_TIMELINE_HEIGHT,
        window.innerHeight - MIN_CANVAS_HEIGHT - PANEL_GAP * 3,
      );
      const next = Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxHeight, startHeight + deltaY));
      setTimelineHeight(next);
    };

    const handleEnd = () => {
      setResizing(false);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleEnd);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleEnd);
  };

  return (
    <div
      class={cx("bg-canvas w-full overflow-hidden grid", inGuestMode() ? "h-full" : "h-screen")}
      classList={{ 'grid-cols-[1fr] grid-rows-[1fr] pt-(--titlebar-height)': !uiVisible() }}
      style={rootStyles()}
    >
      <EditorTitleBar leftWidth={EDITOR_RAIL_WIDTH + sidebarWidth() + PANEL_GAP} controlsWidth={inspectorWidth() + PANEL_GAP * 2} />
      <Show when={isDesktop && !isWindowsDesktop() && !isFullscreen()}>
        <div class="fixed top-0 left-0 right-0 h-10 z-20" style="-webkit-app-region: drag;" />
      </Show>
      <Show when={uiVisible()}>
        <EditorRail style={{ 'grid-column': '1', 'grid-row': '1 / span 2', 'padding-right': `${PANEL_GAP}px` }} />
        <div class={`${PANEL_SURFACE} flex flex-col rounded-tl-lg border-l border-t border-r`} style={{ 'grid-column': '2', 'grid-row': '1' }}>
          <Show when={!isWindowsDesktop()}>
            <ProjectBar />
          </Show>
          <div class="flex min-h-0 flex-1 flex-col">
            <SidebarLeft />
          </div>
        </div>
      </Show>
      {/* Keeps its grid place whether the panels show or not, so hiding them never remounts the canvas. */}
      <div
        class="relative min-h-0 min-w-0"
        classList={{ 'border-t border-border-strong': uiVisible() }}
        style={uiVisible() ? { 'grid-column': '3', 'grid-row': '1' } : undefined}
      >
        <Canvas />
      </div>
      <Show when={uiVisible()}>
        <div class={`${PANEL_SURFACE} flex flex-col rounded-tr-lg border-l border-t border-r`} style={{ 'grid-column': '4', 'grid-row': '1' }}>
          <Inspector />
        </div>
        <div class="relative min-h-0" style={{ 'grid-column': '2 / span 3', 'grid-row': '2' }}>
          <Show when={!timelineMinimized()}>
            <div
              class="absolute inset-x-0 z-10 cursor-ns-resize group"
              style={{ top: `-${PANEL_GAP / 2}px`, height: `${PANEL_GAP}px` }}
              onPointerDown={handleResizeStart}
            >
              <div
                class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors group-hover:bg-primary"
                classList={{ 'bg-primary': resizing() }}
              />
            </div>
          </Show>
          <div class="grid h-full min-h-0" style={bottomStyles()}>
            <div
              class={`${PANEL_SURFACE} grid rounded-bl-lg border-t border-l border-b`}
              classList={{ 'rounded-br-lg border-r': !mixerShown() }}
              style={timelineStyles()}
            >
              <Layers />
              <div class="bg-border-strong" />
              <Timeline />
            </div>
            <Show when={mixerShown()}>
              <div class={`${PANEL_SURFACE} rounded-br-lg border`}>
                <Soundboard />
              </div>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={!uiVisible() && !isWindowsDesktop()}>
        <FloatingProjectHeader />
      </Show>
      <EditorTour />
      <WorkflowsHost />
    </div>
  );
}
