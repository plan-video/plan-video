/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// On Windows `npm` is a `.cmd` shim, which execFileSync can't start without a shell;
// on POSIX a shell would only get in the way of the arguments.

import { execFileSync } from "node:child_process";

const WINDOWS = process.platform === "win32";

export function npm(args, options = {}) {
  return execFileSync(WINDOWS ? "npm.cmd" : "npm", args, {
    stdio: "inherit",
    ...options,
    shell: WINDOWS,
  });
}
