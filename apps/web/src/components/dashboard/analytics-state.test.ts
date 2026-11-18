/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { POST_COLUMNS, movePostColumn, postColumnsMoved, readPostColumns } from "./analytics-state";

describe("readPostColumns", () => {
  it("keeps a saved order", () => {
    expect(readPostColumns('["engagement","comments","likes","views"]')).toEqual(["engagement", "comments", "likes", "views"]);
  });

  it("falls back to the default order for anything unreadable", () => {
    for (const saved of [null, "", "not json", "{}", "null", "7", "[]", '[1,{"a":2}]']) {
      expect(readPostColumns(saved)).toEqual(POST_COLUMNS);
    }
  });

  it("drops unknown and repeated columns, and puts missing ones last", () => {
    expect(readPostColumns('["shares","likes","likes","views"]')).toEqual(["likes", "views", "comments", "engagement"]);
  });
});

describe("movePostColumn", () => {
  it("lands a column just before the place it was dropped on", () => {
    expect(movePostColumn(POST_COLUMNS, "views", 2)).toEqual(["likes", "views", "comments", "engagement"]);
    expect(movePostColumn(POST_COLUMNS, "engagement", 1)).toEqual(["views", "engagement", "likes", "comments"]);
  });

  it("reaches both ends", () => {
    expect(movePostColumn(POST_COLUMNS, "views", 4)).toEqual(["likes", "comments", "engagement", "views"]);
    expect(movePostColumn(POST_COLUMNS, "engagement", 0)).toEqual(["engagement", "views", "likes", "comments"]);
  });

  it("changes nothing when dropped on either side of itself", () => {
    expect(movePostColumn(POST_COLUMNS, "likes", 1)).toEqual(POST_COLUMNS);
    expect(movePostColumn(POST_COLUMNS, "likes", 2)).toEqual(POST_COLUMNS);
  });
});

describe("postColumnsMoved", () => {
  it("tells a moved order from the default one", () => {
    expect(postColumnsMoved(POST_COLUMNS)).toBe(false);
    expect(postColumnsMoved(movePostColumn(POST_COLUMNS, "views", 2))).toBe(true);
  });
});
