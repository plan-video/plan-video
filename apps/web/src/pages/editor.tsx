/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, onMount } from "solid-js";
import { setSidebarTab } from "@/agent-chat";
import { FloatingProjectHeader } from "@/components/sidebar-left";
import { EditorDock } from "@/components/editor/dock";
import { EditorTour } from "@/components/tour/editor-tour";
import { useLayout } from "@/context/layout";
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
import { rememberProjectBundle } from '@/lib/db';
import { isCacheFile } from '@plan.video/assets';
import { createEditWriter } from '@/projects/edits';
import { browserCompositionText, changesComposition, holdBrowserComposition } from '@/projects/composition';
import { compileProject, refreshProject, watchProject } from '@/projects/host';
import { captureProjectCover } from '@/projects/cover';
import { coverRect, settleOpeningView } from '@/engine/camera';
import { closeStreamLayout } from '@/engine/stream-layout';
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

export function EditorPage() {
  const { uiVisible } = useLayout();
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
    const composition = holdBrowserComposition(dir);
    let compositionDirty = false;
    let compositionTimer: ReturnType<typeof setTimeout> | undefined;

    const saveComposition = (): void => {
      if (mountedCode === undefined) return;
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
      compositionDirty = true;
      clearTimeout(compositionTimer);
      compositionTimer = setTimeout(saveComposition, 200);
    };

    const onPageHide = (): void => {
      if (compositionDirty) saveComposition();
    };
    window.addEventListener('pagehide', onPageHide);

    // The library first: a mounted project's `src` values name its assets.
    const library = attachLibrary(world, dir);
    attachAi(world, library);
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
      if (text !== undefined ? composition.holds(text) : code === mountedCode) return;
      // Unwritten edits belong to the outgoing stage; save them before its entities go.
      if (compositionDirty) saveComposition();
      // The old render goes first: there is only one stage per world.
      unmount();
      mounted = mount(code, world);
      mountedCode = code;
      if (text !== undefined) composition.adopt(text);
      setInspectEntries(world, mounted.inspect);
      writer = createEditWriter(world);
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
      const compiling: Promise<{ result: CompileResult; text?: string | null }> = composition.read(() => compileProject(dir));
      const loading = library.load();

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
  onMount(() => setSidebarTab("assets"));

  return (
    <div class={cx("bg-canvas w-full overflow-hidden", inGuestMode() ? "h-full" : "h-screen")}>
      <EditorDock />
      <Show when={!uiVisible()}>
        <FloatingProjectHeader />
      </Show>
      <EditorTour />
      <WorkflowsHost />
    </div>
  );
}
