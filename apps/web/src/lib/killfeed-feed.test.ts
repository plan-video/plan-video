/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";

import { createFeed, MAX_FEED_ENTRIES } from "./killfeed-feed";

describe("createFeed", () => {
  it("keeps every kill found in a video, though only so many are added by hand", () => {
    const feed = createFeed({ id: 0 });
    const found = Array.from({ length: MAX_FEED_ENTRIES + 4 }, (_, id) => ({ id }));

    feed.replace(found);
    feed.add();

    expect(feed.entries().map(({ id }) => id)).toEqual(found.map(({ id }) => id));
  });
});
