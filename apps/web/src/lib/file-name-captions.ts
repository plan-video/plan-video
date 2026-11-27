/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

const STORAGE_KEY = "plan.file-name-captions";

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const [enabled, setEnabled] = createSignal(stored());

/** On until the user turns it off: a new post's media fills an empty title and caption with its file name. */
export const fileNameCaptions = enabled;

export function setFileNameCaptions(next: boolean) {
  setEnabled(next);
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Storage can be off (private windows); the choice then lasts the session.
  }
}
