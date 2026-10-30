/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A saved post opened in New post, to finish it or to post it once more, or
// files from the media library to post. New post takes them when it opens.

import type { StoredEvent } from "@/components/calendar/types";

/** `replace` saves the composer over the post. Without it, the composer makes a copy. */
type HandOff = { post: StoredEvent; replace: boolean };

let waiting: HandOff | null = null;

export function handOffPost(post: StoredEvent, replace: boolean) {
  waiting = { post, replace };
}

export function takeHandOff(): HandOff | null {
  const handed = waiting;
  waiting = null;
  return handed;
}

let waitingFiles: File[] | null = null;

/** Files from the media library, for New post to put in the post it has open. */
export function handOffFiles(files: File[]) {
  waitingFiles = files;
}

export function takeHandedFiles(): File[] | null {
  const handed = waitingFiles;
  waitingFiles = null;
  return handed;
}
