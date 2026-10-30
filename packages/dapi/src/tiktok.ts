/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What TikTok asks of an app before it posts to someone's profile, for agents
// as much as for the New post screen: read the account's creator info and go
// by it, ask whether the post promotes something, and have the person accept
// TikTok's terms for the post.

export const TIKTOK_MUSIC_USAGE = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
export const TIKTOK_BRANDED_POLICY = "https://www.tiktok.com/legal/page/global/bc-policy/en";

export type TikTokPromotion = "none" | "your_brand" | "branded_content" | "both";

/** The sentence the person has to see before a post goes to their profile. It names the Branded Content Policy for branded content. */
export function tiktokConsent(branded: boolean): string {
  return branded
    ? `By posting, you agree to TikTok's Branded Content Policy (${TIKTOK_BRANDED_POLICY}) and Music Usage Confirmation (${TIKTOK_MUSIC_USAGE}).`
    : `By posting, you agree to TikTok's Music Usage Confirmation (${TIKTOK_MUSIC_USAGE}).`;
}

/** The disclosure as it's stored with a post. */
export function promotionFlags(promotion: TikTokPromotion): { yourBrand: boolean; brandedContent: boolean } {
  return {
    yourBrand: promotion === "your_brand" || promotion === "both",
    brandedContent: promotion === "branded_content" || promotion === "both",
  };
}

export const PROMOTION_QUESTION =
  "TikTok needs to know whether the post promotes something. Ask the user, then pass tiktok.promotion: none; your_brand, when it promotes themselves or their own business (labelled Promotional content); branded_content, when it promotes another brand or a third party (labelled Paid partnership, and it can't be private); or both.";

/** What TikTok's creator info says an account may do, as of now. */
export type TikTokCreatorRules = {
  nickname: string;
  /** Who it may show a post to. */
  privacy: readonly string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoSeconds: number;
};

export type TikTokChoices = {
  privacy: string;
  comments: boolean;
  duet: boolean;
  stitch: boolean;
  brandedContent: boolean;
};

/**
 * Holds a post's TikTok choices to what the account allows, the way the post
 * screen does: a privacy it doesn't offer, branded content kept private or a
 * video past its limit is refused; comments, Duet and Stitch it has turned off
 * go off, with a warning. `videoSeconds` is null for pictures.
 */
export function checkTikTokCreator<T extends TikTokChoices>(
  choices: T,
  creator: TikTokCreatorRules,
  videoSeconds: number | null,
): { choices: T; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = creator.nickname || "This TikTok account";
  if (!creator.privacy.includes(choices.privacy)) {
    errors.push(`${name} can't show a post to ${choices.privacy}. Ask the user to pick one of: ${creator.privacy.join(", ")}.`);
  }
  if (choices.brandedContent && choices.privacy === "private") {
    errors.push("Branded content can't be private on TikTok. Ask the user for another privacy, or to take branded content off.");
  }
  if (videoSeconds !== null && videoSeconds > creator.maxVideoSeconds) {
    errors.push(`${name} can post videos up to ${creator.maxVideoSeconds} seconds. This one is ${Math.ceil(videoSeconds)}.`);
  }
  const next = { ...choices };
  const off: string[] = [];
  if (next.comments && creator.commentDisabled) {
    next.comments = false;
    off.push("Comments");
  }
  if (next.duet && creator.duetDisabled) {
    next.duet = false;
    if (videoSeconds !== null) off.push("Duet");
  }
  if (next.stitch && creator.stitchDisabled) {
    next.stitch = false;
    if (videoSeconds !== null) off.push("Stitch");
  }
  const list = off.length > 1 ? `${off.slice(0, -1).join(", ")} and ${off[off.length - 1]}` : off[0];
  if (off.length) warnings.push(`${list} ${off.length === 1 ? "is" : "are"} turned off in ${name}'s TikTok settings, so ${off.length === 1 ? "it stays" : "they stay"} off on this post.`);
  return { choices: next, errors, warnings };
}
