/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { DapiError } from "@plan.video/dapi";
import { useAuth } from "@/context/auth";
import { openProjectFolder } from "@/projects";
import { projectRoute } from "@/hooks/use-project-route";
import { toolBridge } from "./bridge";
import { handlers } from "./handlers";
import { editorSession, requireEditorSession } from "./session";

import type { ContextFactory } from "./bridge";

/**
 * Must sit inside the router tree (for `useNavigate`) and the auth provider.
 * Kept out of the editor shell module so the dashboard can paint before this
 * graph (export, capture, the engine) is compiled.
 */
export function EditorApi() {
  const navigate = useNavigate();
  const auth = useAuth();

  const context: ContextFactory = (signal) => ({
    session: editorSession,
    requireSession: requireEditorSession,
    signal,
    app: {
      async openProject(dir) {
        const project = await openProjectFolder(dir);
        navigate(projectRoute(project.id || project.name));
        return { id: project.id, name: project.displayName, dir: project.dir };
      },
      requireUser(reason) {
        const user = auth.user();
        if (!user) throw new DapiError("sign-in-required", reason ?? "Sign in required: AI generation needs a Plan Video account.");
        return user;
      },
    },
  });

  onCleanup(toolBridge.register(handlers, context));
  return null;
}
