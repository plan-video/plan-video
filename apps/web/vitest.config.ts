// Runs in Node: only plain modules (no components, no browser APIs).

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@site": resolve(__dirname, "site/src"), "@": resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts", "*.test.ts"], environment: "node" },
});
