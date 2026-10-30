/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The browser may clear stored projects when the disk runs low; persistent storage stops that.
// Asked for when something worth keeping is first saved, since few people open the setting.

let asked = false;

/** Once per visit. Chrome decides on its own; Firefox shows a prompt. */
export function keepBrowserStorage() {
  if (asked || window.desktop || !navigator.storage?.persist) return;
  asked = true;
  void navigator.storage
    .persisted()
    .then((already) => already || navigator.storage.persist())
    .catch(() => undefined);
}
