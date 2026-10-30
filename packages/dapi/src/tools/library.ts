/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The media library on the website, for agents that reach plan.video through
// its hosted connector. Not in the catalog: the desktop app attaches files by
// path instead, and the dashboard agent is handed media ids in each message.

import { z } from "zod";
import { defineTool } from "../tool";

export const listMedia = defineTool({
  name: "list_media",
  title: "Media library",
  description:
    "List the videos and pictures in the person's plan.video media library, newest first. Pass an item's media id to schedule_post or update_post as media. Only files in the library can be attached: when the one they want isn't there, ask them to add it in the dashboard's Media tab.",
  input: z.object({
    kind: z.enum(["video", "image"]).optional().describe("Only videos, or only pictures. Omit for both."),
    search: z.string().optional().describe("Words the file name contains."),
    limit: z.int().min(1).max(100).optional().describe("How many to return (default 30)."),
  }),
  output: z.object({
    total: z.int().describe("How many matched before the limit."),
    media: z.array(
      z.object({
        id: z.string().describe("The media id to pass as media, such as media:2f9c1e."),
        name: z.string(),
        kind: z.enum(["video", "image"]),
        seconds: z.number().describe("Length of a video. 0 for a picture."),
        width: z.int(),
        height: z.int(),
        bytes: z.int(),
        added: z.string().describe("When it was added, as an ISO time."),
        uses: z.int().describe("How many posts have used it."),
      }),
    ),
  }),
  environment: "renderer",
});
