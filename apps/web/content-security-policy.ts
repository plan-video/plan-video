/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

const DATA_TYPE = /\btype=["']?application\/(?:ld\+)?json/i;

const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

// Images, media and requests go wide: posts, avatars and Bluesky's servers live on hosts nobody can list.
function policy(hashes: string[], env: Record<string, string>): string {
  const directives: Record<string, (string | null)[]> = {
    "default-src": ["'self'"],
    // wasm for ONNX Runtime (background removal), blob: for the editor's audio worklets.
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
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    // Older Safari doesn't count the site's own wss address as 'self'.
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

// Inline script hashes differ per page and build, so this must run after prerender-pages.
// frame-ancestors can't be set from a meta tag: the web server sends it.
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
          // After the charset, which belongs in the first bytes, and before anything the policy covers.
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
