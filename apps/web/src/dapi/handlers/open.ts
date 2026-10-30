/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isAbsoluteSource } from "@plan.video/assets";
import { DapiError } from "@plan.video/dapi";

import type { ToolHandler } from "../handler";

// Relative paths are refused: the app has no working directory (the CLI
// resolves one first), and it would otherwise surface as an ENOENT from mkdir.
export const open: ToolHandler<"open"> = ({ dir }, ctx) => {
  if (!isAbsoluteSource(dir)) {
    throw new DapiError("invalid-input", `The project folder must be an absolute path (got "${dir}").`);
  }
  return ctx.app.openProject(dir);
};
