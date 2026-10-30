/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { toolByName } from "./catalog";
import { chooseAccounts } from "./social-accounts";

const tiktok = { id: "tt-1", platform: "tiktok", handle: "ada" };
const tiktok2 = { id: "tt-2", platform: "tiktok", handle: "grace" };
const x = { id: "x-1", platform: "x", handle: "ada" };

describe("chooseAccounts", () => {
  it("uses the only account on a platform", () => {
    const result = chooseAccounts(["tiktok", "x"], undefined, [tiktok, x]);
    expect(result).toEqual({ ok: true, choices: { tiktok: ["tt-1"], x: ["x-1"] }, accounts: [tiktok, x] });
  });

  it("refuses to guess when a platform has several accounts", () => {
    const result = chooseAccounts(["tiktok"], undefined, [tiktok, tiktok2]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("ada (tt-1)");
      expect(result.message).toContain("grace (tt-2)");
    }
  });

  it("uses the ids the caller named, including two on one platform", () => {
    const result = chooseAccounts(["tiktok"], ["tt-2", "tt-1"], [tiktok, tiktok2, x]);
    expect(result).toEqual({ ok: true, choices: { tiktok: ["tt-2", "tt-1"] }, accounts: [tiktok2, tiktok] });
  });

  it("refuses an id that is not connected", () => {
    const result = chooseAccounts(["x"], ["missing"], [x]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("social_accounts");
  });

  it("refuses an account on a platform the post is not going to", () => {
    const result = chooseAccounts(["x"], ["tt-1"], [tiktok, x]);
    expect(result.ok).toBe(false);
  });

  it("refuses a platform with nothing connected", () => {
    const result = chooseAccounts(["youtube"], undefined, [x], (platform) => platform.toUpperCase());
    expect(result).toEqual({ ok: false, message: "Connect YOUTUBE in Connections first." });
  });
});

describe("posting tools", () => {
  it("keeps scheduling and publishing apart", () => {
    expect(toolByName("schedule_post").description.toLowerCase()).toContain("does not publish");
    expect(toolByName("publish_post").description.toLowerCase()).toContain("cannot be undone");
    expect("publish" in toolByName("publish_post").input.shape).toBe(false);
    expect(toolByName("update_post").input.shape.caption.description).toContain("caption");
  });
});
