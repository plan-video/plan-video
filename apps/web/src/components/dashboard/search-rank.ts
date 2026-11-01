/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** cmdk-solid filters but never reorders, so without this a weak match higher up the list takes Enter. */
export function rankMatches<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
  score: (text: string, query: string) => number,
): T[] {
  const search = query.trim();
  if (!search) return [...items];
  return items
    .map((item) => ({ item, score: score(textOf(item), search) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.item);
}
