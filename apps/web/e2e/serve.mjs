// This checkout's dev server on 5391, signed in to the local Supabase rather
// than production, for the end-to-end checks beside it (see helpers.mjs).

import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
process.env.VITE_SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
// Its own cache, so it never touches the one the usual dev server uses.
const cacheDir = resolve(tmpdir(), "plan-video-e2e-vite");
mkdirSync(cacheDir, { recursive: true });
const { createServer } = await import(resolve(root, "node_modules/vite/dist/node/index.js"));
const server = await createServer({
  root: web,
  configFile: resolve(web, "vite.config.ts"),
  cacheDir,
  // The real place of node_modules too, for a checkout whose node_modules links to another.
  server: { port: 5391, strictPort: true, host: "127.0.0.1", fs: { allow: [root, realpathSync(resolve(root, "node_modules")), cacheDir] } },
  logLevel: "warn",
});
await server.listen();
console.log("ready on 5391");
