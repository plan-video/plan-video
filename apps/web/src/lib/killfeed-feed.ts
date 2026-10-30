/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { createStore, produce, type SetStoreFunction } from "solid-js/store";

/** As many as Valorant's shows at once. */
export const MAX_FEED_ENTRIES = 7;

/** Read in full, so a drawing redraws when any setting changes. */
export const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export type Feed<T> = {
  entries: () => T[];
  selected: () => number;
  spec: () => T;
  /** As a store's setter would. */
  set: SetStoreFunction<T>;
  update: (change: (entry: T) => void) => void;
  select: (index: number) => void;
  /** Copies the edited entry in under it, changed by `next`, and edits the copy. */
  add: (next?: (copy: T) => void) => void;
  /** Then edits the one above it. */
  remove: () => void;
};

export function createFeed<T extends object>(first: T): Feed<T> {
  const [feed, setFeed] = createStore<{ entries: T[] }>({ entries: [first] });
  const [selected, setSelected] = createSignal(0);
  const spec = () => feed.entries[selected()]!;
  const set = ((...args: unknown[]) => (setFeed as (...path: unknown[]) => void)("entries", selected(), ...args)) as SetStoreFunction<T>;
  return {
    entries: () => feed.entries,
    selected,
    spec,
    set,
    update: (change) => setFeed("entries", selected(), produce(change)),
    select: (index) => setSelected(Math.max(0, Math.min(feed.entries.length - 1, index))),
    add: (next) => {
      if (feed.entries.length >= MAX_FEED_ENTRIES) return;
      const at = selected() + 1;
      const copy = plain(spec());
      next?.(copy);
      setFeed("entries", (entries) => [...entries.slice(0, at), copy, ...entries.slice(at)]);
      setSelected(at);
    },
    remove: () => {
      if (feed.entries.length < 2) return;
      const at = selected();
      // The pick moves first, so nothing reads the entry while it is gone.
      setSelected(Math.max(0, at - 1));
      setFeed("entries", (entries) => entries.filter((_, index) => index !== at));
    },
  };
}

/** How much wider than the usual entry a feed grows for long names, before they give way. */
const MAX_STRETCH = 1.4;

export const USUAL_NAME = "Username";

/** All one size: the widest, between `usual` and a little wider, or `ratio` times their height to match entries already up. */
export async function drawEvenFeed<T>(
  entries: T[],
  draw: (entry: T, scale: number, width?: number) => Promise<HTMLCanvasElement>,
  usual: T,
  scale: number,
  ratio?: number,
): Promise<HTMLCanvasElement[]> {
  if (!entries.length) return [];
  const [standard, ...natural] = await Promise.all([draw(usual, 1), ...entries.map((entry) => draw(entry, 1))]);
  const height = natural[0]!.height;
  const least = standard!.width / standard!.height;
  const widest = Math.max(...natural.map((picture) => picture.width / picture.height));
  const target = ratio ?? Math.min(least * MAX_STRETCH, Math.max(least, widest));
  return Promise.all(entries.map((entry) => draw(entry, scale, target * height)));
}
