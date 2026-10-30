/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { loadEnv, type Plugin, type ResolvedConfig } from "vite";

// Dev-server secrets live in apps/web/server.env, a file Vite never reads, so no build setting can bundle them.
// apps/web/.env holds only the public VITE_ values.
export const SERVER_ENV = "server.env";

const read = (file: string): Record<string, string> => (existsSync(file) ? (parseEnv(readFileSync(file, "utf8")) as Record<string, string>) : {});

const viteFiles = (mode: string) => [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];

// The shell's values win over both files.
export function serverEnv(mode: string, envDir: string): Record<string, string> {
  return { ...read(join(envDir, SERVER_ENV)), ...loadEnv(mode, envDir, "") };
}

// Only values long enough not to turn up in a bundle by chance.
function secretValues(envDir: string): [string, string][] {
  return Object.entries(read(join(envDir, SERVER_ENV))).filter(([, value]) => value.trim().length >= 12);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  });
}

// Fails the dev server and build on a non-VITE_ key in a file Vite reads or a widened envPrefix,
// and fails the build if any written file contains a secret's value.
export function serverSecretsPlugin(envDir: string, mode: string): Plugin {
  let config: ResolvedConfig;
  return {
    name: "plan-server-secrets",
    config() {
      const misplaced = viteFiles(mode).flatMap((name) =>
        Object.keys(read(join(envDir, name)))
          .filter((key) => !key.startsWith("VITE_"))
          .map((key) => `${key} (in apps/web/${name})`),
      );
      if (misplaced.length) {
        throw new Error(
          `Only VITE_ values belong in the files Vite reads, as anything there can reach the browser. Move ${misplaced.join(", ")} to apps/web/${SERVER_ENV}.`,
        );
      }
    },
    configResolved(resolved) {
      config = resolved;
      const prefixes = [resolved.envPrefix ?? "VITE_"].flat();
      if (prefixes.length !== 1 || prefixes[0] !== "VITE_") {
        throw new Error(`envPrefix must stay "VITE_": ${JSON.stringify(resolved.envPrefix)} would build other keys into the browser bundle.`);
      }
    },
    closeBundle: {
      order: "post",
      sequential: true,
      handler() {
        if (config.command !== "build") return;
        const secrets = secretValues(envDir).map(([key, value]) => [key, Buffer.from(value.trim())] as const);
        if (!secrets.length) return;
        const outDir = resolve(config.root, config.build.outDir);
        if (!existsSync(outDir)) return;
        const files = filesUnder(outDir);
        for (const file of files) {
          const bytes = readFileSync(file);
          for (const [key, value] of secrets) {
            if (bytes.includes(value)) throw new Error(`The build put ${key} from apps/web/${SERVER_ENV} into ${file}. Nothing was deployed; find what reads it.`);
          }
        }
        config.logger.info(`server secrets: none of ${secrets.length} found in ${files.length} built files`);
      },
    },
  };
}
