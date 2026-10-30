/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Types only, with no Node imports, so the renderer's program can include it.

import type { InspectValue, PropValue, SerializedAssetRef } from "@plan.video/jsx";

export type { PropValue, SerializedAssetRef };

export type EditValue = PropValue | SerializedAssetRef;

export interface SourceContext {
  dir: string;
  /** Lets a folder watcher tell this write apart from someone else's. */
  onWrite?: (file: string, text: string) => void;
}

export interface SourceSet {
  kind: "set";
  source: string;
  props: Record<string, EditValue>;
  text?: string;
}

/** `source` is the pending name the canvas knows the element by; the real one comes back in `ids`. */
export interface SourceInsert {
  kind: "insert";
  source: string;
  parent: string;
  tag: string;
  props: Record<string, EditValue>;
  before?: string;
  text?: string;
}

/** Both ends must be in one file. */
export interface SourceMove {
  kind: "move";
  source: string;
  parent: string;
  before?: string;
}

/** Found before anything is cut: cutting text renumbers positions. */
export interface SourceRemove {
  kind: "remove";
  source: string;
}

/** The first iteration keeps the body's own names, so it carries no `pending`. */
export type SourceIteration = Record<string, { props: Record<string, EditValue>; text?: string; pending?: string }>;

/** Nothing after this in the same write can address a looped element (see `inLoop`). */
export interface SourceUnroll {
  kind: "unroll";
  source: string;
  iterations: SourceIteration[];
}

/** Only written while the declaration still carries the annotation and holds a literal. */
export interface SourceVariable {
  kind: "variable";
  file: string;
  name: string;
  value: InspectValue;
}

export type SourceEdit = SourceSet | SourceInsert | SourceMove | SourceRemove | SourceUnroll | SourceVariable;

export interface WriteResult {
  skipped: string[];
  ids?: Record<string, string>;
  /** An unroll not listed here was declined, and the canvas takes its loop back. */
  unrolled?: string[];
  error?: string;
}
