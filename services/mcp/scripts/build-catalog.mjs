/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// catalog.json is built from the sources the app runs (packages/dapi/src/tools/*, and while
// AGENTIC_EDITING is on, apps/web/src/ai-editor/*) so the connector and app can't drift. Run
// after changing them and commit the result: the server only reads the JSON.

import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const editor = resolve(here, "../../../apps/web/src/ai-editor");
const dapi = resolve(here, "../../../packages/dapi/src");

const editing = /export const AGENTIC_EDITING = (true|false);/.exec(readFileSync(resolve(editor, "connector.ts"), "utf8"));
if (!editing) throw new Error("No AGENTIC_EDITING in apps/web/src/ai-editor/connector.ts");
const AGENTIC_EDITING = editing[1] === "true";

/** Tools that only look, for clients that ask before running anything that changes. */
const READ_ONLY = new Set([
  "get_editor_state",
  "list_assets",
  "capture_frames",
  "get_authoring_reference",
  "get_caption_words",
  "social_accounts",
  "social_schema",
  "tiktok_creator",
  "analytics",
  "list_media",
  "list_posts",
]);
/** Tools that change or take away what's there, sends that can't be taken back among them. */
const DESTRUCTIVE = new Set(["delete_elements", "update_post", "ask_for_approval", "delete_post", "publish_post"]);
/** Tools whose posts reach past plan.video: onto the networks, now or at their time, or to anyone with a link. */
const OPEN_WORLD = new Set(["schedule_post", "copy_post", "update_post", "ask_for_approval", "publish_post"]);

/** In the order an agent meets them. */
const POSTING = ["social_accounts", "social_schema", "tiktok_creator", "analytics", "list_media", "schedule_post", "copy_post", "list_posts", "update_post", "ask_for_approval", "delete_post", "publish_post"];

/** On the website, media comes from the person's library, not a path on their machine. */
const MEDIA =
  "One video, or up to 35 pictures as a list for a carousel, from the user's media library, by media id from list_media, such as media:2f9c1e. Paths and URLs are refused.";

const POSTING_INSTRUCTIONS = `These tools plan and publish the user's social posts on plan.video, in the workspace open last in their plan.video dashboard at https://plan.video. They work with plan.video closed.

How to work:
- Start with social_accounts: it gives the connected accounts, their ids, and the dashboard time zone that every day and time is read in.
- Check social_schema before writing for a short network such as X or Bluesky. One caption is shared by every network on a post; when networks need different captions, make one post per network.
- Media comes from the user's media library. Find files with list_media and pass the media id as media, or a list of picture ids to post them together as a carousel. You can't upload files from your side: when the one they want isn't in the library, ask them to add it in the dashboard's Media tab.
- schedule_post puts a post on the calendar at a day and time, or as a draft. A scheduled post goes out on its own at that time. publish_post sends a post at once and can't be undone: call it only when the user asks to publish now. Ask before deleting a post they didn't point to.
- TikTok asks the user to accept its terms in plan.video before anything goes to their profile, so you can't put a post there yourself. A TikTok post you schedule is saved as a draft at its day and time: tell the user to open it in plan.video's calendar and press Schedule. publish_post won't send one either: they press Post now in plan.video. Other networks on that post wait with it, so give TikTok a post of its own. When the user has said who can watch and the rest, pass them in tiktok (tiktok_creator lists what the account allows); they can change them in plan.video. tiktok.inbox true sends the video to their TikTok inbox instead, at its time, where they finish it in TikTok.
- Posts that went out can't be changed, but copy_post makes a new post from any post, with its file and settings, on the day and time asked. When the user refers to posts they made, find them with list_posts rather than asking for the content again.
- When asked for the best days or times, or how they're doing, call analytics first and go by the weekdays and hours with the highest median views. When it says there's too little to go on, say so and pick sensible times.
- When the user wants a client or their team to approve a post first, call ask_for_approval and give them the link it returns. A post waiting for approval, or sent back with changes, doesn't go out; it's scheduled once it's approved.
- When several posts are asked for, spread them sensibly over the days and times given, and don't put two on one channel at the same time.
- After you schedule or change posts, say briefly what you did: where each goes, when, and its caption if it's short.`;

/** esbuild, so TypeScript and `?raw` imports work under plain Node. */
async function load(contents, resolveDir) {
  // The prompt pulls its docs in with Vite's `?raw`; here they load as text.
  const raw = {
    name: "raw",
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "raw" }));
      b.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
    },
  };
  const result = await build({
    stdin: { contents, resolveDir, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    plugins: [raw],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const annotate = (name) => ({ readOnlyHint: READ_ONLY.has(name), destructiveHint: DESTRUCTIVE.has(name), openWorldHint: OPEN_WORLD.has(name) });

async function postingTools() {
  const { z, ...exported } = await load(
    `export * from "./tools/posts"; export * from "./tools/analytics"; export * from "./tools/library"; export { z } from "zod";`,
    dapi,
  );
  const byName = new Map(Object.values(exported).filter((tool) => tool?.name && tool.input).map((tool) => [tool.name, tool]));
  return POSTING.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`No tool named ${name} in posts.ts, analytics.ts or library.ts`);
    const { $schema: _, ...inputSchema } = z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" });
    if (inputSchema.properties?.media) inputSchema.properties.media = { ...inputSchema.properties.media, description: MEDIA };
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description
        .replace(", once it has synced to the account, so the app has to stay open until then", "")
        .replace(" plan.video has to stay open until this answers.", "")
        .replace("Attach one local video, or pictures for a carousel, with media.", "Attach a video, or pictures for a carousel, from the media library with media.")
        .replace("Read the person's numbers", "Read the user's numbers")
        .replace("when they ask how they're doing", "when the user asks how they're doing"),
      inputSchema,
      annotations: annotate(tool.name),
    };
  });
}

async function editingTools() {
  const { TOOLS, CONNECTOR_INSTRUCTIONS, AUTHORING_REFERENCE } = await load(
    `export { TOOLS } from "./definitions"; export { CONNECTOR_INSTRUCTIONS, AUTHORING_REFERENCE } from "./prompt";`,
    editor,
  );
  const tools = [
    ...TOOLS,
    {
      name: "get_authoring_reference",
      description: "The element reference (tags, props, timing, styles, animations) and the voice guide for copy. Read it once before inserting elements or setting props you haven't seen in get_editor_state.",
      input_schema: { type: "object", properties: {} },
    },
  ].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.input_schema, annotations: annotate(tool.name) }));
  return { tools, instructions: CONNECTOR_INSTRUCTIONS, reference: AUTHORING_REFERENCE };
}

const posting = await postingTools();
const catalog = AGENTIC_EDITING
  ? await editingTools().then((edit) => ({
      instructions: `${POSTING_INSTRUCTIONS}\n\n${edit.instructions}`,
      reference: edit.reference,
      tools: [...posting, ...edit.tools],
    }))
  : { instructions: POSTING_INSTRUCTIONS, reference: "", tools: posting };

const out = resolve(here, "../catalog.json");
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${catalog.tools.length} tools to ${out}${AGENTIC_EDITING ? "" : " (agentic editing off: posting only)"}`);
