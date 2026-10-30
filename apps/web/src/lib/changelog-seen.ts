/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A browser seeing the dashboard for the first time starts from today's newest, so a new account
// isn't told about everything before it.

import { createSignal } from "solid-js";

import { site } from "./site";

const KEY = "plan.video.changelog-seen";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Without storage the dot just never shows.
  }
}

const [seen, setSeen] = createSignal(read());
const [newest, setNewest] = createSignal<string>();

// What's new opens in another tab; the dot here goes out with it.
if (typeof window !== "undefined") window.addEventListener("storage", (event) => event.key === KEY && setSeen(event.newValue));

/** True once the newest entry is known and this browser hasn't opened What's new since. */
export const changelogUnread = () => {
  const id = newest();
  return !!id && seen() !== null && seen() !== id;
};

let watching = false;
/** Loads the list on its own so the dashboard bundle doesn't carry it. */
export function watchChangelog() {
  if (watching) return;
  watching = true;
  // Without the site there is no What's new, and so no dot.
  void site?.newestChangelog().then((id) => {
    if (!id) return;
    if (seen() === null) markChangelogSeen(id);
    setNewest(id);
  });
}

/** `id` defaults to whatever the dashboard last learned. */
export function markChangelogSeen(id = newest()) {
  if (!id) return;
  write(id);
  setSeen(id);
}
