/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Off the desktop build there is no shell, so these are no-ops rather than errors.

import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";

export async function revealPath(path: string): Promise<void> {
  if (!window.desktop || !path) return;
  await mainBridge.call(MAIN_CHANNELS.APP_SHOW_IN_FOLDER, { path });
}
