/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// posting.mjs is apps/web/src/dapi/server/posts.ts bundled for Node, so the tools agents run without a tab keep
// the same rules as the app. Run after changing it or lib/post-rules.ts and commit the result: the server only
// imports the file, so deploying needs no build.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../../../apps/web/src");
const out = resolve(here, "../posting.mjs");

const app = {
  name: "app",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => b.resolve(`./${args.path.slice(2)}`, { resolveDir: web, kind: args.kind }));
    // Agents read English: the other languages' catalogs are Vite's to load.
    b.onLoad({ filter: /[\\/]lib[\\/]i18n\.ts$/ }, async (args) => ({
      contents: (await readFile(args.path, "utf8")).replace(/import\.meta\.glob<Catalog>\([^)]*\)/g, "({})"),
      loader: "ts",
    }));
  },
};

await build({
  entryPoints: [resolve(web, "dapi/server/posts.ts")],
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  legalComments: "none",
  banner: { js: "// Built by scripts/build-posting.mjs from apps/web/src/dapi/server/posts.ts. Don't edit: run `npm run posting`." },
  // A dependency of this service, as it is of the MCP SDK.
  external: ["zod"],
  plugins: [app],
  logLevel: "warning",
});
console.log(`Wrote ${out}`);
