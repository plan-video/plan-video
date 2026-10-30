/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type EditCommands = {
  undo: () => void;
  redo: () => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
};

let current: EditCommands | null = null;

export function registerEditCommands(commands: EditCommands): () => void {
  current = commands;
  return () => {
    if (current === commands) current = null;
  };
}

export function editCommands(): EditCommands | null {
  return current;
}

export function isTextTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(target.type);
  }
  return target instanceof HTMLElement && target.isContentEditable;
}
