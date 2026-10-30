/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `@inspect number min=0 max=100 step=1` in a JSDoc on a top-level const makes it editable from the
 * inspector; `path="Group/Label"` and `label=` are presentation only. The initializer must be a plain
 * literal (the editor overwrites it), and the variable can't be exported: importers would get the accessor.
 */

import type { Accessor } from "solid-js";

export const INSPECT_TAG = "inspect";

export const INSPECT_TYPES = ["number", "color", "text", "font", "boolean", "select"] as const;

export type InspectType = (typeof INSPECT_TYPES)[number];

export type InspectValue = string | number | boolean;

/** `path` is the authored `path` (or `label`) split into segments. */
export interface InspectDeclaration {
  /** Project-relative file the variable is declared in. */
  file: string;
  /** With `file`, the variable's identity. */
  name: string;
  type: InspectType;
  path?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** What a `select` chooses between, in the authored order. */
  options?: string[];
}

function hostOnly(name: string): never {
  throw new Error(
    `${name} is implemented by the editor's renderer and only works inside a mounted project.`,
  );
}

/** Never authored by hand: the compile step injects the call; the mount substitutes this declaration. */
export function __inspect(declaration: InspectDeclaration, initial: InspectValue): Accessor<InspectValue> {
  void declaration;
  void initial;
  return hostOnly("__inspect");
}
