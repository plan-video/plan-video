#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//   node scripts/emoji-data.mjs                     fetches emoji-test.txt for VERSION
//   node scripts/emoji-data.mjs path/emoji-test.txt reads a copy already downloaded
// VERSION stays a step behind the newest: Windows and older phones draw new emoji as empty boxes.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "15.1";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps/web/src/lib/emoji-data.ts");

const GROUPS = {
  "Smileys & Emotion": "smileys",
  "People & Body": "people",
  "Animals & Nature": "nature",
  "Food & Drink": "food",
  "Travel & Places": "travel",
  Activities: "activities",
  Objects: "objects",
  Symbols: "symbols",
  Flags: "flags",
};
const TONES = ["light skin tone", "medium-light skin tone", "medium skin tone", "medium-dark skin tone", "dark skin tone"];

const [file] = process.argv.slice(2);
const text = file
  ? readFileSync(file, "utf8")
  : await fetch(`https://unicode.org/Public/emoji/${VERSION}/emoji-test.txt`).then((response) => {
      if (!response.ok) throw new Error(`emoji-test.txt: ${response.status}`);
      return response.text();
    });

const version = text.match(/^# Version: ([\d.]+)/m)?.[1];
if (!version) throw new Error("That doesn't look like emoji-test.txt.");

const groups = [];
const byName = new Map();
const toned = [];
let group = null;

for (const line of text.split("\n")) {
  const heading = line.match(/^# group: (.+)$/);
  if (heading) {
    const id = GROUPS[heading[1]];
    group = id ? { id, emoji: [] } : null;
    if (group) groups.push(group);
    continue;
  }
  const row = line.match(/^[0-9A-F ]+;\s*fully-qualified\s*#\s*(\S+)\s+E[\d.]+\s+(.+)$/);
  if (!row || !group) continue;
  const [, emoji, name] = row;

  // "man: light skin tone, red hair" is a tone of "man: red hair". Mixed tones (two people's) stay out.
  const cut = name.indexOf(": ");
  const parts = cut === -1 ? [] : name.slice(cut + 2).split(", ");
  const tones = parts.filter((part) => TONES.includes(part));
  if (tones.length) {
    if (tones.length === 1) {
      const rest = parts.filter((part) => !TONES.includes(part));
      toned.push({ base: rest.length ? `${name.slice(0, cut)}: ${rest.join(", ")}` : name.slice(0, cut), tone: TONES.indexOf(tones[0]), emoji });
    }
    continue;
  }
  const entry = [emoji, name];
  group.emoji.push(entry);
  byName.set(name, entry);
}

for (const { base, tone, emoji } of toned) {
  const entry = byName.get(base);
  if (!entry) throw new Error(`No emoji called "${base}" for its ${TONES[tone]}.`);
  entry[2] ??= [];
  entry[2][tone] = emoji;
}
for (const entry of byName.values()) {
  if (entry[2] && entry[2].filter(Boolean).length !== TONES.length) throw new Error(`"${entry[1]}" is missing a skin tone.`);
}

const count = groups.reduce((sum, { emoji }) => sum + emoji.length, 0);
const body = groups.map(({ id, emoji }) => `  { group: ${JSON.stringify(id)}, emoji: ${JSON.stringify(emoji)} },`).join("\n");

writeFileSync(
  OUT,
  `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Written by scripts/emoji-data.mjs from Unicode's emoji-test.txt ${version}; run it
// again rather than editing this. ${count} emoji, each with its name and, where it has
// them, its five skin tones from light to dark.
//
// The emoji, their names and their order are Unicode's data:
// © Unicode®, Inc. Unicode and the Unicode Logo are registered trademarks of
// Unicode, Inc. in the U.S. and other countries. Used under the Unicode License,
// https://www.unicode.org/license.txt

export type EmojiGroup = ${Object.values(GROUPS)
    .map((id) => JSON.stringify(id))
    .join(" | ")};

export type Emoji = readonly [emoji: string, name: string, tones?: readonly string[]];

export const EMOJI: readonly { group: EmojiGroup; emoji: readonly Emoji[] }[] = [
${body}
];
`,
);

console.log(`${OUT}: ${count} emoji in ${groups.length} groups, ${toned.length} skin tones (Unicode ${version})`);
