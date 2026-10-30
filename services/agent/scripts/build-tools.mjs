/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Writes tools.json: the dashboard agent's tools, taken from the posting
// tools agents reach over MCP (packages/dapi/src/tools/posts.ts), so the two
// cannot drift apart, and from the agent's own analytics tool
// (packages/dapi/src/tools/analytics.ts). Run it after changing those tools,
// and commit the result: the server only reads the JSON, so deploying needs
// no build.
//
//   node services/agent/scripts/build-tools.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const dapi = resolve(here, "../../../packages/dapi/src");

/** In the order the agent meets them: what's connected, the rules, the numbers, then the calendar. */
const NAMES = ["social_accounts", "social_schema", "tiktok_creator", "analytics", "schedule_post", "copy_post", "list_posts", "update_post", "delete_post", "publish_post"];

/** On the website, media comes from the person's library, not a path on their machine. */
const MEDIA =
  "One video, or up to 35 pictures as a list for a carousel, from the person's media library, by the media ids their message lists, such as media:2f9c1e. Pass nothing else: paths and URLs are refused.";

const result = await build({
  stdin: {
    contents: `export * from "./tools/posts"; export * from "./tools/analytics"; export { z } from "zod";`,
    resolveDir: dapi,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
});
const source = result.outputFiles[0].text;
const { z, ...exported } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const byName = new Map(Object.values(exported).filter((tool) => tool?.name && tool.input).map((tool) => [tool.name, tool]));

const tools = NAMES.map((name) => {
  const tool = byName.get(name);
  if (!tool) throw new Error(`No tool named ${name} in posts.ts or analytics.ts`);
  const { $schema: _, ...schema } = z.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" });
  if (schema.properties?.media) schema.properties.media = { ...schema.properties.media, description: MEDIA };
  return { name: tool.name, description: tool.description.replace("Attach one local video, or pictures for a carousel, with media.", "Attach a video, or pictures for a carousel, from the library with media."), input_schema: schema };
});

const out = resolve(here, "../tools.json");
writeFileSync(out, `${JSON.stringify(tools, null, 2)}\n`);
console.log(`Wrote ${tools.length} tools to ${out}`);
