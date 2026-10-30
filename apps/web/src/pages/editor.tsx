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
/** The space around the panels, and between them and the rail. */
const PANEL_GAP = 6;
/**
 * The panels are one frame: they meet edge to edge, each drawing the edges
 * no neighbour draws for it, so every line inside is a single hairline and
 * only the frame's outer corners are round.
 */
const PANEL_SURFACE = 'min-h-0 min-w-0 overflow-hidden border-border-strong bg-background';
// As wide as the rail and the left panel together, so the canvas between
// them, and the stage on it, sits in the middle of the window.
const INSPECTOR_WIDTH = EDITOR_RAIL_WIDTH + ASSETS_SIDEBAR_WIDTH;
/** Wider while a stream layout is set up, so its phone preview has room. */
const LAYOUT_INSPECTOR_WIDTH = 360;
// One width for every view of the left panel, extensions included, so
// switching views never moves the canvas.
const sidebarWidth = () => leftSidebarWidth();

export function EditorPage() {
  const { uiVisible, timelineMinimized, timelineHeight, setTimelineHeight } = useLayout();
  const { isDesktop, isFullscreen } = useEditorApi();
  const [resizing, setResizing] = createSignal(false);
  const project = useProject();
  const world = useWorld();
  const engine = useEngineContext();

  // Keyed on the folder, not the project: a rename moves it, and everything
  // below holds a path — the watcher, the library, the writer — so all of it
  // is torn down and re-attached where the project now is.
  createEffect(() => {
    const dir = project.dir();
    if (!dir) return;

    let mounted: Mount | undefined;
    let mountedCode: string | undefined;
    let writer: EditWriter | undefined;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let generation = 0;
    // The web app saves the stage itself; the desktop app writes the source.
    // A save never goes over a newer one from another tab or device (see
    // `holdBrowserComposition`).
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
        // Still on the stage that was turned away: the newer file replaces it.
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
    // The generation service over it: what `generate.*` sources resolve through.
    attachAi(world, library, dir);
    // The project's own settings (package.json `planvideo`), next to the scene.
    const config = attachProjectConfig(world, dir);

    const unmount = (): void => {
      // Before the entities go: what the editor changed is still owed to the
      // file, whatever happens to the scene that showed it.
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

    /**
     * Puts `code` on the stage, unless it is what is there already. In the
     * web app `text` is the composition file it was built from, and that is
     * what tells: the stage's own saves have moved the file on from the code
     * it mounted.
     */
    const applyBundle = (code: string, text?: string | null): void => {
      if (composition && text !== undefined ? composition.holds(text) : code === mountedCode) return;
      // An edit that has not been written yet belongs to the stage that is
      // about to go. The read happens before the entities do.
      if (compositionDirty) saveComposition();
      // The old render goes first: there is only one stage per world.
      unmount();
      mounted = mount(code, world);
      mountedCode = code;
      if (composition && text !== undefined) composition.adopt(text);
      // The `@inspect` variables this mount declared, for the inspector.
      setInspectEntries(world, mounted.inspect);
      // The rendered scene knows which element every entity came from, so
      // from here on an edit in the editor can find its way back.
      writer = createEditWriter(dir, world);
      const editor = getDocumentEditor(world);
      unlisten = editor.onEdit((edit) => {
        writer?.push(edit);
        if (changesComposition(edit)) scheduleCompositionSave();
      });
      // A mount comes from the file: edits recorded against the document it
      // replaced cannot be replayed against this one.
      getEditHistory(world).reset();
      settleView();
    };

    // The project opens with every scene in view. A camera saved with the
    // project belongs to the window it was saved in, so it is not reused.
    // The same pass points the timeline at a scene when the save didn't say
    // which one.
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
      // The web app also reads the composition file the compile mounts, which
      // its saves are then held to.
      const compiling: Promise<{ result: CompileResult; text?: string | null }> = composition
        ? composition.read(() => compileProject(dir))
        : compileProject(dir).then((result) => ({ result }));
      const loading = library.load();

      // First open only: the bundle the last session mounted, straight from
      // the app's database, goes on the stage while the compile chews
      // through the sources — unless the compile wins the race outright. A
      // bundle the sources have outgrown can fail against today's assets;
      // the compile that is already running replaces it either way.
      // The browser compile is a file read, so the cached bundle is not a head
      // start there. Mounting it first would let an edit land on a stage the
      // compile then replaces.
      if (current === 1 && isDesktop) {
        // Neither arm may reject: the loser would be an unhandled rejection,
        // and the compile's real failure is dealt with below.
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

      // A broken edit keeps the last good render on the canvas.
      if (!result.ok) {
        console.error('[projects] compile failed:', result.error);
        toast.error(t('Project failed to compile'), { description: result.error });
        return;
      }

      try {
        applyBundle(result.code, text);
        // What an export renders a second time, and the next open's head
        // start (see `rememberProjectBundle`) — recorded only once it has
        // actually mounted, so the record never runs ahead of the canvas.
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
  
    // A burst arrives as the whole set of files it touched, so a checkout that
    // rewrites the library and the sources at once reloads both — reading only
    // the last path of a burst would answer for one of them and drop the rest.
    const unwatch = watchProject(dir, (paths) => {
      // What the cloud sync set aside after a clash is kept, not shown.
      const changed = paths.filter((path) => !isCacheFile(path) && !path.startsWith('.conflicts/'));
      if (changed.some(isLibraryFile)) library.load();

      const source = changed.filter((path) => !isLibraryFile(path));
      if (!source.length) return;
      // package.json is the config and the record (`main`, `displayName`)
      // in one, so a hand edit to it reloads both; the app's own config
      // writes never reach here (main keeps them from the watcher).
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

  // The left column is the sidebar width. Toggling `uiVisible` changes the
  // track count, which Chromium does not interpolate, so that still snaps.
  const [animateColumns, setAnimateColumns] = createSignal(false);
  // The editor's palette and type (see `html.editor-theme` in index.css). On
  // <html>, so the menus and dialogs mounted on <body> get it too, and before
  // the first paint, so it never flashes the base theme.
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
  // The layers column lines up with the left panel above it.
  const layersWidth = () => sidebarWidth();
  const bottomHeight = () => (timelineMinimized() ? RULER_HEIGHT : timelineHeight());
  // The mixer has the bottom-right corner, under the inspector, whenever the
  // timeline is open.
  const mixerShown = () => !timelineMinimized();

  // The rail on the chrome, then one frame on the canvas color: the left
  // panel, the canvas between the two panels, and the timeline across the
  // bottom under all three, joined edge to edge. The rail's column takes the
  // gap between it and the frame.
  const rootStyles = createMemo(() => {
    if (!uiVisible()) return;
    return {
      'grid-template-columns': `${EDITOR_RAIL_WIDTH + PANEL_GAP}px ${sidebarWidth()}px minmax(0, 1fr) ${inspectorWidth()}px`,
      'grid-template-rows': `minmax(0, 1fr) ${bottomHeight()}px`,
      padding: `calc(var(--titlebar-height) + ${PANEL_GAP}px) ${PANEL_GAP}px ${PANEL_GAP}px 0`,
      ...(animateColumns() ? { transition: 'grid-template-columns 200ms ease-out' } : {}),
    };
  });

  // The bottom row: the layers and their clips, which share rows, and the
  // mixer under the inspector, its edge in line with the inspector's.
  const bottomStyles = createMemo(() => ({
    'grid-template-columns': `minmax(0, 1fr)${mixerShown() ? ` ${inspectorWidth()}px` : ''}`,
    ...(animateColumns() ? { transition: 'grid-template-columns 200ms ease-out' } : {}),
  }));

  // Inside it, the layers column ends where the left panel above does (less
  // the frame's left edge), so the hairline between them continues the
  // panel's right edge.
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
      // Guest mode sets the editor in a frame (see guest-frame.tsx), which it fills.
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
        {/* On Windows the title bar carries the project's name. */}
        <div class={`${PANEL_SURFACE} flex flex-col rounded-tl-lg border-l border-t border-r`} style={{ 'grid-column': '2', 'grid-row': '1' }}>
          <Show when={!isWindowsDesktop()}>
            <ProjectBar />
          </Show>
          <div class="flex min-h-0 flex-1 flex-col">
            <SidebarLeft />
          </div>
        </div>
      </Show>
      {/* The canvas keeps its place in this grid whether the panels show or
          not, so hiding them never remounts it. It has no card: the stage sits
          straight on the window's canvas color, with the frame's top edge
          running over it from one panel to the other. */}
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
          {/* The edge above the timeline is its handle, a few pixels either side of it. */}
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
      {/* The Windows title bar stays up with the UI hidden and offers the same. */}
      <Show when={!uiVisible() && !isWindowsDesktop()}>
        <FloatingProjectHeader />
      </Show>
      <EditorTour />
      <WorkflowsHost />
    </div>
  );
}
