/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { loadPinterestBoardNames } from "@/lib/pinterest";
import { workspaceKey } from "@/lib/workspaces";

const MAX_BOARDS = 8;
/** Long enough for any real board: a name cut short would miss it and make a new board. */
export const BOARD_NAME_MAX = 180;

const [boards, setBoards] = createSignal<string[]>([]);
let loadedKey: string | undefined;

/** The boards on the accounts connected, by connection id, read from Pinterest. */
const [accountBoards, setAccountBoards] = createSignal<Record<string, readonly string[]>>({});
const asked = new Set<string>();

/** What's on the accounts first, then names typed before that aren't yet. */
export function pinterestBoards(): string[] {
  const seen = new Set<string>();
  return [...Object.values(accountBoards()).flat(), ...boards()].filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanBoardName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, BOARD_NAME_MAX);
}

/** Once a page load for each account. Typing a name still works when it can't be read. */
export function loadAccountBoards(connectionIds: readonly string[]) {
  for (const id of connectionIds) {
    if (asked.has(id)) continue;
    asked.add(id);
    void loadPinterestBoardNames(id)
      .then((names) => setAccountBoards((current) => ({ ...current, [id]: names })))
      .catch(() => asked.delete(id));
  }
}

/** `loadPinterestBoards` does nothing when this key is already loaded. */
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
