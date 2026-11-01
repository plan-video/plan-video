/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { rankMatches } from "./search-rank";

const SCORES: Record<string, Record<string, number>> = {
  anal: { Calendar: 0.1, Analytics: 0.9, "Post analytics": 0.5, "Platform analytics": 0.5 },
};
const PAGES = ["Calendar", "Post analytics", "Platform analytics", "Analytics", "Billing"];
const rank = (query: string) => rankMatches(PAGES, query, (page) => page, (text, search) => SCORES[search]?.[text] ?? 0);

describe("rankMatches", () => {
  it("puts the best match first, wherever it sits in the list", () => {
    expect(rank("anal")[0]).toBe("Analytics");
    expect(rank("anal").at(-1)).toBe("Calendar");
  });

  it("keeps the list's order between equal matches", () => {
    expect(rank("anal").slice(1, 3)).toEqual(["Post analytics", "Platform analytics"]);
  });

  it("drops what doesn't match", () => {
    expect(rank("anal")).not.toContain("Billing");
    expect(rank("zzzzq")).toEqual([]);
  });

  it("keeps the whole list in order with nothing typed", () => {
    expect(rank("")).toEqual(PAGES);
    expect(rank("   ")).toEqual(PAGES);
  });
});
