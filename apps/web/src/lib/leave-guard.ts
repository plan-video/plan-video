/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const checks = new Set<() => boolean>();

/** The browser asks before the page goes while `check` says something would be lost. */
export function warnBeforeLeaving(check: () => boolean) {
  checks.add(check);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", (event) => {
    if ([...checks].some((check) => check())) event.preventDefault();
  });
}
