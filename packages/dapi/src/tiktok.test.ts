/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { toolByName } from "./catalog";
import { checkTikTokCreator, promotionFlags, tiktokConsent, TIKTOK_BRANDED_POLICY, TIKTOK_MUSIC_USAGE } from "./tiktok";

const creator = {
  nickname: "Ada",
  privacy: ["public", "followers", "private"],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
  maxVideoSeconds: 600,
};
const choices = { privacy: "public", comments: true, duet: true, stitch: true, brandedContent: false };

describe("tiktokConsent", () => {
  it("names the Music Usage Confirmation, and the Branded Content Policy for branded content", () => {
    expect(tiktokConsent(false)).toContain(TIKTOK_MUSIC_USAGE);
    expect(tiktokConsent(false)).not.toContain(TIKTOK_BRANDED_POLICY);
    expect(tiktokConsent(true)).toContain(TIKTOK_MUSIC_USAGE);
    expect(tiktokConsent(true)).toContain(TIKTOK_BRANDED_POLICY);
  });
});

describe("promotionFlags", () => {
  it("stores each answer as the post screen does", () => {
    expect(promotionFlags("none")).toEqual({ yourBrand: false, brandedContent: false });
    expect(promotionFlags("your_brand")).toEqual({ yourBrand: true, brandedContent: false });
    expect(promotionFlags("branded_content")).toEqual({ yourBrand: false, brandedContent: true });
    expect(promotionFlags("both")).toEqual({ yourBrand: true, brandedContent: true });
  });
});

describe("checkTikTokCreator", () => {
  it("passes choices the account allows", () => {
    expect(checkTikTokCreator(choices, creator, 30)).toEqual({ choices, errors: [], warnings: [] });
  });

  it("refuses a privacy the account doesn't offer, and lists the ones it does", () => {
    const { errors } = checkTikTokCreator({ ...choices, privacy: "friends" }, creator, 30);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("public, followers, private");
  });

  it("refuses private branded content", () => {
    const { errors } = checkTikTokCreator({ ...choices, privacy: "private", brandedContent: true }, creator, 30);
    expect(errors.join(" ")).toContain("can't be private");
  });

  it("refuses a video past the account's limit, and lets pictures through", () => {
    expect(checkTikTokCreator(choices, { ...creator, maxVideoSeconds: 60 }, 61).errors.join(" ")).toContain("up to 60 seconds");
    expect(checkTikTokCreator(choices, { ...creator, maxVideoSeconds: 60 }, null).errors).toEqual([]);
  });

  it("turns off what the account turned off, and says so", () => {
    const result = checkTikTokCreator(choices, { ...creator, commentDisabled: true, stitchDisabled: true }, 30);
    expect(result.errors).toEqual([]);
    expect(result.choices).toEqual({ ...choices, comments: false, stitch: false });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Comments and Stitch are");
  });

  it("keeps Duet and Stitch out of the warning for pictures", () => {
    const result = checkTikTokCreator(choices, { ...creator, duetDisabled: true }, null);
    expect(result.choices.duet).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe("TikTok posting tools", () => {
  it("ask for the promotion answer and the person's yes", () => {
    const tiktok = toolByName("schedule_post").input.shape.tiktok.unwrap().shape;
    expect(Object.keys(tiktok)).toEqual(expect.arrayContaining(["privacy", "promotion", "agreed"]));
    expect("tiktok" in toolByName("copy_post").input.shape).toBe(true);
    expect("agreed" in toolByName("publish_post").input.shape).toBe(true);
    expect(toolByName("tiktok_creator").environment).toBe("renderer");
  });
});
