/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the app's right-click menu does outside a text field. The menu sits
 * above every page, the editor's actions need its world, so the editor hands
 * them in while it is open.
 */
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

/** Whether `target` takes typing, so the menu's commands belong to it. */
export function isTextTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(target.type);
  }
  return target instanceof HTMLElement && target.isContentEditable;
}
