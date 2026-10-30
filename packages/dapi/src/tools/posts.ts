/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { defineTool } from "../tool";

const PlatformId = z.enum(["tiktok", "instagram", "youtube", "x", "facebook", "linkedin", "threads", "bluesky", "pinterest"]);

const PostStatus = z.enum(["draft", "scheduled", "posted"]);

const Repeat = z.object({
  every: z.int().min(1).max(99).optional().describe("How many of unit between posts. Omit for weekday, which is Monday to Friday."),
  unit: z.enum(["day", "week", "month", "weekday"]),
  until: z.string().optional().describe("Last day, YYYY-MM-DD, inclusive."),
  times: z.int().min(1).max(99).optional().describe("Stop after this many posts, including the first."),
});

const YouTubeSettings = z.object({
  title: z.string().optional().describe("YouTube title. Defaults to the first line of the caption."),
  privacy: z.enum(["public", "unlisted", "private"]).optional().describe("Who can watch. Defaults to public."),
  madeForKids: z.boolean().optional().describe("Whether the video is made for kids."),
  tags: z.array(z.string()).optional().describe("Tags, without a leading #. 30 characters each, 500 altogether."),
});

const TikTokPrivacy = z.enum(["public", "friends", "followers", "private"]);

const TikTokSettings = z.object({
  privacy: TikTokPrivacy.optional().describe(
    "Who can watch, as the user picked it from the choices tiktok_creator lists. There is no default: ask. Required to schedule a TikTok post to the profile, together with promotion.",
  ),
  comments: z.boolean().optional().describe("Allow comments. Off unless the user turns it on."),
  duet: z.boolean().optional().describe("Allow Duet, for a video. Off unless the user turns it on."),
  stitch: z.boolean().optional().describe("Allow Stitch, for a video. Off unless the user turns it on."),
  promotion: z
    .enum(["none", "your_brand", "branded_content", "both"])
    .optional()
    .describe(
      "Whether the post promotes something, as the user answered: none; your_brand, when it promotes themselves or their own business (labelled Promotional content); branded_content, when it promotes another brand or a third party (labelled Paid partnership, and it can't be private); or both. Required with privacy.",
    ),
  agreed: z
    .boolean()
    .optional()
    .describe(
      "True once the user has accepted TikTok's terms for this post: show them consent from tiktok_creator word for word with its links (brandedConsent for branded content) and wait for their yes. Required to schedule a post to the TikTok profile.",
    ),
  inbox: z.boolean().optional().describe("Send the video to the TikTok inbox instead of posting it to the profile. The person finishes it in TikTok."),
});

const ThreadReply = z.object({
  text: z.string().min(1).describe("The words. X takes 280 characters, Bluesky 300, and a LinkedIn comment 1,250."),
  delayMinutes: z
    .int()
    .min(0)
    .max(1440)
    .optional()
    .describe("Minutes after the post, or the follow-up before it, that this one goes out: 0, 1, 5, 15, 30, 60, 180, 360, 720 or 1440. Others are rounded to the nearest. Default 0."),
});

const Thread = z
  .array(ThreadReply)
  .max(10)
  .describe(
    "Follow-ups posted under the post once it's out, each its delay after the one before: replies under it on X and Bluesky, comments on it on LinkedIn. Other platforms get the post alone. Up to 10.",
  );

const PostAccount = z.object({
  platform: PlatformId,
  accountId: z.string().describe("Empty when the post names a platform but no account."),
  handle: z.string().describe("Account name. Empty when that account is no longer connected."),
  publishes: z.boolean().describe("True when Plan Video can send to this platform. TikTok, YouTube, Bluesky, LinkedIn and X can."),
});

const PostDelivery = z.object({
  platform: PlatformId,
  state: z.enum(["sending", "sent", "failed"]),
  error: z.string().optional().describe("What the platform said, when the send failed."),
});

const ScheduledPost = z.object({
  id: z.string(),
  status: PostStatus,
  title: z.string(),
  caption: z.string(),
  day: z.string().describe("YYYY-MM-DD in the dashboard time zone."),
  time: z.string().nullable().describe("HH:MM, or null when a draft has a day and no time."),
  timeZone: z.string(),
  platforms: z.array(PostAccount),
  repeat: z.string().nullable().describe("How it repeats, or null."),
  link: z.string().nullable(),
  thread: z.array(z.object({ text: z.string(), delayMinutes: z.int() })).describe("Follow-ups posted under it once it's out. Empty when it has none."),
  warnings: z.array(z.string()),
  deliveries: z.array(PostDelivery),
});

const postFields = {
  caption: z.string().describe("The caption stored for every platform on the post. One caption: a short platform needs a shorter caption, or leave it off."),
  platforms: z.array(PlatformId).min(1).describe("Where it goes. Ids from social_schema, such as tiktok or x."),
  accounts: z.array(z.string().min(1)).min(1).optional().describe("Connection ids from social_accounts. Required when a platform has more than one account."),
  day: z.string().optional().describe("YYYY-MM-DD in the dashboard time zone, which social_accounts reports."),
  time: z.string().optional().describe("HH:MM in that time zone, 24-hour. 9:00 and 09:00 both work."),
  draft: z.boolean().optional().describe("Save it without scheduling a send. A day and time can still be stored."),
  media: z
    .union([z.string(), z.array(z.string()).min(1).max(35)])
    .optional()
    .describe("One video, or up to 35 pictures as a list for a carousel: absolute paths or project library paths. Remote URLs are refused."),
  link: z.string().optional().describe("A destination link stored on the post."),
  youtube: YouTubeSettings.optional(),
  tiktok: TikTokSettings.optional(),
  repeat: Repeat.optional().describe("Repeat from the first day. Scheduling still does not publish."),
  thread: Thread.optional(),
};

export const socialAccounts = defineTool({
  name: "social_accounts",
  title: "Social accounts",
  description:
    "List the social accounts connected in Plan Video. Call this before scheduling and use the returned ids. Tokens are never returned. When a platform has more than one account, schedule_post has to be given an id from here.",
  input: z.object({}),
  output: z.object({
    timeZone: z.string().describe("The dashboard time zone. Day and time arguments are read in this zone."),
    accounts: z.array(z.object({
      id: z.string(),
      platform: PlatformId,
      handle: z.string(),
      publishes: z.boolean().describe("True when Plan Video can send to this platform."),
      ready: z.boolean().describe("A TikTok, YouTube, Bluesky, LinkedIn or X login is stored, so publish_post can send. False for a name saved without that login, and false for every other platform."),
    })),
  }),
  environment: "renderer",
});

export const socialSchema = defineTool({
  name: "social_schema",
  title: "Platform rules",
  description:
    "Posting rules for each platform: caption limit, what it accepts, and whether Plan Video can publish it. Call this before writing a caption for a short platform such as X or Bluesky. One caption is shared by every platform on a post.",
  input: z.object({
    platform: PlatformId.optional().describe("One platform. Omit for every platform."),
  }),
  output: z.object({
    caption: z.string(),
    platforms: z.array(z.object({
      id: PlatformId,
      name: z.string(),
      captionLimit: z.int(),
      maxVideoSeconds: z.int(),
      maxImages: z.int(),
      hashtagLimit: z.int().nullable(),
      kinds: z.array(z.string()),
      publishes: z.boolean(),
      media: z.enum(["required", "optional"]),
      notes: z.string(),
    })),
  }),
  environment: "renderer",
});

export const tiktokCreator = defineTool({
  name: "tiktok_creator",
  title: "TikTok account check",
  description:
    "Ask TikTok what a connected TikTok account can post right now: the name it posts as, who can watch, whether comments, Duet and Stitch can be on, and the longest video. TikTok requires this before anything goes to a profile, and it can change, so call it each time before you schedule or publish to the TikTok profile. Then tell the user which account the post goes out as, and ask them who can watch (one of privacy; there is no default), whether to allow comments, Duet and Stitch (not those the account has off), and whether the post promotes something. Last, show them consent word for word with its links, or brandedConsent for branded content, and pass agreed true only once they accept. Not needed for tiktok.inbox, where they finish the post in TikTok.",
  input: z.object({
    account: z.string().min(1).optional().describe("A TikTok connection id from social_accounts. Required when there's more than one."),
  }),
  output: z.object({
    accountId: z.string(),
    nickname: z.string().describe("The name the post goes out as. Tell the user."),
    username: z.string(),
    privacy: z.array(TikTokPrivacy).describe("Who this account may show a post to. Offer these and nothing else."),
    comments: z.boolean().describe("False when the account has comments off in TikTok: they stay off."),
    duet: z.boolean().describe("False when the account has Duet off in TikTok: it stays off."),
    stitch: z.boolean().describe("False when the account has Stitch off in TikTok: it stays off."),
    maxVideoSeconds: z.number().describe("The longest video this account can post."),
    consent: z.string().describe("Show the user this before the post is scheduled or published, word for word with its link."),
    brandedConsent: z.string().describe("Show this instead when the post is branded content."),
  }),
  environment: "renderer",
});

export const schedulePost = defineTool({
  name: "schedule_post",
  title: "Schedule post",
  description:
    "Save a post on the Plan Video calendar. This does not publish. Pass platforms and a caption, then either a future day and time or draft true. Call social_accounts first, and pass account ids when a platform has more than one account. Attach one local video, or pictures for a carousel, with media. TikTok, YouTube, Bluesky, LinkedIn and X are sent only by publish_post, and only while Plan Video is open. Other platforms are stored on the calendar and are not sent.",
  input: z.object(postFields),
  output: ScheduledPost,
  environment: "renderer",
});

export const copyPost = defineTool({
  name: "copy_post",
  title: "Copy post",
  description:
    "Make a new post from an existing one, posted or not: the same caption, platforms, accounts, video or pictures, link and platform settings, on a new day and time or as a draft. Pass caption, platforms or accounts to change them on the copy. The original stays as it is. This does not publish. Use it to post something again.",
  input: z.object({
    id: z.string().min(1).describe("The post to copy, from list_posts."),
    day: postFields.day,
    time: postFields.time,
    draft: postFields.draft,
    caption: postFields.caption.optional().describe("A new caption for the copy. Omit to keep the original's."),
    platforms: postFields.platforms.optional().describe("Where the copy goes. Omit to keep the original's platforms."),
    accounts: postFields.accounts,
    thread: Thread.optional().describe("Follow-ups for the copy, in place of the original's. Omit to keep the original's, or pass [] for none."),
    tiktok: TikTokSettings.optional().describe(
      "Changes to the copy's TikTok settings. To schedule a copy to the TikTok profile, pass agreed true once the user accepted TikTok's terms, as tiktok_creator describes.",
    ),
  }),
  output: ScheduledPost,
  environment: "renderer",
});

export const listPosts = defineTool({
  name: "list_posts",
  title: "List posts",
  description:
    "List posts on the calendar, oldest first, or one post when id is set. Includes status, time, accounts, and whether a send succeeded or failed. Does not include tokens.",
  input: z.object({
    id: z.string().optional().describe("One post. Other filters are ignored."),
    status: PostStatus.optional(),
    platform: PlatformId.optional(),
    from: z.string().optional().describe("First day, YYYY-MM-DD, inclusive."),
    to: z.string().optional().describe("Last day, YYYY-MM-DD, inclusive."),
    limit: z.int().min(1).max(100).optional().describe("How many to return (default 50)."),
  }),
  output: z.object({
    timeZone: z.string(),
    total: z.int().describe("How many matched before the limit."),
    posts: z.array(ScheduledPost),
  }),
  environment: "renderer",
});

export const updatePost = defineTool({
  name: "update_post",
  title: "Update post",
  description:
    "Change a draft or a scheduled post. Omitted fields stay as they are. Posted posts stay as they went out. This does not publish. Pass draft true to take a scheduled post back to a draft, or a day and time to schedule a draft.",
  input: z.object({
    id: z.string().min(1),
    ...postFields,
    caption: postFields.caption.optional().describe("The caption stored for every platform on the post. Omit to leave it. One caption: a short platform needs a shorter caption, or leave that platform off."),
    platforms: postFields.platforms.optional().describe("Where it goes. Ids from social_schema, such as tiktok or x. Omit to leave the platforms as they are."),
    repeat: Repeat.nullable().optional().describe("A new repeat, or null to stop repeating."),
    thread: Thread.optional().describe("Follow-ups in place of the post's own. Omit to leave them, or pass [] for none."),
  }),
  output: ScheduledPost,
  environment: "renderer",
});

export const deletePost = defineTool({
  name: "delete_post",
  title: "Delete post",
  description: "Delete a draft or a scheduled post from the calendar. Posted posts cannot be deleted, because the platform already has them.",
  input: z.object({
    id: z.string().min(1),
  }),
  output: z.object({
    id: z.string(),
    deleted: z.literal(true),
  }),
  environment: "renderer",
});

export const publishPost = defineTool({
  name: "publish_post",
  title: "Publish post",
  description:
    "Send a saved post now. TikTok, YouTube, Bluesky, LinkedIn and X publish from Plan Video, and every platform on the post has to be one of them. YouTube needs a video attached, and TikTok a video or pictures; Bluesky, LinkedIn and X also send pictures, or the words alone. This cannot be undone. Do not call it unless the user asked to publish now. Plan Video has to stay open until the send finishes. Call it again to retry a failed send. A post to the TikTok profile needs tiktok_creator first and agreed true.",
  input: z.object({
    id: z.string().min(1),
    agreed: z
      .boolean()
      .optional()
      .describe(
        "For a post to the TikTok profile: true once the user has accepted TikTok's terms for it just now. Show them consent from tiktok_creator word for word with its links (brandedConsent for branded content) and wait for their yes. Required for those posts.",
      ),
  }),
  output: ScheduledPost,
  environment: "renderer",
});
