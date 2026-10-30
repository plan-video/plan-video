/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createEffect, createMemo, createResource } from 'solid-js';
import { Navigate, useLocation, useNavigate } from '@solidjs/router';
import { AppContextMenu } from '@/components/app-context-menu';
import { EditorPage } from './editor';
import { LayoutProvider } from "@/context/layout";
import { PromptInputProvider } from "@/context/prompt-input";
import { EditorApiProvider } from '@/dapi';
import { ExportProvider } from '@/context/export';
import { ProjectProvider } from '@/context/project';
import { appRoute, projectRoute, useProjectRef } from '@/hooks/use-project-route';
import { resolveProject } from '@/projects';
import { TimelineProvider } from '@/context/timeline';
import { EngineProvider } from '@/engine';

export function ProjectPage() {
  const ref = useProjectRef();
  const navigate = useNavigate();
  const location = useLocation();

  // Rewriting the URL to the id changes the ref but not the project, so the lookup holds what it answered:
  // refetching would tear the editor down and rebuild it for the same project.
  let resolvedId = '';
  const target = createMemo<string>((previous) => {
    const next = ref();
    return previous && next === resolvedId ? previous : next;
  }, '');

  // main resolves the folder: the URL carries the id, and the folder it names can be renamed under the link.
  const [project] = createResource(target, resolveProject);

  // A URL naming the folder (an old link or bookmark) is swapped for the id one, so the next rename leaves it alone.
  createEffect(() => {
    const id = project()?.id;
    if (!id) return;
    resolvedId = id;
    if (id !== ref()) navigate(projectRoute(id), { replace: true, state: location.state });
  });

  return (
    // Keyed on the project, not its folder: a rename must not tear down the world being worked in.
    <Show when={!project.loading}>
      <Show when={project()} keyed fallback={<Navigate href={appRoute("projects")} />}>
        {(found) => (
          <ProjectProvider project={found}>
            <EngineProvider projectId={found.id}>
              <EditorApiProvider>
                <TimelineProvider>
                  <ExportProvider>
                    <PromptInputProvider>
                      <LayoutProvider>
                        <AppContextMenu>
                          <EditorPage />
                        </AppContextMenu>
                      </LayoutProvider>
                    </PromptInputProvider>
                  </ExportProvider>
                </TimelineProvider>
              </EditorApiProvider>
            </EngineProvider>
          </ProjectProvider>
        )}
      </Show>
    </Show>
  )
}
