import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedConfig } from "vite";
import { afterEach, describe, expect, test } from "vitest";

import { serverEnv, serverSecretsPlugin } from "./server-env";

const SECRET = "sk-ant-not-a-real-key-0123456789";

let dirs: string[] = [];
function folder(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), "server-env-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
  delete process.env.PLAN_SERVER_ENV_TEST;
});

type Hook = (...args: unknown[]) => unknown;
const hooks = (envDir: string, mode = "production") => {
  const plugin = serverSecretsPlugin(envDir, mode);
  return {
    config: () => (plugin.config as Hook)(),
    resolved: (config: Partial<ResolvedConfig>) =>
      (plugin.configResolved as Hook)({ root: envDir, command: "build", envPrefix: "VITE_", build: { outDir: "dist" }, logger: { info() {} }, ...config }),
    close: () => (plugin.closeBundle as { handler: Hook }).handler(),
  };
};

describe("serverEnv", () => {
  test("reads the secrets beside the site's values, and the shell's win", () => {
    const dir = folder({ ".env": "VITE_SERVER_ENV_TEST=https://example.test\n", "server.env": `ANTHROPIC_API_KEY=${SECRET}\nPLAN_SERVER_ENV_TEST=from-file\n` });
    process.env.PLAN_SERVER_ENV_TEST = "from-shell";
    const env = serverEnv("development", dir);
    expect(env.ANTHROPIC_API_KEY).toBe(SECRET);
    expect(env.VITE_SERVER_ENV_TEST).toBe("https://example.test");
    expect(env.PLAN_SERVER_ENV_TEST).toBe("from-shell");
  });

  test("works without a server.env", () => {
    const dir = folder({ ".env": "VITE_SERVER_ENV_TEST=https://example.test\n" });
    expect(serverEnv("development", dir).VITE_SERVER_ENV_TEST).toBe("https://example.test");
  });
});

describe("serverSecretsPlugin", () => {
  test("stops on a secret in any file Vite reads for the mode, naming the key and not its value", () => {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      const { config } = hooks(folder({ [name]: `VITE_APP_URL=https://example.test\nANTHROPIC_API_KEY=${SECRET}\n` }));
      expect(config).toThrow(new RegExp(`ANTHROPIC_API_KEY \\(in apps/web/\\${name}\\).*server\\.env`));
      try {
        config();
      } catch (error) {
        expect(String(error)).not.toContain(SECRET);
      }
    }
  });

  test("lets the site's own values and another mode's file be", () => {
    expect(hooks(folder({ ".env": "VITE_APP_URL=https://example.test\n", ".env.desktop": `ANTHROPIC_API_KEY=${SECRET}\n`, "server.env": `ANTHROPIC_API_KEY=${SECRET}\n` })).config).not.toThrow();
  });

  test("stops when envPrefix is widened", () => {
    const { resolved } = hooks(folder({}));
    expect(() => resolved({ envPrefix: ["VITE_", "STRIPE_"] })).toThrow(/envPrefix/);
    expect(() => resolved({ envPrefix: "" })).toThrow(/envPrefix/);
    expect(() => resolved({ envPrefix: "VITE_" })).not.toThrow();
    expect(() => resolved({ envPrefix: ["VITE_"] })).not.toThrow();
  });

  test("fails a build that wrote a secret anywhere, in text or bytes", () => {
    const leaks: Record<string, string | Buffer> = {
      "dist/assets/index.js": `const k="${SECRET}"`,
      "dist/deep/er/blob.bin": Buffer.concat([Buffer.from([0, 255]), Buffer.from(SECRET), Buffer.from([0])]),
      "dist/index.html": `<meta content="${SECRET}">`,
    };
    for (const [name, content] of Object.entries(leaks)) {
      const dir = folder({ "server.env": `ANTHROPIC_API_KEY=${SECRET}\n`, "dist/ok.js": "fine", [name]: content });
      const plugin = hooks(dir);
      plugin.resolved({});
      expect(plugin.close).toThrow(new RegExp(`ANTHROPIC_API_KEY.*${name.split("/").at(-1)!.replace(".", "\\.")}`));
    }
  });

  test("passes a clean build, and skips short values and the dev server", () => {
    const dir = folder({ "server.env": `ANTHROPIC_API_KEY=${SECRET}\nTIKTOK_READ_VIDEOS=true\n`, "dist/index.js": "const ok = true;" });
    const build = hooks(dir);
    build.resolved({});
    expect(build.close).not.toThrow();

    const leaked = folder({ "server.env": `ANTHROPIC_API_KEY=${SECRET}\n`, "dist/index.js": `"${SECRET}"` });
    const serve = hooks(leaked);
    serve.resolved({ command: "serve" });
    expect(serve.close).not.toThrow();
  });
});
