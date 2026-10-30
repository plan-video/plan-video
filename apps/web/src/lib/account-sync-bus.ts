/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sits between account sync and the stores so neither imports the other in a circle.

import { createSignal } from "solid-js";

let pending: Promise<void> = Promise.resolve();
let teamPending: Promise<void> = Promise.resolve();
let postsPending: Promise<void> = Promise.resolve();
/** Remote copies being written now: the account's, and a shared workspace's. */
let applying = 0;
let missed = false;
const listeners = new Set<() => void>();

const [notificationTick, setNotificationTick] = createSignal(0);

export { notificationTick };

export function bumpNotifications() {
  setNotificationTick((n) => n + 1);
}

/** So the calendar opens onto the account's posts, or the shared workspace's. */
export async function waitForAccountSync() {
  // Read after a switch's listeners have all run, so the read of the workspace just opened counts.
  await Promise.resolve();
  await Promise.all([pending, teamPending, postsPending]);
}

export function setAccountSyncPending(promise: Promise<void>) {
  pending = promise;
}

export function setTeamSyncPending(promise: Promise<void>) {
  teamPending = promise;
}

export function setPostSyncPending(promise: Promise<void>) {
  postsPending = promise;
}

export function accountApplying() {
  return applying > 0;
}

export function setAccountApplying(value: boolean) {
  applying = Math.max(0, applying + (value ? 1 : -1));
  // A save made while the remote copy was written goes once it's in; a plain echo of that write pushes nothing.
  if (!applying && missed) {
    missed = false;
    for (const listener of listeners) listener();
  }
}

export function onAccountEdited(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One made while a remote copy is being written waits, so the write can't echo straight back. */
export function queueAccountSync() {
  if (applying) {
    missed = true;
    return;
  }
  for (const listener of listeners) listener();
}
