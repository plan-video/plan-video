/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A caption look saved once and put on any caption after: the preset and its
// colors, font, paints, position, pacing and animations, and the color
// keywords are highlighted in. New auto-captions start from it. Saved on the
// account, one per workspace, like the templates. Reading a look off a
// caption and putting one on is caption-look.ts: the account's copy loads
// this file on every dashboard page, and the editor's runtime stays out of it.

import { createSignal } from "solid-js";

import { queueAccountSync } from "@/lib/account-sync-bus";
import { ownerOf } from "@/lib/guest";
import { workspaceKey } from "@/lib/workspaces";

import type { PropValue } from "@plan.video/jsx";
import type { AuthoredTree } from "@plan.video/reconciler";

/** A caption's look, as the file spells it. */
export type CaptionLook = {
  /** The caption's own props that make its look. */
  props: Record<string, PropValue>;
  /** Paints, strokes, shadows and animations under it. */
  children: AuthoredTree[];
};

export type CaptionBrandStyle = CaptionLook & {
  id: string;
  /** What keywords are highlighted in. */
  highlight: number;
  updatedAt: string;
};

/** One brand style per workspace, kept as a list so the account merges it like the rest. */
const BRAND_ID = "brand";

/** Yellow reads on light and dark footage alike. */
export const DEFAULT_HIGHLIGHT = 0xffd60a;

const [items, setItems] = createSignal<CaptionBrandStyle[]>([]);
let loadedKey: string | undefined;

/** The brand style of the active workspace, if one was saved. */
export const captionBrandStyle = () => items().find((item) => item.id === BRAND_ID);

function readStyle(value: unknown): CaptionBrandStyle | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CaptionBrandStyle>;
  if (typeof row.id !== "string" || !row.props || typeof row.props !== "object") return null;
  return {
    id: row.id,
    props: row.props,
    children: Array.isArray(row.children) ? row.children : [],
    highlight: typeof row.highlight === "number" ? row.highlight : DEFAULT_HIGHLIGHT,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date(0).toISOString(),
  };
}

/** Reads the account copy again. `loadCaptionStyles` does nothing when this key is already loaded. */
export function reloadCaptionStyles(userId: string | undefined) {
  loadedKey = undefined;
  loadCaptionStyles(userId);
}

/** Reads the active workspace's, so a load inside an effect reloads after a switch. */
export function loadCaptionStyles(userId: string | undefined) {
  userId = ownerOf(userId);
  if (!userId) {
    loadedKey = undefined;
    setItems([]);
    return;
  }
  const key = workspaceKey("plan.video.caption-styles", userId);
  if (loadedKey === key) return;
  loadedKey = key;
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    setItems(Array.isArray(parsed) ? parsed.map(readStyle).filter((row): row is CaptionBrandStyle => !!row) : []);
  } catch {
    setItems([]);
  }
}

function write(next: CaptionBrandStyle[]): boolean {
  const key = loadedKey;
  if (!key) return false;
  setItems(next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    return false;
  }
  queueAccountSync();
  return true;
}

/** Saves `look` as the brand style. False when it could not be kept. */
export function saveCaptionBrandStyle(look: CaptionLook, highlight = captionBrandStyle()?.highlight ?? DEFAULT_HIGHLIGHT): boolean {
  const style: CaptionBrandStyle = { id: BRAND_ID, ...look, highlight, updatedAt: new Date().toISOString() };
  return write([...items().filter((item) => item.id !== BRAND_ID), style]);
}

/** Keeps the highlight color with the brand style, when there is one. */
export function setBrandHighlight(highlight: number): void {
  const style = captionBrandStyle();
  if (!style || style.highlight === highlight) return;
  write(items().map((item) => (item.id === BRAND_ID ? { ...item, highlight, updatedAt: new Date().toISOString() } : item)));
}
