/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Bold and italic for captions. Networks take plain text only, so the letters
// are swapped for Unicode's sans-serif bold and italic ones, which every
// network shows. Anything outside A–Z, a–z and 0–9 stays as it is.

export type TextStyle = "bold" | "italic";

type Look = { base: string; bold: boolean; italic: boolean };

/** Where each look's A, a and 0 start. Unicode has no italic digits. */
const STARTS: Record<"bold" | "italic" | "both", [number, number, number | null]> = {
  bold: [0x1d5d4, 0x1d5ee, 0x1d7ec],
  italic: [0x1d608, 0x1d622, null],
  both: [0x1d63c, 0x1d656, null],
};

const LOOKS = new Map<string, Look>();
const DRAWN = new Map<string, string>();

const drawnKey = (base: string, bold: boolean, italic: boolean) => `${base}${bold ? "b" : ""}${italic ? "i" : ""}`;

for (const [first, count, slot] of [
  ["A", 26, 0],
  ["a", 26, 1],
  ["0", 10, 2],
] as const) {
  for (let i = 0; i < count; i++) {
    const base = String.fromCodePoint(first.codePointAt(0)! + i);
    LOOKS.set(base, { base, bold: false, italic: false });
    DRAWN.set(drawnKey(base, false, false), base);
    for (const [name, bold, italic] of [
      ["bold", true, false],
      ["italic", false, true],
      ["both", true, true],
    ] as const) {
      const start = STARTS[name][slot];
      if (start === null) continue;
      const char = String.fromCodePoint(start + i);
      LOOKS.set(char, { base, bold, italic });
      DRAWN.set(drawnKey(base, bold, italic), char);
    }
  }
}

function draw(look: Look, bold: boolean, italic: boolean): string {
  return DRAWN.get(drawnKey(look.base, bold, italic)) ?? DRAWN.get(drawnKey(look.base, bold, false))!;
}

/** Whether every letter in the text that can take the style has it. */
export function hasStyle(text: string, style: TextStyle): boolean {
  const looks = [...text].map((char) => LOOKS.get(char)).filter((look) => look && (style === "bold" || !/\d/.test(look.base)));
  return looks.length > 0 && looks.every((look) => look![style]);
}

/** Turns the style on for the whole text, or off when it's all styled already. Keeps the other style. */
export function toggleStyle(text: string, style: TextStyle): string {
  const on = !hasStyle(text, style);
  return [...text]
    .map((char) => {
      const look = LOOKS.get(char);
      if (!look) return char;
      return draw(look, style === "bold" ? on : look.bold, style === "italic" ? on : look.italic);
    })
    .join("");
}
