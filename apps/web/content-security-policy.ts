/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

/** Inline scripts, with their attributes and text. Ones with a src are fetched, and `'self'` covers them. */
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

/** Scripts that only carry data, which the browser never runs. */
const DATA_TYPE = /\btype=["']?application\/(?:ld\+)?json/i;

const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

/**
 * The page's policy. Scripts run from this site, the inline ones in its HTML
 * by hash, and the analytics a visitor accepts. Everything a script can be
 * pointed at elsewhere stays shut: no eval, no plugins, no other base URL.
 * Pictures, media and requests go wide, as posts, avatars and Bluesky's
 * servers live on hosts nobody can list.
 */
function policy(hashes: string[], env: Record<string, string>): string {
  const directives: Record<string, (string | null)[]> = {
    "default-src": ["'self'"],
    // ONNX Runtime's WebAssembly (background removal), the audio worklets the
    // editor writes as blobs, Google Analytics and PostHog's own scripts.
    "script-src": [
      "'self'",
      "'wasm-unsafe-eval'",
      "blob:",
      "https://www.googletagmanager.com",
      "https://eu-assets.i.posthog.com",
      origin(env.VITE_UMAMI_SCRIPT_URL),
      ...hashes.map((hash) => `'sha256-${hash}'`),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "data:", "blob:", "https:"],
    // The editor's and the caption styles' typefaces.
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    // Supabase's realtime and the agent connector's socket (older Safari
    // doesn't count a wss address of the site's own as 'self').
    "connect-src": ["'self'", "https:", "wss:", "data:", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...new Set(sources.filter(Boolean))].join(" "))
    .join("; ");
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/**
 * After a website build, gives every HTML file a Content-Security-Policy in a
 * meta tag, with the hash of each of its inline scripts: those differ page to
 * page and build to build (the home page's carries the headline in each
 * language, lib/hero-shell.ts). It runs after prerender-pages has written its
 * pages. frame-ancestors can't be set from a meta tag: Caddy sends it.
 */
export function contentSecurityPolicyPlugin(env: Record<string, string>): Plugin {
  let config: ResolvedConfig;
  return {
    name: "content-security-policy",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        const files = htmlFiles(resolve(config.root, config.build.outDir));
        for (const file of files) {
          const html = readFileSync(file, "utf8");
          const hashes = [...html.matchAll(SCRIPT)]
            .filter(([, attributes]) => !/\bsrc=/i.test(attributes) && !DATA_TYPE.test(attributes))
            .map(([, , text]) => createHash("sha256").update(text, "utf8").digest("base64"));
          const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(hashes, env)}" />`;
          // Straight after the charset, which belongs in the first bytes, and before anything the policy covers.
          const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(html);
          const head = charset ?? /<head>/i.exec(html);
          if (!head) throw new Error(`content-security-policy: ${file} has no <head>`);
          const at = head.index + head[0].length;
          writeFileSync(file, `${html.slice(0, at)}\n    ${meta}${html.slice(at)}`);
        }
        config.logger.info(`content-security-policy: wrote the policy into ${files.length} pages`);
      },
    },
  };
}
