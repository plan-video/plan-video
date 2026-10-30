/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Once an agent has connected, tool file writes are not echoed as edits and the window may stay hidden.

let headless = false;

export function isHeadless(): boolean {
  return headless;
}

export function enableHeadless(): void {
  headless = true;
}
