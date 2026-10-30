/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { Project } from "@plan.video/runtime";
import { AGENTIC_EDITING, connectorEnabled, setEditorRunner } from "@/ai-editor/connector";
import { runTool } from "@/ai-editor/tools";
import { useProject } from "@/context/project";
import { useEngineContext } from "@/engine";
import { useFullscreenState } from "@/hooks/use-fullscreen-state";
import { assert } from "@/utils/common";
import { setEditorSession } from "./session";

import type { JSX, Accessor } from "solid-js";

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

export function EditorApiProvider(props: { children: JSX.Element }) {
  const project = useProject();
  const isFullscreen = useFullscreenState();
  const world = useWorld();
  const engine = useEngineContext();

  createEffect(() => {
    if (!window.desktop || project.id() !== world.get(Project)?.id) return;

    setEditorSession({ world, project, engine });
    onCleanup(() => setEditorSession(null));
  });

  // On the website, agents reach the project through the tab's connector instead.
  createEffect(() => {
    if (!AGENTIC_EDITING || !connectorEnabled || project.id() !== world.get(Project)?.id) return;
    const ctx = { world, dir: project.dir() };
    setEditorRunner((tool, args) => runTool(ctx, tool, args));
    onCleanup(() => setEditorRunner(null));
  });

  return (
    <EditorApiContext.Provider value={{ isFullscreen, isDesktop: !!window.desktop }}>
      {props.children}
    </EditorApiContext.Provider>
  );
}

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
