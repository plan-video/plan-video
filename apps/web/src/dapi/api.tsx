/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, onCleanup } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { Project } from "@plan.video/runtime";
import { AGENTIC_EDITING, connectorEnabled, setEditorRunner } from "@/ai-editor/connector";
import { runTool } from "@/ai-editor/tools";
import { useProject } from "@/context/project";

import type { JSX } from "solid-js";

/** Agents reach the open project through the tab's connector. */
export function EditorApiProvider(props: { children: JSX.Element }) {
  const project = useProject();
  const world = useWorld();

  createEffect(() => {
    if (!AGENTIC_EDITING || !connectorEnabled || project.id() !== world.get(Project)?.id) return;
    const ctx = { world, dir: project.dir() };
    setEditorRunner((tool, args) => runTool(ctx, tool, args));
    onCleanup(() => setEditorRunner(null));
  });

  return props.children;
}
