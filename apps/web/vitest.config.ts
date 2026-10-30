// Tests of the web app's own logic, run in Node: `npm test` in apps/web.
// Only plain modules are tested this way (no components, no browser APIs);
// what they need from the browser is given to them.

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@site": resolve(__dirname, "site/src"), "@": resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts", "*.test.ts"], environment: "node" },
});
