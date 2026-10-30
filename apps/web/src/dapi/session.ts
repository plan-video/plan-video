/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Handlers register once for the app's lifetime, so project-bound ones read this slot per request
// rather than closing over a world at registration time.

import { createSignal } from "solid-js";
import { DapiError } from "@plan.video/dapi";

import type { Accessor } from "solid-js";
import type { World } from "koota";
import type { Engine } from "@/engine";

// Structural on purpose: no dependency on the Solid context it comes from.
export type OpenProject = {
  dir: () => string;
};

export type EditorSession = { world: World; project: OpenProject; engine: Engine };

const [session, setSession] = createSignal<EditorSession | null>(null);

export const editorSession: Accessor<EditorSession | null> = session;

export const setEditorSession = setSession;

export function requireEditorSession(): EditorSession {
  const current = session();
  if (!current) throw new DapiError("no-project", "No project open — open one first (`dapi open <dir>`).");
  return current;
}
