/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The Pinterest boards posts went to, newest first, so the next pin can pick
// one in a click. Until Pinterest is connected these are names as typed.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { workspaceKey } from "@/lib/workspaces";

const MAX_BOARDS = 8;

const [boards, setBoards] = createSignal<string[]>([]);
let loadedKey: string | undefined;

export { boards as pinterestBoards };

export function cleanBoardName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 50);
}

/** Reads the account copy again. `loadPinterestBoards` does nothing when this key is already loaded. */
export function reloadPinterestBoards(userId: string | undefined) {
  loadedKey = undefined;
  loadPinterestBoards(userId);
}

/** Reads the active workspace, so calling this in an effect reloads after a switch. */
export function loadPinterestBoards(userId: string | undefined) {
  if (!userId) {
    loadedKey = undefined;
    setBoards([]);
    return;
  }
  const key = workspaceKey("plan.video.pinterest-boards", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    setBoards(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === "string" && !!name).slice(0, MAX_BOARDS) : []);
  } catch {
    setBoards([]);
  }
}

export function rememberPinterestBoard(raw: string) {
  const name = cleanBoardName(raw);
  if (!loadedKey || !name) return;
  setBoards((current) => [name, ...current.filter((board) => board.toLowerCase() !== name.toLowerCase())].slice(0, MAX_BOARDS));
  try {
    localStorage.setItem(loadedKey, JSON.stringify(boards()));
  } catch {
    // Storage full or blocked: the list holds until the page reloads.
    return;
  }
  queueAccountSync();
}
