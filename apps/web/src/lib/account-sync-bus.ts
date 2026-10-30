/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The account sync module and the stores talk through here, so neither
// imports the other in a circle.

import { createSignal } from "solid-js";

let pending: Promise<void> = Promise.resolve();
let teamPending: Promise<void> = Promise.resolve();
let postsPending: Promise<void> = Promise.resolve();
/** Remote copies being written now: the account's, and a shared workspace's. */
let applying = 0;
/** A local save came while a remote copy was being written. */
let missed = false;
const listeners = new Set<() => void>();

const [notificationTick, setNotificationTick] = createSignal(0);

/** Bumped when saved notices are replaced from the account. */
export { notificationTick };

export function bumpNotifications() {
  setNotificationTick((n) => n + 1);
}

/** Hydrate waits on this, so the calendar opens onto the account's posts, or the shared workspace's. */
export async function waitForAccountSync() {
  // Read after the listeners of a switch have all run, so the read of the workspace just opened counts.
  await Promise.resolve();
  await Promise.all([pending, teamPending, postsPending]);
}

export function setAccountSyncPending(promise: Promise<void>) {
  pending = promise;
}

/** The first read of a shared workspace just opened (lib/team-sync.ts). */
export function setTeamSyncPending(promise: Promise<void>) {
  teamPending = promise;
}

/** The first read of the open workspace's posts (lib/post-sync.ts). */
export function setPostSyncPending(promise: Promise<void>) {
  postsPending = promise;
}

/** True while a remote copy is being written into this browser. */
export function accountApplying() {
  return applying > 0;
}

export function setAccountApplying(value: boolean) {
  applying = Math.max(0, applying + (value ? 1 : -1));
  // A save made while the remote copy was written goes once it's in. If it was only that write echoing, there's nothing to push.
  if (!applying && missed) {
    missed = false;
    for (const listener of listeners) listener();
  }
}

/** Runs `listener` on every local save. Returns the unsubscribe. */
export function onAccountEdited(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A local save. One made while a remote copy is being written waits for that to finish, so the write can't echo straight back. */
export function queueAccountSync() {
  if (applying) {
    missed = true;
    return;
  }
  for (const listener of listeners) listener();
}
