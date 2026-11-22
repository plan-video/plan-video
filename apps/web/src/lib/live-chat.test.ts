/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { words, wrapTokens, type ChatToken } from "./live-chat";

// Every letter is 10 wide, so widths are easy to read.
const measure = (text: string) => text.length * 10;
const text = (value: string): ChatToken[] =>
  words(value).map((word) => ({ kind: "text", text: word.text, width: measure(word.text), font: "", color: "", space: word.space }));

const lines = (placed: ReturnType<typeof wrapTokens>["placed"]) => {
  const out: string[] = [];
  for (const token of placed) {
    if (token.kind !== "text") continue;
    out[token.line] = (out[token.line] ?? "") + token.text;
  }
  return out;
};

describe("wrapTokens", () => {
  it("wraps between words and drops the space at the break", () => {
    const result = wrapTokens(text("aa bb cc"), 50, measure);
    expect(lines(result.placed)).toEqual(["aa bb", "cc"]);
    expect(result.lines).toBe(2);
    expect(result.width).toBe(50);
  });

  it("breaks a word longer than a line between its letters", () => {
    const result = wrapTokens(text("abcdefgh"), 30, measure);
    expect(lines(result.placed)).toEqual(["abc", "def", "gh"]);
  });

  it("keeps a badge on the line it starts", () => {
    const badge: ChatToken = { kind: "badge", width: 20, height: 18, image: {} as HTMLImageElement };
    const result = wrapTokens([badge, ...text("name hi")], 60, measure);
    expect(result.placed[0]).toMatchObject({ kind: "badge", x: 0, line: 0 });
    expect(lines(result.placed)).toEqual(["name", "hi"]);
  });

  it("measures no trailing space", () => {
    expect(wrapTokens(text("hi "), 100, measure).width).toBe(20);
  });
});
