/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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

export function handOffFiles(files: File[]) {
  waitingFiles = files;
}

export function takeHandedFiles(): File[] | null {
  const handed = waitingFiles;
  waitingFiles = null;
  return handed;
}

/** A post's words handed over with its project, such as a clip's caption and title. */
type HandedWords = { key: string; caption: string; title: string };

let waitingWords: HandedWords | null = null;

export function handOffWords(words: HandedWords) {
  waitingWords = words;
}

/** The words handed with project `key`, once. */
export function takeHandedWords(key: string): HandedWords | null {
  const handed = waitingWords?.key === key ? waitingWords : null;
  waitingWords = null;
  return handed;
}
