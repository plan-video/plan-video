/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Not in the catalog: the dashboard fetches these numbers, so agents over MCP don't have them yet.

import { z } from "zod";
import { defineTool } from "../tool";

const Numbers = z.object({
  views: z.int(),
  likes: z.int(),
  comments: z.int(),
});

const PostedWhen = z.object({
  posts: z.int().describe("Posts that went out then."),
  medianViews: z.int().describe("The middle post's views: a post that took off doesn't sway it."),
  averageViews: z.int(),
  engagement: z.number().describe("Likes and comments per view, over those posts."),
});

export const analytics = defineTool({
  name: "analytics",
  title: "Analytics",
  description:
    "Read the person's numbers from the Analytics page: views, likes and comments for each connected account that reports them (TikTok, YouTube, Instagram, Facebook Pages and Threads), how posts did by the weekday and hour they went out, and their top posts. Call this before picking days or times from how their posts perform, or when they ask how they're doing. Days and hours are in the dashboard time zone. A post's numbers are its totals so far, so the newest posts have had less time.",
  input: z.object({
    platform: z.enum(["tiktok", "youtube", "instagram", "facebook", "threads"]).optional().describe("One network. Omit for every account that reports numbers."),
    account: z.string().optional().describe("One account id, from social_accounts."),
    days: z.int().min(7).max(730).optional().describe("How far back to look, counting today. Defaults to 90."),
  }),
  output: z.object({
    timeZone: z.string(),
    from: z.string().describe("First day, YYYY-MM-DD."),
    to: z.string().describe("Last day, YYYY-MM-DD."),
    accounts: z.array(
      z.object({
        platform: z.string(),
        accountId: z.string(),
        handle: z.string(),
        state: z.string().describe("ready, or why its numbers couldn't be read."),
        totals: Numbers,
        previous: Numbers.describe("The same number of days just before."),
        posts: z.int(),
      }),
    ),
    noNumbers: z.array(z.string()).describe("Connected accounts whose network doesn't send plan.video its numbers."),
    byWeekday: z.array(PostedWhen.extend({ weekday: z.string() })).describe("Monday first; days with no posts are left out."),
    byHour: z.array(PostedWhen.extend({ hour: z.string().describe("HH:00, the hour the posts went out.") })),
    topPosts: z.array(
      Numbers.extend({
        title: z.string(),
        platform: z.string(),
        handle: z.string(),
        postedAt: z.string().describe("YYYY-MM-DD HH:MM, weekday."),
      }),
    ),
    note: z.string().optional().describe("Why there is little or nothing to go on."),
  }),
  environment: "renderer",
});
